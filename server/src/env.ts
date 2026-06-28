import "dotenv/config";
import { z } from "zod";

/**
 * Server-side environment configuration.
 *
 * GitHub App credentials are optional so the server can boot before the GitHub
 * App is configured; the GitHub client throws a descriptive error when they are
 * missing at the point of use.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().default("file:./dev.db"),

  // HTTP server. Uses API_PORT (not the generic PORT) to avoid clashing with
  // other tools that may export PORT in the shell environment.
  API_PORT: z.coerce.number().int().default(8787),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),

  // GitHub App credentials.
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),

  // Local directory where target repositories are cloned.
  WORKSPACES_DIR: z.string().default("./workspaces"),

  // Hostname used to build preview URLs (e.g. localhost).
  PREVIEW_HOST: z.string().default("localhost"),

  // Host port range allocated to preview environments.
  PREVIEW_PORT_MIN: z.coerce.number().int().default(13000),
  PREVIEW_PORT_MAX: z.coerce.number().int().default(13999),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

/** Whether the GitHub App credentials required for API access are present. */
export function hasGitHubAppCredentials(): boolean {
  return Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);
}
