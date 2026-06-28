import { Hono } from "hono";
import { cors } from "hono/cors";

import { env, hasGitHubAppCredentials } from "./env";
import { previewRoutes } from "./routes/preview";
import { repositoriesRoutes } from "./routes/repositories";

/** Build the Hono application with all routes mounted. */
export function createApp() {
  const app = new Hono();

  app.use("*", cors({ origin: env.WEB_ORIGIN, credentials: true }));

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/config", (c) =>
    c.json({
      githubReady: hasGitHubAppCredentials(),
      github: {
        appIdSet: Boolean(env.GITHUB_APP_ID),
        privateKeySet: Boolean(env.GITHUB_APP_PRIVATE_KEY),
        webhookSecretSet: Boolean(env.GITHUB_WEBHOOK_SECRET),
      },
      preview: {
        host: env.PREVIEW_HOST,
        portMin: env.PREVIEW_PORT_MIN,
        portMax: env.PREVIEW_PORT_MAX,
        workspacesDir: env.WORKSPACES_DIR,
      },
    }),
  );

  app.route("/api/repositories", repositoriesRoutes);
  app.route("/api/preview", previewRoutes);

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err.message ?? "Internal Server Error" }, 500);
  });

  return app;
}
