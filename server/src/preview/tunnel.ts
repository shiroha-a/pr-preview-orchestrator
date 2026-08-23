import { spawn } from "node:child_process";

import { env } from "../env";

/**
 * Cloudflare Quick Tunnels are run as **detached Docker containers** (not Node
 * child processes) so they survive a restart of the orchestrator app. When the
 * app is redeployed/restarted, the tunnel container keeps running and its
 * `https://<random>.trycloudflare.com` URL stays the same, so previews baking
 * that URL into their config do not break (issue #48).
 *
 * The tunnel is the only way a preview is reachable: previews publish no host
 * ports (issue #90). The container is started on the default bridge network
 * *before* `docker compose up`, so its public URL is known early enough to be
 * injected into the target repository's config files, and is attached to the
 * preview's compose network afterwards via {@link connectTunnel}. cloudflared
 * resolves the origin host per request, so the service does not need to exist
 * when the tunnel starts.
 */

const TUNNEL_PREFIX = "preview-tunnel-";
const TRYCLOUDFLARE_URL = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g;

/** Deterministic container name for a preview's tunnel. */
function containerName(previewId: string): string {
  // previewId is a cuid (alphanumeric); sanitize defensively for docker names.
  return `${TUNNEL_PREFIX}${previewId.replace(/[^a-zA-Z0-9_.-]/g, "-")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Run a docker command and capture its combined stdout+stderr. Never rejects. */
function runDocker(args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("docker", args);
    let output = "";
    const collect = (buf: Buffer) => {
      output += buf.toString();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", () => resolve({ code: -1, output }));
    child.on("close", (code) => resolve({ code: code ?? 0, output }));
  });
}

/**
 * Read the current trycloudflare URL from a tunnel container's logs, or null if
 * the container is missing or no URL has appeared yet. Returns the **last** URL
 * in the log so that, if the container restarted and produced a new URL, we pick
 * up the current one rather than a stale earlier line.
 */
async function readTunnelUrl(name: string): Promise<string | null> {
  const { code, output } = await runDocker(["logs", name]);
  if (code !== 0) return null;
  const matches = output.match(TRYCLOUDFLARE_URL);
  return matches && matches.length > 0 ? matches[matches.length - 1] : null;
}

/**
 * Start a Cloudflare Quick Tunnel container for the given origin (the preview's
 * web service, e.g. `http://web:3000`) and resolve with the public
 * https://<random>.trycloudflare.com URL.
 *
 * The container is detached and tracked by previewId (via its name) so it can be
 * torn down later via {@link stopTunnel} and, crucially, survives an app restart
 * (issue #48). It starts on the default bridge network — which provides the
 * outbound connectivity cloudflared needs — and only reaches the origin once
 * {@link connectTunnel} attaches it to the preview's network. Rejects if the
 * container fails to start or no URL appears within the timeout.
 */
export async function startTunnel(previewId: string, origin: string): Promise<string> {
  const name = containerName(previewId);
  // Replace any existing tunnel container for this preview.
  await stopTunnel(previewId);

  // イメージの entrypoint が `cloudflared --no-autoupdate` のため、コマンド引数は
  // `tunnel --url ...` のみでよい。
  const run = await runDocker([
    "run",
    "-d",
    "--name",
    name,
    "--restart",
    "unless-stopped",
    "--label",
    "pr-preview-orchestrator-tunnel=1",
    env.PREVIEW_TUNNEL_IMAGE,
    "tunnel",
    "--url",
    origin,
  ]);
  if (run.code !== 0) {
    throw new Error(`Failed to start tunnel container: ${run.output.trim()}`);
  }

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const url = await readTunnelUrl(name);
    if (url) return url;
    await sleep(500);
  }
  // タイムアウト時は死んだコンテナを残さないよう掃除してから失敗させる。
  await stopTunnel(previewId);
  throw new Error("Timed out waiting for Cloudflare tunnel URL");
}

/** Stop and remove the tunnel container associated with a preview, if any. */
export async function stopTunnel(previewId: string): Promise<void> {
  // rm -f は稼働中コンテナも除去する。存在しなければ非0で返るが無視する。
  await runDocker(["rm", "-f", containerName(previewId)]);
}

/** Docker networks a container is attached to (empty when it does not exist). */
async function networksOf(container: string): Promise<string[]> {
  const { code, output } = await runDocker([
    "inspect",
    container,
    "--format",
    "{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}",
  ]);
  if (code !== 0) return [];
  return output.trim().split(/\s+/).filter(Boolean);
}

/**
 * Attach the preview's tunnel container to the network of its web service, so
 * cloudflared can reach the origin by compose service name (issue #90).
 *
 * Must be called after `docker compose up` created the network. Returns false
 * when the service container or its network cannot be found, which leaves the
 * preview unreachable (e.g. a service using `network_mode: host`).
 */
export async function connectTunnel(
  previewId: string,
  project: string,
  service: string,
): Promise<boolean> {
  const ps = await runDocker([
    "ps",
    "-q",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--filter",
    `label=com.docker.compose.service=${service}`,
  ]);
  const containerId = ps.output.trim().split("\n")[0];
  if (ps.code !== 0 || !containerId) return false;

  const name = containerName(previewId);
  for (const network of await networksOf(containerId)) {
    const res = await runDocker(["network", "connect", network, name]);
    // 接続済みの場合は非0で返るが、到達性としては満たされているので成功扱いにする。
    if (res.code === 0 || /already exists in network/i.test(res.output)) return true;
  }
  return false;
}

/**
 * Detach the tunnel container from every preview network it joined, keeping the
 * default bridge (its outbound path).
 *
 * Called before `docker compose down` so the project's network has no active
 * endpoint left and can actually be removed.
 */
export async function disconnectTunnel(previewId: string): Promise<void> {
  const name = containerName(previewId);
  for (const network of await networksOf(name)) {
    if (network === "bridge") continue;
    await runDocker(["network", "disconnect", network, name]);
  }
}

/** Whether a tunnel container is currently running for this preview. */
export async function isTunnelAlive(previewId: string): Promise<boolean> {
  const name = containerName(previewId);
  const { code, output } = await runDocker([
    "ps",
    "--filter",
    `name=^${name}$`,
    "--filter",
    "status=running",
    "--format",
    "{{.Names}}",
  ]);
  return code === 0 && output.trim().length > 0;
}

/**
 * Return the current public URL of a preview's tunnel by reading its running
 * container's logs, or null if there is no live tunnel. Used on app restart to
 * reattach to an already-running tunnel without changing its URL (issue #48).
 */
export function getTunnelUrl(previewId: string): Promise<string | null> {
  return readTunnelUrl(containerName(previewId));
}
