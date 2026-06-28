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
