import { prisma } from "../db/client";

import { getApp } from "./app";

export interface SyncRepositoriesResult {
  repositories: number;
  installations: number;
}

/**
 * Synchronize all repositories accessible to the GitHub App into the local
 * database. Iterates every installation and upserts each accessible repository.
 */
export async function syncRepositories(): Promise<SyncRepositoriesResult> {
  const app = getApp();
  let repositories = 0;
  let installations = 0;

  for await (const { installation } of app.eachInstallation.iterator()) {
    installations += 1;
    const octokit = await app.getInstallationOctokit(installation.id);
    const repos = await octokit.paginate("GET /installation/repositories", {
      per_page: 100,
    });

    for (const repo of repos) {
      await prisma.repository.upsert({
        where: { owner_name: { owner: repo.owner.login, name: repo.name } },
        create: {
          owner: repo.owner.login,
          name: repo.name,
          installationId: installation.id,
        },
        update: { installationId: installation.id },
      });
      repositories += 1;
    }
  }

  return { repositories, installations };
}

/** Look up a cached repository by owner/name. */
export async function getRepositoryBySlug(owner: string, name: string) {
  return prisma.repository.findUnique({
    where: { owner_name: { owner, name } },
  });
}
