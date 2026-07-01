import { spawn } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import os from "node:os";

import { Hono } from "hono";

import { prisma } from "../db/client";

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

interface RawContainerStat {
  name: string;
  cpu: number; // percent
  memBytes: number; // used memory in bytes
}

/** "1.78%" -> 1.78(不正値は 0)。 */
function parseCpu(s: string): number {
  const v = parseFloat(String(s).replace("%", ""));
  return Number.isFinite(v) ? v : 0;
}

/** "859.5MiB" -> バイト数(docker は 1024 基数の *iB 単位を使う)。 */
function parseBytes(s: string): number {
  const m = String(s)
    .trim()
    .match(/^([\d.]+)\s*([A-Za-z]+)$/);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const mult: Record<string, number> = {
    b: 1,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
    tb: 1000 ** 4,
  };
  return Number.isFinite(val) ? val * (mult[m[2].toLowerCase()] ?? 1) : 0;
}

/** Collect `docker stats` for preview containers (best-effort; empty on failure). */
function dockerStats(): Promise<RawContainerStat[]> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["stats", "--no-stream", "--format", "{{json .}}"]);
    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.on("error", () => resolve([]));
    child.on("close", () => {
      const stats: RawContainerStat[] = [];
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line) as Record<string, string>;
          // Limit to preview containers (compose project名が preview- で始まる)。
          if (typeof j.Name === "string" && j.Name.startsWith("preview-")) {
            stats.push({
              name: j.Name,
              cpu: parseCpu(j.CPUPerc ?? ""),
              // MemUsage は "used / limit"。used 部分のみをバイトに変換する。
              memBytes: parseBytes((j.MemUsage ?? "").split("/")[0] ?? ""),
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

/** Per-preview aggregated resource usage(プレビュー単位のCPU/メモリ合計)。 */
interface PreviewUsage {
  label: string;
  cpu: number;
  memBytes: number;
  containers: number;
}

/**
 * Aggregate docker stats per preview (compose project). Each preview's
 * containers (app/db/redis 等)を合算し、システム最大メモリの繰り返し表示をやめる。
 */
async function previewUsage(): Promise<PreviewUsage[]> {
  const raw = await dockerStats();
  if (raw.length === 0) return [];

  const previews = await prisma.previewEnvironment.findMany({
    include: { pullRequest: { include: { repository: true } }, repository: true },
  });

  const result: PreviewUsage[] = [];
  for (const p of previews) {
    const proj = p.composeProject;
    // コンテナ名は "<project>-<service>-<index>"。プロジェクト名+区切りで前方一致させる。
    const mine = raw.filter((s) => s.name.startsWith(`${proj}-`) || s.name.startsWith(`${proj}_`));
    if (mine.length === 0) continue;

    const repo = p.pullRequest?.repository ?? p.repository;
    let label = proj;
    if (p.pullRequest && repo) label = `${repo.owner}/${repo.name} #${p.pullRequest.number}`;
    else if (repo && p.branchRef) label = `${repo.owner}/${repo.name} @${p.branchRef}`;

    result.push({
      label,
      cpu: mine.reduce((a, s) => a + s.cpu, 0),
      memBytes: mine.reduce((a, s) => a + s.memBytes, 0),
      containers: mine.length,
    });
  }
  result.sort((a, b) => b.memBytes - a.memBytes);
  return result;
}

/** Host memory / disk / swap usage, load average, and per-preview stats. */
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
  const previews = await previewUsage();

  return c.json({
    memory: { total: memTotal, used: memTotal - memFree, free: memFree },
    swap,
    disk,
    loadavg: os.loadavg(),
    previews,
  });
});
