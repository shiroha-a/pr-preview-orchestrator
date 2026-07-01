import { spawn } from "node:child_process";

import { env } from "../env";

/**
 * Cloudflare Quick Tunnels are run as **detached Docker containers** (not Node
 * child processes) so they survive a restart of the orchestrator app. When the
 * app is redeployed/restarted, the tunnel container keeps running and its
 * `https://<random>.trycloudflare.com` URL stays the same, so previews baking
 * that URL into their config do not break (issue #48).
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
 * Start a Cloudflare Quick Tunnel container pointing at the given local port and
 * resolve with the public https://<random>.trycloudflare.com URL.
 *
 * The container is detached and tracked by previewId (via its name) so it can be
 * torn down later via {@link stopTunnel} and, crucially, survives an app restart
 * (issue #48). Rejects if the container fails to start or no URL appears within
 * the timeout.
 */
export async function startTunnel(previewId: string, port: number): Promise<string> {
  const name = containerName(previewId);
  // Replace any existing tunnel container for this preview.
  await stopTunnel(previewId);

  // イメージの entrypoint が `cloudflared --no-autoupdate` のため、コマンド引数は
  // `tunnel --url ...` のみでよい。--network host でホストの localhost:port へ到達する。
  const run = await runDocker([
    "run",
    "-d",
    "--name",
    name,
    "--network",
    "host",
    "--restart",
    "unless-stopped",
    "--label",
    "pr-preview-orchestrator-tunnel=1",
    env.PREVIEW_TUNNEL_IMAGE,
    "tunnel",
    "--url",
    `http://localhost:${port}`,
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
