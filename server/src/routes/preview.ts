import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { prisma } from "../db/client";
import { subscribePreview } from "../preview/events";
import { pruneBuilderCache } from "../preview/service";

export const previewRoutes = new Hono();

/** List all preview environments with their pull request and repository. */
previewRoutes.get("/", async (c) => {
  const previews = await prisma.previewEnvironment.findMany({
    include: { pullRequest: { include: { repository: true } } },
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
