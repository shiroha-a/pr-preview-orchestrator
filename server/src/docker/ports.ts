import { runDocker } from "./run";

/**
 * Parse the host ports published by containers out of the lines printed by
 * `docker ps --format "{{.Ports}}"`.
 *
 * Each line is a comma-separated list for one container, e.g.
 * `0.0.0.0:13000->3000/tcp, [::]:13000->3000/tcp`, and may publish a range
 * (`0.0.0.0:13000-13005->3000-3005/tcp`). Entries without `->` are only exposed,
 * not published, and are ignored.
 */
export function parsePublishedPorts(lines: string[]): Set<number> {
  const ports = new Set<number>();
  for (const line of lines) {
    for (const entry of line.split(",")) {
      // ホスト側は "<ip>:<port>[-<port>]->" の形。IPv6は "[::]:13000->" と表記される。
      const m = entry.match(/:(\d+)(?:-(\d+))?->/);
      if (!m) continue;
      const from = Number(m[1]);
      const to = m[2] ? Number(m[2]) : from;
      // 壊れた出力で巨大ループを回さないよう、ポート番号の範囲で弾く。
      if (!Number.isInteger(from) || !Number.isInteger(to)) continue;
      if (from < 1 || to > 65535 || to < from) continue;
      for (let port = from; port <= to; port += 1) ports.add(port);
    }
  }
  return ports;
}

/**
 * Host ports currently published by containers on the docker daemon.
 *
 * Best effort: an empty set is returned when the docker CLI is missing or the
 * command fails, so port allocation simply falls back to the local bind check.
 */
export async function listPublishedHostPorts(): Promise<Set<number>> {
  const { code, output } = await runDocker(["ps", "--format", "{{.Ports}}"], {
    idleTimeoutMs: 15000,
  });
  if (code !== 0) return new Set();
  return parsePublishedPorts(output.split("\n"));
}
