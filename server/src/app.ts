import { existsSync } from "node:fs";
import { join } from "node:path";

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import { env, hasAdminAuth, hasGitHubToken } from "./env";
import { metricsRoutes } from "./routes/metrics";
import { previewRoutes } from "./routes/preview";
import { repositoriesRoutes } from "./routes/repositories";
import { webhookRoutes } from "./routes/webhook";

/** Build the Hono application with all routes mounted. */
export function createApp() {
  const app = new Hono();

  app.use("*", cors({ origin: env.WEB_ORIGIN, credentials: true }));

  // --- Public endpoints (registered before basic-auth so they are exempt) ---
  app.get("/api/health", (c) => c.json({ ok: true }));
  // GitHub webhooks authenticate via HMAC signature, not basic auth.
  app.route("/api/github/webhook", webhookRoutes);

  // --- Admin basic-auth: protects everything below when configured ---
  if (hasAdminAuth()) {
    app.use(
      "*",
      basicAuth({
        username: env.ADMIN_USER as string,
        password: env.ADMIN_PASSWORD as string,
      }),
    );
  }

  app.get("/api/config", (c) =>
    c.json({
      tokenSet: hasGitHubToken(),
      webhookSecretSet: Boolean(env.GITHUB_WEBHOOK_SECRET),
      adminAuthEnabled: hasAdminAuth(),
      preview: {
        host: env.PREVIEW_HOST,
        portMin: env.PREVIEW_PORT_MIN,
        portMax: env.PREVIEW_PORT_MAX,
        workspacesDir: env.WORKSPACES_DIR,
        tunnel: env.PREVIEW_TUNNEL,
      },
    }),
  );

  app.route("/api/repositories", repositoriesRoutes);
  app.route("/api/preview", previewRoutes);
  app.route("/api/metrics", metricsRoutes);

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
