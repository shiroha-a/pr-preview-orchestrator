import { prisma } from "../db/client";
import { env } from "../env";
import {
  buildPreview,
  destroyPreview,
  reattachRunningPreviews,
  restartPreview,
  stopPreview,
} from "../preview/service";

import type { JobPayload } from "./queue";

let timer: ReturnType<typeof setInterval> | null = null;

// 並列実行中のジョブ数と、処理中の previewId 集合(同一previewへの並行操作を防ぐ。issue #33)。
let activeJobs = 0;
const inFlightPreviews = new Set<string>();

interface QueuedJob {
  id: string;
  type: string;
  payload: string;
}

function previewIdOf(job: QueuedJob): string | null {
  try {
    return (JSON.parse(job.payload) as JobPayload).previewId ?? null;
  } catch {
    return null;
  }
}

/** Dispatch a claimed job to the matching preview operation and record the result. */
async function processJob(job: QueuedJob): Promise<void> {
  try {
    const payload = JSON.parse(job.payload) as JobPayload;
    if (job.type === "build") {
      await buildPreview(payload.previewId, {
        noCache: payload.noCache,
        resetVolumes: payload.resetVolumes,
        keepTunnel: payload.keepTunnel,
      });
    } else if (job.type === "destroy") {
      await destroyPreview(payload.previewId);
    } else if (job.type === "restart") {
      await restartPreview(payload.previewId);
    } else if (job.type === "stop") {
      await stopPreview(payload.previewId);
    }
    await prisma.job.update({ where: { id: job.id }, data: { status: "done", error: null } });
  } catch (e) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "failed", error: e instanceof Error ? e.message : String(e) },
    });
  }
}

/**
 * Claim queued jobs and run them in parallel up to PREVIEW_JOB_CONCURRENCY.
 * Jobs for different previews run concurrently; jobs targeting the same preview
 * are serialized so a build and its stop/destroy don't race (issue #33).
 */
async function tick(): Promise<void> {
  try {
    if (activeJobs >= env.PREVIEW_JOB_CONCURRENCY) return;

    // queued 全件を createdAt 順で取得する。take で打ち切ると、先頭が処理中preview宛で
    // 埋まったとき後続の別previewジョブが永久に着手されない(head-of-lineスタベーション)。
    const candidates: QueuedJob[] = await prisma.job.findMany({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      select: { id: true, type: true, payload: true },
    });

    for (const job of candidates) {
      if (activeJobs >= env.PREVIEW_JOB_CONCURRENCY) break;
      const previewId = previewIdOf(job);
      // payload不正(previewId欠落)のジョブはスタックしないよう失敗にする。
      if (!previewId) {
        void prisma.job.updateMany({
          where: { id: job.id, status: "queued" },
          data: { status: "failed", error: "invalid payload: missing previewId" },
        });
        continue;
      }
      if (inFlightPreviews.has(previewId)) continue;

      // previewId を同期的に予約してから claim する(同tick/重複tickでの二重取得を防ぐ)。
      inFlightPreviews.add(previewId);
      activeJobs += 1;
      void (async () => {
        try {
          // 別のtickが先に取得していないか、status=queued の行だけを running に更新する。
          const claimed = await prisma.job.updateMany({
            where: { id: job.id, status: "queued" },
            data: { status: "running", attempts: { increment: 1 } },
          });
          if (claimed.count === 0) return;
          await processJob(job);
        } finally {
          activeJobs -= 1;
          inFlightPreviews.delete(previewId);
        }
      })();
    }
  } catch {
    // 一時的なDBエラーは無視(次tickで回復)。unhandled rejection を防ぐ。
  }
}

/** Start the in-process job worker (DB polling). */
export async function startWorker(intervalMs = 1500): Promise<void> {
  // Recover jobs left "running" by a previous crash by requeueing them.
  await prisma.job.updateMany({ where: { status: "running" }, data: { status: "queued" } });

  // Mark previews that were in flight when the server stopped as failed
  // (their build/clone processes no longer exist after a restart).
  await prisma.previewEnvironment.updateMany({
    where: { status: { in: ["pending", "cloning", "building", "stopping"] } },
    data: { status: "failed" },
  });

  // running な preview はコンテナは生きているがCFトンネルが切れているので張り直す。
  // 起動をブロックしないよう fire-and-forget で実行する。
  void reattachRunningPreviews();

  if (timer) return;
  timer = setInterval(() => void tick(), intervalMs);
  // eslint-disable-next-line no-console
  console.log("Job worker started");
}
