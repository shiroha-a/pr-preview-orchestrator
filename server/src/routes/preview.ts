import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { prisma } from "../db/client";
import { enqueueJob } from "../jobs/queue";
import { subscribePreview } from "../preview/events";
import { cancelBuild, pruneBuilderCache } from "../preview/service";

export const previewRoutes = new Hono();

/** List all preview environments with their pull request and repository. */
previewRoutes.get("/", async (c) => {
  const previews = await prisma.previewEnvironment.findMany({
    include: { pullRequest: { include: { repository: true } }, repository: true },
    orderBy: { updatedAt: "desc" },
  });
  return c.json({ previews });
});

/** Prune the global Docker build cache to reclaim disk space (issue #20). */
previewRoutes.post("/builder-prune", async (c) => {
  try {
    const output = await pruneBuilderCache();
    return c.json({ output });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "ビルドキャッシュの削除に失敗しました" },
      500,
    );
  }
});

/** Fetch a single preview environment by id (PR or branch). */
previewRoutes.get("/:id", async (c) => {
  const preview = await prisma.previewEnvironment.findUnique({
    where: { id: c.req.param("id") },
  });
  if (!preview) return c.json({ error: "Preview not found" }, 404);
  return c.json({ preview });
});

/** Restart a preview's containers without rebuilding (by id; issue #25). */
previewRoutes.post("/:id/restart", async (c) => {
  const id = c.req.param("id");
  const preview = await prisma.previewEnvironment.findUnique({ where: { id } });
  if (!preview) return c.json({ error: "Preview not found" }, 404);
  // ボディは任意。再起動でも破棄オプションを適用する(issue #58)。
  const body = await c.req
    .json<{ resetVolumes?: boolean; resetTunnel?: boolean }>()
    .catch(() => ({}) as { resetVolumes?: boolean; resetTunnel?: boolean });
  const jobId = await enqueueJob("restart", {
    previewId: id,
    resetVolumes: body.resetVolumes === true,
    resetTunnel: body.resetTunnel === true,
  });
  return c.json({ jobId, previewId: id });
});

/** Stop a preview's containers without removing them (by id; issue #32). */
previewRoutes.post("/:id/stop", async (c) => {
  const id = c.req.param("id");
  const preview = await prisma.previewEnvironment.findUnique({ where: { id } });
  if (!preview) return c.json({ error: "Preview not found" }, 404);
  // ビルド中なら中断してワーカーを解放する(issue #33)。
  cancelBuild(id);
  const jobId = await enqueueJob("stop", { previewId: id });
  return c.json({ jobId, previewId: id });
});

/** Tear down a preview (by id; issue #25). */
previewRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const preview = await prisma.previewEnvironment.findUnique({ where: { id } });
  if (!preview) return c.json({ ok: true });
  // ビルド中なら中断してワーカーを解放する(issue #33)。
  cancelBuild(id);
  const jobId = await enqueueJob("destroy", { previewId: id });
  return c.json({ jobId });
});

/** SSE stream of build logs and status changes for a preview environment. */
previewRoutes.get("/:id/events", (c) => {
  const previewId = c.req.param("id");

  return streamSSE(c, async (stream) => {
    const preview = await prisma.previewEnvironment.findUnique({ where: { id: previewId } });
    if (preview) {
      await stream.writeSSE({
        event: "status",
        data: JSON.stringify({
          type: "status",
          status: preview.status,
          at: new Date().toISOString(),
        }),
      });
    }

    const unsubscribe = subscribePreview(previewId, (event) => {
      void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
    });

    stream.onAbort(() => unsubscribe());

    // Keep the connection open, sending a heartbeat periodically.
    while (!stream.aborted) {
      await stream.sleep(30000);
      if (stream.aborted) break;
      await stream.writeSSE({ event: "ping", data: "1" });
    }

    unsubscribe();
  });
});
