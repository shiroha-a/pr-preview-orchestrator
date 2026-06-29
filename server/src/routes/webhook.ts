import { type EmitterWebhookEventName, Webhooks } from "@octokit/webhooks";
import { Hono } from "hono";

import { prisma } from "../db/client";
import { env } from "../env";
import { fetchAndCachePullRequest } from "../github/pulls";
import { enqueueJob } from "../jobs/queue";

export const webhookRoutes = new Hono();

const webhooks = env.GITHUB_WEBHOOK_SECRET
  ? new Webhooks({ secret: env.GITHUB_WEBHOOK_SECRET })
  : null;

// Preview states considered "live" (anything but idle/stopped) for rebuild/teardown.
const ACTIVE_STATUSES = ["pending", "cloning", "building", "running", "failed"];

if (webhooks) {
  webhooks.on("pull_request", async ({ payload }) => {
    const action = payload.action;
    const owner = payload.repository.owner.login;
    const name = payload.repository.name;
    const number = payload.pull_request.number;

    // Only act on repositories the orchestrator already tracks.
    const repo = await prisma.repository.findUnique({
      where: { owner_name: { owner, name } },
    });
    if (!repo) return;

    // Refresh the cached pull request.
    if (["opened", "reopened", "synchronize", "edited"].includes(action)) {
      try {
        await fetchAndCachePullRequest(repo, number);
      } catch {
        // Ignore fetch failures; the webhook should still succeed.
      }
    }

    const pr = await prisma.pullRequest.findUnique({
      where: { repositoryId_number: { repositoryId: repo.id, number } },
    });
    if (!pr) return;

    const preview = await prisma.previewEnvironment.findUnique({
      where: { pullRequestId: pr.id },
    });

    // New push: rebuild the preview if one is live.
    if (action === "synchronize" && preview && ACTIVE_STATUSES.includes(preview.status)) {
      await enqueueJob("build", { previewId: preview.id });
    }

    // PR closed/merged: tear the preview down.
    if (action === "closed" && preview && preview.status !== "stopped") {
      await enqueueJob("destroy", { previewId: preview.id });
    }
  });
}

webhookRoutes.post("/", async (c) => {
  if (!webhooks) {
    return c.json({ error: "Webhook secret (GITHUB_WEBHOOK_SECRET) is not configured" }, 503);
  }

  const id = c.req.header("x-github-delivery");
  const name = c.req.header("x-github-event");
  const signature = c.req.header("x-hub-signature-256");
  if (!id || !name || !signature) {
    return c.json({ error: "Missing required webhook headers" }, 400);
  }

  const body = await c.req.text();
  try {
    await webhooks.verifyAndReceive({
      id,
      name: name as EmitterWebhookEventName,
      signature,
      payload: body,
    });
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "Invalid signature or processing error" }, 401);
  }
});
