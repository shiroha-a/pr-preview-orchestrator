import { prisma } from "../db/client";

import { getInstallationOctokit } from "./app";

/** Minimal repository reference needed to talk to the GitHub API. */
export interface RepoRef {
  id: string;
  owner: string;
  name: string;
  installationId: number;
}

/** A normalized comment for display, merged across comment sources. */
export interface CommentDTO {
  id: string;
  kind: "issue" | "review-comment" | "review";
  author: string;
  authorAvatar: string | null;
  body: string;
  createdAt: string;
  htmlUrl: string | null;
  /** Review state (APPROVED / CHANGES_REQUESTED / COMMENTED) for review entries. */
  state: string | null;
  /** File path for inline review comments. */
  path: string | null;
  /** Line number for inline review comments. */
  line: number | null;
}

interface GitHubPullLike {
  number: number;
  title: string;
  body: string | null;
  state: string;
  merged_at: string | null;
  user: { login: string } | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  html_url: string;
  updated_at: string;
}

function mapPullToRecord(pr: GitHubPullLike) {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? null,
    state: pr.merged_at ? "merged" : pr.state,
    authorLogin: pr.user?.login ?? "unknown",
    headRef: pr.head.ref,
    headSha: pr.head.sha,
    baseRef: pr.base.ref,
    htmlUrl: pr.html_url,
    prUpdatedAt: new Date(pr.updated_at),
  };
}

/** Fetch all pull requests for a repository from GitHub and cache them. */
export async function syncPullRequests(repo: RepoRef): Promise<number> {
  const octokit = await getInstallationOctokit(repo.installationId);
  const pulls = await octokit.paginate("GET /repos/{owner}/{repo}/pulls", {
    owner: repo.owner,
    repo: repo.name,
    state: "all",
    sort: "updated",
    direction: "desc",
    per_page: 50,
  });

  for (const pr of pulls) {
    const record = mapPullToRecord(pr as unknown as GitHubPullLike);
    await prisma.pullRequest.upsert({
      where: { repositoryId_number: { repositoryId: repo.id, number: pr.number } },
      create: { ...record, repositoryId: repo.id },
      update: record,
    });
  }

  return pulls.length;
}

/** Fetch a single pull request from GitHub and cache it, returning the cached row. */
export async function fetchAndCachePullRequest(repo: RepoRef, number: number) {
  const octokit = await getInstallationOctokit(repo.installationId);
  const { data } = await octokit.rest.pulls.get({
    owner: repo.owner,
    repo: repo.name,
    pull_number: number,
  });

  const record = mapPullToRecord(data as unknown as GitHubPullLike);
  return prisma.pullRequest.upsert({
    where: { repositoryId_number: { repositoryId: repo.id, number } },
    create: { ...record, repositoryId: repo.id },
    update: record,
  });
}

/** Fetch the unified diff text for a pull request. */
export async function fetchPullRequestDiff(repo: RepoRef, number: number): Promise<string> {
  const octokit = await getInstallationOctokit(repo.installationId);
  const res = await octokit.rest.pulls.get({
    owner: repo.owner,
    repo: repo.name,
    pull_number: number,
    mediaType: { format: "diff" },
  });
  // With the "diff" media type the response body is the raw diff string.
  return res.data as unknown as string;
}

/**
 * Fetch and merge all comment sources (issue comments, inline review comments,
 * and reviews) for a pull request, sorted chronologically.
 */
export async function fetchPullRequestComments(
  repo: RepoRef,
  number: number,
): Promise<CommentDTO[]> {
  const octokit = await getInstallationOctokit(repo.installationId);
  const params = { owner: repo.owner, repo: repo.name } as const;

  const [issueComments, reviewComments, reviews] = await Promise.all([
    octokit.paginate("GET /repos/{owner}/{repo}/issues/{issue_number}/comments", {
      ...params,
      issue_number: number,
      per_page: 100,
    }),
    octokit.paginate("GET /repos/{owner}/{repo}/pulls/{pull_number}/comments", {
      ...params,
      pull_number: number,
      per_page: 100,
    }),
    octokit.paginate("GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
      ...params,
      pull_number: number,
      per_page: 100,
    }),
  ]);

  const comments: CommentDTO[] = [];

  for (const c of issueComments) {
    comments.push({
      id: `issue-${c.id}`,
      kind: "issue",
      author: c.user?.login ?? "unknown",
      authorAvatar: c.user?.avatar_url ?? null,
      body: c.body ?? "",
      createdAt: c.created_at,
      htmlUrl: c.html_url,
      state: null,
      path: null,
      line: null,
    });
  }

  for (const c of reviewComments) {
    comments.push({
      id: `review-comment-${c.id}`,
      kind: "review-comment",
      author: c.user?.login ?? "unknown",
      authorAvatar: c.user?.avatar_url ?? null,
      body: c.body ?? "",
      createdAt: c.created_at,
      htmlUrl: c.html_url,
      state: null,
      path: c.path ?? null,
      line: c.line ?? c.original_line ?? null,
    });
  }

  for (const r of reviews) {
    // Skip reviews that carry neither a body nor a meaningful state.
    if (!r.body && (!r.state || r.state === "COMMENTED")) continue;
    comments.push({
      id: `review-${r.id}`,
      kind: "review",
      author: r.user?.login ?? "unknown",
      authorAvatar: r.user?.avatar_url ?? null,
      body: r.body ?? "",
      createdAt: r.submitted_at ?? new Date(0).toISOString(),
      htmlUrl: r.html_url,
      state: r.state ?? null,
      path: null,
      line: null,
    });
  }

  comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return comments;
}
