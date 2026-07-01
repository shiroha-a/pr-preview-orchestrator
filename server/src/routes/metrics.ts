import { spawn } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import os from "node:os";

import { Hono } from "hono";

export const metricsRoutes = new Hono();

/**
 * Host swap usage from /proc/meminfo (Linux). Returns zeros when unavailable
 * (non-Linux or no swap configured).
 */
async function readSwap(): Promise<{ total: number; used: number; free: number }> {
  try {
    const content = await readFile("/proc/meminfo", "utf-8");
    const totalKb = Number(content.match(/^SwapTotal:\s+(\d+)/m)?.[1] ?? 0);
    const freeKb = Number(content.match(/^SwapFree:\s+(\d+)/m)?.[1] ?? 0);
    const total = totalKb * 1024;
    const free = freeKb * 1024;
    return { total, used: total - free, free };
  } catch {
    return { total: 0, used: 0, free: 0 };
  }
}

interface ContainerStat {
  name: string;
  cpu: string;
  mem: string;
  memUsage: string;
}

/** Collect `docker stats` for preview containers (best-effort; empty on failure). */
function dockerStats(): Promise<ContainerStat[]> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["stats", "--no-stream", "--format", "{{json .}}"]);
    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.on("error", () => resolve([]));
    child.on("close", () => {
      const stats: ContainerStat[] = [];
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line) as Record<string, string>;
          // Limit to preview containers (compose project名が preview- で始まる)。
          if (typeof j.Name === "string" && j.Name.startsWith("preview-")) {
            stats.push({
              name: j.Name,
              cpu: j.CPUPerc ?? "",
              mem: j.MemPerc ?? "",
              memUsage: j.MemUsage ?? "",
            });
          }
        } catch {
          // skip malformed line
        }
      }
      resolve(stats);
    });
  });
}

/** Host memory / disk usage, load average, and per-container stats. */
metricsRoutes.get("/", async (c) => {
  const memTotal = os.totalmem();
  const memFree = os.freemem();

  let disk = { total: 0, used: 0, free: 0 };
  try {
    const s = await statfs("/");
    const blockSize = Number(s.bsize);
    const total = Number(s.blocks) * blockSize;
    const free = Number(s.bavail) * blockSize;
    const used = total - Number(s.bfree) * blockSize;
    disk = { total, used, free };
  } catch {
    // statfs に失敗した場合は 0 のまま返す。
  }

  const swap = await readSwap();
  const containers = await dockerStats();

  return c.json({
    memory: { total: memTotal, used: memTotal - memFree, free: memFree },
    swap,
    disk,
    loadavg: os.loadavg(),
    containers,
  });
});
