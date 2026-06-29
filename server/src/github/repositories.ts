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

/**
 * List branches for a repository from GitHub. Used to let the user start a
 * preview from an arbitrary branch (issue #25).
 */
export async function listRepositoryBranches(owner: string, name: string): Promise<BranchInfo[]> {
  const octokit = getOctokit();
  const branches = await octokit.paginate(octokit.rest.repos.listBranches, {
    owner,
    repo: name,
    per_page: 100,
  });
  return branches.map((b) => ({ name: b.name, commitSha: b.commit.sha }));
}
