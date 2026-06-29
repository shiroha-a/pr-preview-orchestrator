import { type ChildProcess, spawn } from "node:child_process";

const tunnels = new Map<string, ChildProcess>();

const TRYCLOUDFLARE_URL = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

/**
 * Start a Cloudflare Quick Tunnel pointing at the given local port and resolve
 * with the public https://<random>.trycloudflare.com URL.
 *
 * The cloudflared process is kept alive and tracked by previewId so it can be
 * torn down later via {@link stopTunnel}. Rejects if cloudflared is missing or
 * no URL appears within the timeout.
 */
export function startTunnel(previewId: string, port: number): Promise<string> {
  // Replace any existing tunnel for this preview.
  stopTunnel(previewId);

  return new Promise((resolve, reject) => {
    const child = spawn("cloudflared", [
      "tunnel",
      "--url",
      `http://localhost:${port}`,
      "--no-autoupdate",
    ]);
    tunnels.set(previewId, child);

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Timed out waiting for Cloudflare tunnel URL"));
      }
    }, 30000);

    const handle = (buf: Buffer) => {
      const match = buf.toString().match(TRYCLOUDFLARE_URL);
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };

    // cloudflared prints the tunnel URL to stderr.
    child.stdout.on("data", handle);
    child.stderr.on("data", handle);
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
    child.on("close", () => {
      tunnels.delete(previewId);
    });
  });
}

/** Stop the Cloudflare tunnel associated with a preview, if any. */
export function stopTunnel(previewId: string): void {
  const child = tunnels.get(previewId);
  if (child) {
    child.kill();
    tunnels.delete(previewId);
  }
}

/** Whether a tunnel process is currently tracked (alive) for this preview. */
export function isTunnelAlive(previewId: string): boolean {
  return tunnels.has(previewId);
}
