import { Readable } from "node:stream";

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { prisma } from "../db/client";
import { enqueueJob } from "../jobs/queue";
import { subscribePreview } from "../preview/events";
import { cancelBuild, pruneBuilderCache } from "../preview/service";
import {
  appendUploadChunk,
  createUploadSession,
  discardUploadSession,
  finishUploadSession,
  getUploadSession,
} from "../preview/uploads";
import {
  VOLUME_IN_USE_ERROR,
  exportVolumeStream,
  listComposeVolumes,
  runningContainersUsingVolume,
  volumeBelongsToProject,
} from "../preview/volumes";

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

// --- Volume export/import (issue #61) ---

/** Resolve the preview and verify the volume belongs to its compose project. */
async function findPreviewVolume(previewId: string, volume: string) {
  const preview = await prisma.previewEnvironment.findUnique({ where: { id: previewId } });
  if (!preview) return { error: "Preview not found", status: 404 as const, preview: null };
  if (!(await volumeBelongsToProject(volume, preview.composeProject))) {
    return { error: "ボリュームが見つかりません", status: 404 as const, preview: null };
  }
  return { error: null, status: 200 as const, preview };
}

/** List the docker volumes of a preview's compose project. */
previewRoutes.get("/:id/volumes", async (c) => {
  const preview = await prisma.previewEnvironment.findUnique({
    where: { id: c.req.param("id") },
  });
  if (!preview) return c.json({ error: "Preview not found" }, 404);
  try {
    const volumes = await listComposeVolumes(preview.composeProject);
    return c.json({ volumes });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "ボリューム一覧の取得に失敗しました" },
      500,
    );
  }
});

/** Download a volume's contents as a tar.gz stream. */
previewRoutes.get("/:id/volumes/:volume/export", async (c) => {
  const volume = c.req.param("volume");
  const found = await findPreviewVolume(c.req.param("id"), volume);
  if (found.error) return c.json({ error: found.error }, found.status);

  const stream = exportVolumeStream(volume);
  // クライアント切断時にヘルパーコンテナのdockerプロセスを止める。
  c.req.raw.signal.addEventListener("abort", () => stream.kill(), { once: true });
  return c.body(Readable.toWeb(stream.stdout) as ReadableStream, 200, {
    "Content-Type": "application/gzip",
    "Content-Disposition": `attachment; filename="${volume}.tar.gz"`,
  });
});

/**
 * Begin a chunked archive upload for a volume import. Chunked because the
 * orchestrator is served through Cloudflare, whose request body size limit
 * rejects large single-request uploads (issue #61).
 */
previewRoutes.post("/:id/volumes/:volume/import/start", async (c) => {
  const id = c.req.param("id");
  const volume = c.req.param("volume");
  const found = await findPreviewVolume(id, volume);
  if (found.error) return c.json({ error: found.error }, found.status);

  // アップロードしてから失敗させない: 使用中コンテナの確認は開始時に行う。
  const users = await runningContainersUsingVolume(volume);
  if (users.length > 0) return c.json({ error: VOLUME_IN_USE_ERROR }, 409);

  const body = await c.req
    .json<{ totalChunks?: number; totalSize?: number }>()
    .catch(() => ({}) as { totalChunks?: number; totalSize?: number });
  const { totalChunks, totalSize } = body;
  if (
    !Number.isInteger(totalChunks) ||
    totalChunks! < 1 ||
    !Number.isInteger(totalSize) ||
    totalSize! < 1
  ) {
    return c.json({ error: "totalChunks と totalSize(1以上の整数)を指定してください" }, 400);
  }
  const session = await createUploadSession({
    previewId: id,
    volume,
    totalChunks: totalChunks!,
    totalSize: totalSize!,
  });
  return c.json({ uploadId: session.id });
});

/** Receive one binary chunk (sequential, starting at index 0). */
previewRoutes.post("/:id/volumes/:volume/import/:uploadId/chunk/:index", async (c) => {
  const uploadId = c.req.param("uploadId");
  const index = Number(c.req.param("index"));
  const session = getUploadSession(uploadId);
  if (
    !session ||
    session.previewId !== c.req.param("id") ||
    session.volume !== c.req.param("volume")
  ) {
    return c.json(
      { error: "アップロードセッションがありません。最初からやり直してください。" },
      404,
    );
  }
  if (!Number.isInteger(index) || index < 0) {
    return c.json({ error: "チャンク番号が不正です" }, 400);
  }
  try {
    const data = Buffer.from(await c.req.arrayBuffer());
    const updated = await appendUploadChunk(uploadId, index, data);
    return c.json({ received: updated.received, bytes: updated.bytes });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "チャンクの受信に失敗しました" }, 400);
  }
});

/** Validate the completed upload and enqueue the import job. */
previewRoutes.post("/:id/volumes/:volume/import/:uploadId/finish", async (c) => {
  const id = c.req.param("id");
  const volume = c.req.param("volume");
  const uploadId = c.req.param("uploadId");
  const session = getUploadSession(uploadId);
  if (!session || session.previewId !== id || session.volume !== volume) {
    return c.json(
      { error: "アップロードセッションがありません。最初からやり直してください。" },
      404,
    );
  }
  try {
    const completed = finishUploadSession(uploadId);
    // 復元はジョブとして実行する: CF経由の長時間リクエストを避け、進捗は既存の
    // SSEログで配信する。同一preview宛ジョブはワーカーが直列化する。
    const jobId = await enqueueJob("volume-import", {
      previewId: id,
      volume,
      uploadPath: completed.path,
    });
    return c.json({ jobId, previewId: id });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "インポートの開始に失敗しました" },
      400,
    );
  }
});

/** Abort an in-flight upload and delete its staging file. */
previewRoutes.delete("/:id/volumes/:volume/import/:uploadId", async (c) => {
  const uploadId = c.req.param("uploadId");
  const session = getUploadSession(uploadId);
  if (
    session &&
    session.previewId === c.req.param("id") &&
    session.volume === c.req.param("volume")
  ) {
    await discardUploadSession(uploadId);
  }
  return c.json({ ok: true });
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
