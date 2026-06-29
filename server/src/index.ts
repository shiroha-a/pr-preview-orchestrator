import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { env } from "./env";
import { seedAdminUser } from "./db/seed";
import { startWorker } from "./jobs/worker";

async function main() {
  await seedAdminUser();

  const app = createApp();

  serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`API server listening on http://localhost:${info.port}`);
  });

  void startWorker();
}

void main();
