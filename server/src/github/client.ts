import { Octokit } from "octokit";

import { env } from "../env";

let cached: Octokit | undefined;

/**
 * Return a cached Octokit client for the public GitHub REST API.
 *
 * Authentication is optional: without a token the public API is used (subject
 * to unauthenticated rate limits); with GITHUB_TOKEN set, requests are
 * authenticated, raising rate limits and enabling private repository access.
 */
export function getOctokit(): Octokit {
  if (!cached) {
    cached = new Octokit(env.GITHUB_TOKEN ? { auth: env.GITHUB_TOKEN } : {});
  }
  return cached;
}
