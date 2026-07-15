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
  // Process role (issue #80): "orchestrator" runs the full server, "agent" runs
  // the pulling build agent (no HTTP server, no DB, no WebUI).
  SERVER_MODE: z.enum(["orchestrator", "agent"]).default("orchestrator"),

  // Agent mode only: base URL of the orchestrator and the bearer token issued
  // at registration time (shown once in the WebUI).
  ORCHESTRATOR_URL: z.string().optional(),
  AGENT_TOKEN: z.string().optional(),

  DATABASE_URL: z.string().default("file:./dev.db"),

  // HTTP server. Uses API_PORT (not the generic PORT) to avoid clashing with
  // other tools that may export PORT in the shell environment.
  API_PORT: z.coerce.number().int().default(8787),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),

  // Optional basic-auth credentials protecting the admin UI/API.
  // Used as the seed / sync source for the initial admin user.
  ADMIN_USER: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),

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

  // Docker image used to run each preview's Cloudflare tunnel as a detached
  // container, so the tunnel survives an app restart (issue #48).
  PREVIEW_TUNNEL_IMAGE: z.string().default("cloudflare/cloudflared:latest"),

  // Docker image used as a throwaway helper to read/write preview volumes for
  // export/import (issue #61). Needs sh, tar, gzip, find and du.
  PREVIEW_VOLUME_HELPER_IMAGE: z.string().default("busybox:stable"),

  // Idle timeout (ms) for build commands: abort only after this long with no
  // output. Large builds keep running as long as they keep producing output.
  PREVIEW_BUILD_TIMEOUT_MS: z.coerce.number().int().default(600000),

  // Max number of preview jobs processed in parallel (issue #33). Builds for
  // different previews run concurrently; same-preview jobs stay serialized.
  PREVIEW_JOB_CONCURRENCY: z.coerce.number().int().min(1).default(3),

  // Where images are built when neither the repository nor the profile sets a
  // buildMode (issue #80): "auto" uses a remote build agent when one is online
  // and falls back to local, "remote" requires an agent, "local" never
  // dispatches remotely.
  BUILD_MODE_DEFAULT: z.enum(["auto", "remote", "local"]).default("auto"),

  // An agent counts as online while its last poll is within this window.
  AGENT_ONLINE_THRESHOLD_MS: z.coerce.number().int().default(90000),

  // How long a queued remote build may wait for an agent to claim it before
  // falling back to a local build (issue #80).
  REMOTE_BUILD_CLAIM_TIMEOUT_MS: z.coerce.number().int().default(30000),

  // Directory of the built web SPA, served by Hono in production (relative to server/).
  WEB_DIST_DIR: z.string().default("../web/dist"),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

/** Whether an optional GitHub token is configured. */
export function hasGitHubToken(): boolean {
  return Boolean(env.GITHUB_TOKEN);
}
