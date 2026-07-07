import { invalidateDockerDiskUsageCache } from "./df";
import { runDocker } from "./run";

export type CleanupKind = "builder-prune";

/** Global cleanup state; queryable so the UI survives page reloads (issue #70). */
export interface CleanupStatus {
  running: { kind: CleanupKind; startedAt: string } | null;
  last: {
    kind: CleanupKind;
    ok: boolean;
    /** One-line human-readable result (e.g. "Total reclaimed space: 76GB"). */
    summary: string;
    error: string | null;
    startedAt: string;
    finishedAt: string;
  } | null;
}

// prune系は大量のキャッシュで数分かかりうる。出力が続く限り打ち切らないアイドル方式で、
// 無出力が30分続いたときだけ強制終了する。
const CLEANUP_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// クリーンアップ状態はインメモリのシングルトン。実行はHTTPリクエストから切り離される
// ため、ページをリロードしてもこの状態から進行中/直近結果を復元できる(issue #70)。
// サーバー再起動で消える(子プロセスも道連れになる)のは許容する。
let running: CleanupStatus["running"] = null;
let last: CleanupStatus["last"] = null;

export function getCleanupStatus(): CleanupStatus {
  return { running, last };
}

/** Start a cleanup task unless one is already running. Returns false when busy. */
function start(kind: CleanupKind, task: () => Promise<string>): boolean {
  if (running) return false;
  const startedAt = new Date().toISOString();
  running = { kind, startedAt };
  void (async () => {
    let summary = "";
    let error: string | null = null;
    try {
      summary = await task();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    last = {
      kind,
      ok: error === null,
      summary,
      error,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    running = null;
    // 次のディスク使用状況の取得に削除結果を反映させる。
    invalidateDockerDiskUsageCache();
  })();
  return true;
}

/** Last non-empty output line (docker prune prints "Total reclaimed space: X" last). */
function lastLine(output: string): string {
  return (
    output
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .pop() ?? ""
  );
}

/**
 * Prune the Docker build cache asynchronously. The HTTP handler only starts
 * the task; progress and the result are read back via getCleanupStatus so a
 * page reload does not lose them (issue #70).
 */
export function startBuilderPrune(): boolean {
  return start("builder-prune", async () => {
    const { code, output } = await runDocker(["builder", "prune", "-f"], {
      idleTimeoutMs: CLEANUP_IDLE_TIMEOUT_MS,
    });
    if (code !== 0) throw new Error(`docker builder prune failed: ${lastLine(output)}`);
    return lastLine(output) || "ビルドキャッシュを削除しました";
  });
}
