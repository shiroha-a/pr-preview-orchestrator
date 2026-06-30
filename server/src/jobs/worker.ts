import { prisma } from "../db/client";
import { buildPreview, destroyPreview, restartPreview, stopPreview } from "../preview/service";

import type { JobPayload } from "./queue";

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

/** Process all queued jobs sequentially. Guarded so only one tick runs at a time. */
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const job = await prisma.job.findFirst({
        where: { status: "queued" },
        orderBy: { createdAt: "asc" },
      });
      if (!job) break;

      await prisma.job.update({
        where: { id: job.id },
        data: { status: "running", attempts: { increment: 1 } },
      });

      try {
        const payload = JSON.parse(job.payload) as JobPayload;
        if (job.type === "build") {
          await buildPreview(payload.previewId, payload.noCache);
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
  } finally {
    running = false;
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
  if (timer) return;
  timer = setInterval(() => void tick(), intervalMs);
  // eslint-disable-next-line no-console
  console.log("Job worker started");
}
