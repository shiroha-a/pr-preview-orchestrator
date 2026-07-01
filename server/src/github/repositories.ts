import { prisma } from "../db/client";

import { getOctokit } from "./client";

/**
 * Add a repository by owner/name, verifying it exists and is accessible on
 * GitHub via the public API.
 */
export async function addRepository(owner: string, name: string) {
  const octokit = getOctokit();
  const { data } = await octokit.rest.repos.get({ owner, repo: name });
  return prisma.repository.upsert({
    where: { owner_name: { owner: data.owner.login, name: data.name } },
    create: { owner: data.owner.login, name: data.name },
    update: {},
  });
}

/** Look up a cached repository by owner/name. */
export async function getRepositoryBySlug(owner: string, name: string) {
  return prisma.repository.findUnique({
    where: { owner_name: { owner, name } },
  });
}

/** A branch on GitHub, with the SHA of its current tip. */
export interface BranchInfo {
  name: string;
  commitSha: string;
}

// ブランチ一覧はページ表示のたびに取得すると GitHub API を叩きすぎるため、
// リポジトリ単位で短時間キャッシュする(force で明示更新)。
const branchCache = new Map<string, { data: BranchInfo[]; at: number }>();
const BRANCH_CACHE_TTL_MS = 5 * 60 * 1000; // 5分

/**
 * List branches for a repository from GitHub (5分間キャッシュ)。Used to let the
 * user start a preview from an arbitrary branch (issue #25). force=true でGitHubから再取得。
 */
export async function listRepositoryBranches(
  owner: string,
  name: string,
  force = false,
): Promise<BranchInfo[]> {
  const key = `${owner}/${name}`;
  const cached = branchCache.get(key);
  if (!force && cached && Date.now() - cached.at < BRANCH_CACHE_TTL_MS) {
    return cached.data;
  }

  const octokit = getOctokit();
  const branches = await octokit.paginate(octokit.rest.repos.listBranches, {
    owner,
    repo: name,
    per_page: 100,
  });
  const data = branches.map((b) => ({ name: b.name, commitSha: b.commit.sha }));
  branchCache.set(key, { data, at: Date.now() });
  return data;
}
