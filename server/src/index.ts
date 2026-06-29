import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { env } from "./env";
import { syncAdminUser } from "./db/seed";
import { initAuthCache } from "./auth/middleware";
import { startWorker } from "./jobs/worker";

async function main() {
  await initAuthCache();
  await syncAdminUser();

  const app = createApp();

  serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`API server listening on http://localhost:${info.port}`);
  });

  void startWorker();
}

void main();
