import "dotenv/config";
import { z } from "zod";

/**
 * Server-side environment configuration.
 *
 * The orchestrator uses the public GitHub REST API. A token is optional: public
 * repositories work without it, but providing a Personal Access Token raises
 * rate limits and enables access to private repositories.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().default("file:./dev.db"),

  // HTTP server. Uses API_PORT (not the generic PORT) to avoid clashing with
  // other tools that may export PORT in the shell environment.
  API_PORT: z.coerce.number().int().default(8787),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),

  // Optional GitHub Personal Access Token (raises rate limits / private access).
  GITHUB_TOKEN: z.string().optional(),

  // Optional webhook secret for verifying GitHub webhook deliveries.
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  // Local directory where target repositories are cloned.
  WORKSPACES_DIR: z.string().default("./workspaces"),

  // Hostname used to build local preview URLs (when tunnelling is disabled).
  PREVIEW_HOST: z.string().default("localhost"),

  // Host port range allocated to preview environments.
  PREVIEW_PORT_MIN: z.coerce.number().int().default(13000),
  PREVIEW_PORT_MAX: z.coerce.number().int().default(13999),

  // Expose previews via Cloudflare Quick Tunnel (trycloudflare.com). Set to
  // "false" to disable and use local URLs instead.
  PREVIEW_TUNNEL: z
    .string()
    .optional()
    .transform((v) => v !== "false"),

  // Timeout (ms) for long-running build commands (docker compose up).
  PREVIEW_BUILD_TIMEOUT_MS: z.coerce.number().int().default(600000),

  // Directory of the built web SPA, served by Hono in production (relative to server/).
  WEB_DIST_DIR: z.string().default("../web/dist"),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

/** Whether an optional GitHub token is configured. */
export function hasGitHubToken(): boolean {
  return Boolean(env.GITHUB_TOKEN);
}
