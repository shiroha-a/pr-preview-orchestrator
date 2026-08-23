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

  // Docker image used to run each preview's Cloudflare tunnel as a detached
  // container, so the tunnel survives an app restart (issue #48). Previews are
  // reachable only through this tunnel and publish no host ports (issue #90).
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

  // Filesystem path measured by the disk usage metric. Defaults to the docker
  // data root, which is what fills up in practice (images / build cache /
  // volumes). Falls back to "/" when the path is unavailable, e.g. rootless
  // docker or a container without the bind mount (issue #90).
  METRICS_DISK_PATH: z.string().default("/var/lib/docker"),

  // Directory of the built web SPA, served by Hono in production (relative to server/).
  WEB_DIST_DIR: z.string().default("../web/dist"),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

/** Whether an optional GitHub token is configured. */
export function hasGitHubToken(): boolean {
  return Boolean(env.GITHUB_TOKEN);
}
