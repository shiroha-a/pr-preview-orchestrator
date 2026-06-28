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
