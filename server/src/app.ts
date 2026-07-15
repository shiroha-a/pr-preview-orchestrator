import { existsSync } from "node:fs";
import { join } from "node:path";

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import { dbBasicAuth, getCachedUserCount } from "./auth/middleware";
import { env, hasGitHubToken } from "./env";
import { agentGatewayRoutes, agentsAdminRoutes } from "./routes/agents";
import { dockerRoutes } from "./routes/docker";
import { metricsRoutes } from "./routes/metrics";
import { previewRoutes } from "./routes/preview";
import { createPushRoutes } from "./routes/push";
import { repositoriesRoutes } from "./routes/repositories";
import { createUsersRoutes } from "./routes/users";
import { webhookRoutes } from "./routes/webhook";

/** Build the Hono application with all routes mounted. */
export function createApp() {
  const app = new Hono();

  app.use("*", cors({ origin: env.WEB_ORIGIN, credentials: true }));

  // --- Public endpoints (registered before basic-auth so they are exempt) ---
  app.get("/api/health", (c) => c.json({ ok: true }));
  // GitHub webhooks authenticate via HMAC signature, not basic auth.
  app.route("/api/github/webhook", webhookRoutes);
  // Build agents authenticate with their own bearer token (issue #80).
  app.route("/api/agent", agentGatewayRoutes);

  // --- Admin basic-auth: protects everything below when configured ---
  app.use("*", dbBasicAuth());

  app.get("/api/config", (c) =>
    c.json({
      tokenSet: hasGitHubToken(),
      webhookSecretSet: Boolean(env.GITHUB_WEBHOOK_SECRET),
      adminAuthEnabled: getCachedUserCount() > 0,
      preview: {
        host: env.PREVIEW_HOST,
        portMin: env.PREVIEW_PORT_MIN,
        portMax: env.PREVIEW_PORT_MAX,
        workspacesDir: env.WORKSPACES_DIR,
        tunnel: env.PREVIEW_TUNNEL,
      },
      // 外部ビルドサーバーの既定モード(issue #80)。設定画面の表示に使う。
      buildModeDefault: env.BUILD_MODE_DEFAULT,
    }),
  );

  app.route("/api/repositories", repositoriesRoutes);
  // 外部ビルドサーバーの管理(issue #80)。
  app.route("/api/agents", agentsAdminRoutes);
  app.route("/api/preview", previewRoutes);
  app.route("/api/metrics", metricsRoutes);
  app.route("/api/docker", dockerRoutes);
  app.route("/api/users", createUsersRoutes());
  // ビルド完了のWebプッシュ通知(issue #77)。
  app.route("/api/push", createPushRoutes());

  // Serve the built web SPA in production (only when web/dist exists, so the
  // dev server is unaffected).
  if (existsSync(env.WEB_DIST_DIR)) {
    app.use("/*", serveStatic({ root: env.WEB_DIST_DIR }));
    // SPA fallback: non-file routes return index.html.
    app.get("*", serveStatic({ path: join(env.WEB_DIST_DIR, "index.html") }));
  }

  app.onError((err, c) => {
    // Preserve HTTP exceptions (e.g. 401 from basic-auth) instead of masking
    // them as 500.
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    console.error(err);
    return c.json({ error: err.message ?? "Internal Server Error" }, 500);
  });

  return app;
}
