import { runDocker } from "./run";

export type DockerDfType = "images" | "containers" | "volumes" | "buildCache";

/** One row of `docker system df` (issue #68). */
export interface DockerDfRow {
  type: DockerDfType;
  totalCount: number;
  active: number;
  sizeBytes: number;
  reclaimableBytes: number;
}

export interface DockerDiskUsage {
  rows: DockerDfRow[];
  fetchedAt: string;
}

/** Map `docker system df` type names to stable keys for the API. */
const TYPE_KEYS: Record<string, DockerDfType> = {
  Images: "images",
  Containers: "containers",
  "Local Volumes": "volumes",
  "Build Cache": "buildCache",
};

/**
 * Parse a docker CLI human-readable size ("78.14GB", "930.5kB", "0B") into
 * bytes. Docker prints decimal units here (kB=1000), unlike `docker stats`.
 */
export function parseDockerSize(value: string): number {
  const m = String(value)
    .trim()
    .match(/^([\d.]+)\s*([A-Za-z]+)/);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const mult: Record<string, number> = {
    b: 1,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
    tb: 1000 ** 4,
    pb: 1000 ** 5,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
    pib: 1024 ** 5,
  };
  return Number.isFinite(val) ? Math.round(val * (mult[m[2].toLowerCase()] ?? 1)) : 0;
}

/** Parse `docker system df --format "{{json .}}"` output lines into rows. */
export function parseSystemDf(lines: string[]): DockerDfRow[] {
  const rows: DockerDfRow[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let j: Record<string, string>;
    try {
      j = JSON.parse(line) as Record<string, string>;
    } catch {
      // JSONでない行(警告など)はスキップする。
      continue;
    }
    const type = TYPE_KEYS[j.Type ?? ""];
    if (!type) continue;
    rows.push({
      type,
      totalCount: Number(j.TotalCount) || 0,
      active: Number(j.Active) || 0,
      sizeBytes: parseDockerSize(j.Size ?? ""),
      // Reclaimable は "78.14GB (40%)" 形式のため先頭のサイズ部分だけを読む。
      reclaimableBytes: parseDockerSize(j.Reclaimable ?? ""),
    });
  }
  return rows;
}

// docker system df はイメージ・ボリュームの走査で数秒かかることがあるため、
// 短いTTLでキャッシュし、同時リクエストは1回の実行に相乗りさせる。
const DF_CACHE_TTL_MS = 15_000;
let cached: DockerDiskUsage | null = null;
let inFlight: Promise<DockerDiskUsage> | null = null;

/** Drop the cache so the next read reflects a just-finished cleanup. */
export function invalidateDockerDiskUsageCache(): void {
  cached = null;
}

/** Docker-wide disk usage, the `docker system df` equivalent (issue #68). */
export async function getDockerDiskUsage(refresh = false): Promise<DockerDiskUsage> {
  if (!refresh && cached && Date.now() - Date.parse(cached.fetchedAt) < DF_CACHE_TTL_MS) {
    return cached;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { code, output } = await runDocker(["system", "df", "--format", "{{json .}}"], {
        idleTimeoutMs: 60_000,
      });
      if (code !== 0) {
        throw new Error(`docker system df failed: ${output.trim().slice(0, 200)}`);
      }
      const usage: DockerDiskUsage = {
        rows: parseSystemDf(output.split(/\r?\n/)),
        fetchedAt: new Date().toISOString(),
      };
      cached = usage;
      return usage;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
