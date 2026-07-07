import { Hono } from "hono";

import { getCleanupStatus, startBuilderPrune } from "../docker/cleanup";
import { getDockerDiskUsage } from "../docker/df";

export const dockerRoutes = new Hono();

/** Docker-wide disk usage, the `docker system df` equivalent (issue #68). */
dockerRoutes.get("/df", async (c) => {
  try {
    return c.json(await getDockerDiskUsage(c.req.query("refresh") === "1"));
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "ディスク使用状況の取得に失敗しました" },
      500,
    );
  }
});

/** Current/last cleanup state, kept server-side so reloads recover it (issue #70). */
dockerRoutes.get("/cleanup", (c) => c.json(getCleanupStatus()));

/** Start an asynchronous build-cache prune (issue #70). */
dockerRoutes.post("/cleanup/builder-prune", (c) => {
  if (!startBuilderPrune()) {
    return c.json({ error: "別のクリーンアップが実行中です", ...getCleanupStatus() }, 409);
  }
  return c.json(getCleanupStatus(), 202);
});
