import { env } from "./env";

async function main() {
  // agentモードはDB/HTTPサーバー/WebUIを一切持たないため、オーケストレーター側の
  // モジュール(Prisma等)を読み込まないよう動的importで分岐する(issue #80)。
  if (env.SERVER_MODE === "agent") {
    const { runAgent } = await import("./agent/main");
    await runAgent();
    return;
  }

  const [{ serve }, { createApp }, { syncAdminUser }, { initAuthCache }, { startWorker }] =
    await Promise.all([
      import("@hono/node-server"),
      import("./app"),
      import("./db/seed"),
      import("./auth/middleware"),
      import("./jobs/worker"),
    ]);

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
