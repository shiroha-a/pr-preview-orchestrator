import net from "node:net";

import { prisma } from "../db/client";
import { env } from "../env";

/** Check whether a TCP port is free to bind on the host. */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

/**
 * Allocate a free host port within the configured range, skipping ports already
 * recorded on existing preview environments.
 */
export async function allocateHostPort(): Promise<number> {
  const rows = await prisma.previewEnvironment.findMany({
    where: { hostPort: { not: null } },
    select: { hostPort: true },
  });
  const used = new Set(rows.map((r) => r.hostPort).filter((p): p is number => p != null));

  for (let port = env.PREVIEW_PORT_MIN; port <= env.PREVIEW_PORT_MAX; port += 1) {
    if (used.has(port)) continue;
    if (await isPortFree(port)) return port;
  }
  throw new Error("No free host port available in the configured range.");
}

// 並列ビルド時に同じポートを二重割り当てしないよう、確保処理を直列化する(issue #33)。
let portLock: Promise<unknown> = Promise.resolve();

/**
 * Allocate a free host port and immediately persist it on the preview row, so a
 * concurrent build sees it as taken. Reservations are serialized via a mutex to
 * avoid two parallel builds picking the same port (issue #33).
 */
export async function reserveHostPort(previewId: string): Promise<number> {
  const run = async () => {
    const port = await allocateHostPort();
    await prisma.previewEnvironment.update({ where: { id: previewId }, data: { hostPort: port } });
    return port;
  };
  const result = portLock.then(run, run);
  // 失敗しても後続の確保を止めない。
  portLock = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
