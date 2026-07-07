import { prisma } from "../db/client";
import { invalidateDockerDiskUsageCache } from "./df";
import {
  imageRemovalRefs,
  IMAGE_INSPECT_FORMAT,
  parseImageInspectLines,
  selectOrphanImages,
} from "./images";
import { runDocker } from "./run";

export type CleanupKind = "builder-prune" | "image-prune";

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
 *
 * With `all`, recently-used cache is removed too (`docker builder prune -a`);
 * the default prune keeps it and the disk fills up under frequent preview
 * builds (issue #69).
 */
export function startBuilderPrune(opts: { all: boolean }): boolean {
  return start("builder-prune", async () => {
    const args = ["builder", "prune", "-f", ...(opts.all ? ["-a"] : [])];
    const { code, output } = await runDocker(args, { idleTimeoutMs: CLEANUP_IDLE_TIMEOUT_MS });
    if (code !== 0) throw new Error(`docker builder prune failed: ${lastLine(output)}`);
    return lastLine(output) || "ビルドキャッシュを削除しました";
  });
}

/**
 * Remove images left behind by destroyed previews, then prune dangling images
 * (issue #67). Only images labeled with a `preview-*` compose project that has
 * no active preview are targeted, so other compose projects on the host are
 * untouched. Uses non-forced `docker rmi`, so anything still referenced by a
 * container is refused by docker and skipped.
 */
export function startImagePrune(): boolean {
  return start("image-prune", async () => {
    const ls = await runDocker(["images", "-aq", "--no-trunc"]);
    if (ls.code !== 0) throw new Error(`docker images failed: ${lastLine(ls.output)}`);
    const ids = [
      ...new Set(
        ls.output
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean),
      ),
    ];

    let removed = 0;
    let skipped = 0;
    if (ids.length > 0) {
      // 全イメージのid/composeプロジェクトラベル/タグを一括inspectする。一覧取得後に
      // 消えたidのエラー行は parseImageInspectLines が読み飛ばす。
      const inspect = await runDocker([
        "image",
        "inspect",
        "--format",
        IMAGE_INSPECT_FORMAT,
        ...ids,
      ]);
      const images = parseImageInspectLines(inspect.output.split(/\r?\n/));

      // 稼働中・一時停止中・ビルド中のプレビューのイメージは再開に必要なので残す。
      // stopped(破棄済み)/idle/failed は再ビルドで作り直せるため削除してよい。
      const activeRows = await prisma.previewEnvironment.findMany({
        where: { status: { notIn: ["stopped", "idle", "failed"] } },
        select: { composeProject: true },
      });
      const orphans = selectOrphanImages(
        images,
        activeRows.map((r) => r.composeProject),
      );

      for (const img of orphans) {
        const rmi = await runDocker(["rmi", ...imageRemovalRefs(img)], {
          idleTimeoutMs: CLEANUP_IDLE_TIMEOUT_MS,
        });
        if (rmi.code === 0) removed += 1;
        else skipped += 1;
      }
    }

    // 再ビルドで置き換えられた無タグの残骸(dangling)をホスト全体で削除する。
    const prune = await runDocker(["image", "prune", "-f"], {
      idleTimeoutMs: CLEANUP_IDLE_TIMEOUT_MS,
    });
    if (prune.code !== 0) throw new Error(`docker image prune failed: ${lastLine(prune.output)}`);

    const parts = [`プレビューイメージ${removed}件を削除`];
    if (skipped > 0) parts.push(`${skipped}件は使用中のためスキップ`);
    parts.push(`dangling: ${lastLine(prune.output) || "削除なし"}`);
    return parts.join(" / ");
  });
}
