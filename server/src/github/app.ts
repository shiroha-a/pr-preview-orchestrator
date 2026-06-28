import { App } from "octokit";

import { env, hasGitHubAppCredentials } from "../env";

/** Convert escaped newlines (\n) in a PEM private key to real newlines. */
function normalizePrivateKey(key: string): string {
  return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}

let cachedApp: App | undefined;

/**
 * Return a cached GitHub App instance.
 *
 * @throws when GitHub App credentials are not configured.
 */
export function getApp(): App {
  if (!hasGitHubAppCredentials()) {
    throw new Error(
      "GitHub App credentials are not configured. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY in .env.",
    );
  }
  if (!cachedApp) {
    cachedApp = new App({
      appId: env.GITHUB_APP_ID as string,
      privateKey: normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY as string),
      webhooks: { secret: env.GITHUB_WEBHOOK_SECRET ?? "development-secret" },
    });
  }
  return cachedApp;
}

/** Return an Octokit client authenticated as the given installation. */
export async function getInstallationOctokit(installationId: number) {
  return getApp().getInstallationOctokit(installationId);
}

/** Octokit client type for a given installation (includes rest + paginate plugins). */
export type InstallationOctokit = Awaited<ReturnType<typeof getInstallationOctokit>>;

/**
 * Obtain a short-lived installation access token, used to authenticate git
 * clone/fetch over HTTPS (https://x-access-token:<token>@github.com/...).
 */
export async function getInstallationToken(installationId: number): Promise<string> {
  const octokit = await getInstallationOctokit(installationId);
  const auth = (await octokit.auth({ type: "installation" })) as { token: string };
  return auth.token;
}
