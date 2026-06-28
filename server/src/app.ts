import { existsSync } from "node:fs";
import { join } from "node:path";

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { env, hasGitHubToken } from "./env";
import { previewRoutes } from "./routes/preview";
import { repositoriesRoutes } from "./routes/repositories";
import { webhookRoutes } from "./routes/webhook";

/** Build the Hono application with all routes mounted. */
export function createApp() {
  const app = new Hono();

  app.use("*", cors({ origin: env.WEB_ORIGIN, credentials: true }));

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/config", (c) =>
    c.json({
      tokenSet: hasGitHubToken(),
      webhookSecretSet: Boolean(env.GITHUB_WEBHOOK_SECRET),
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
  app.route("/api/github/webhook", webhookRoutes);

  // Serve the built web SPA in production (only when web/dist exists, so the
  // dev server is unaffected).
  if (existsSync(env.WEB_DIST_DIR)) {
    app.use("/*", serveStatic({ root: env.WEB_DIST_DIR }));
    // SPA fallback: non-file routes return index.html.
    app.get("*", serveStatic({ path: join(env.WEB_DIST_DIR, "index.html") }));
  }

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err.message ?? "Internal Server Error" }, 500);
  });

  return app;
}
