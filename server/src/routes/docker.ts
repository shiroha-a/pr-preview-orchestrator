import { Hono } from "hono";

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
