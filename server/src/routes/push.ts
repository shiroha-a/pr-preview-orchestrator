import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { prisma } from "../db/client";
import type { PrismaClient } from "../generated/prisma/client";
import {
  getVapidKeys,
  notifyAll,
  removeSubscription,
  saveSubscription,
  type SubscriptionInput,
} from "../push/service";

/** Web Push subscription management for build notifications (issue #77). */
export function createPushRoutes(p: PrismaClient = prisma) {
  const pushRoutes = new Hono();

  /** Public VAPID key for PushManager.subscribe(). Auto-generated on first use. */
  pushRoutes.get("/public-key", async (c) => {
    const keys = await getVapidKeys(p);
    return c.json({ publicKey: keys.publicKey });
  });

  /** Register (or refresh) the browser's push subscription. */
  pushRoutes.post("/subscribe", async (c) => {
    const body = await c.req.json<Partial<SubscriptionInput>>();
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      throw new HTTPException(400, { message: "invalid subscription" });
    }
    await saveSubscription(
      { endpoint: body.endpoint, keys: { p256dh: body.keys.p256dh, auth: body.keys.auth } },
      p,
    );
    return c.json({ ok: true });
  });

  /** Remove the browser's push subscription. */
  pushRoutes.post("/unsubscribe", async (c) => {
    const body = await c.req.json<{ endpoint?: string }>();
    if (!body.endpoint) throw new HTTPException(400, { message: "endpoint required" });
    await removeSubscription(body.endpoint, p);
    return c.json({ ok: true });
  });

  /** Send a test notification to every subscription (settings screen). */
  pushRoutes.post("/test", async (c) => {
    await notifyAll({ title: "テスト通知", body: "プッシュ通知は有効です。", url: "/settings" }, p);
    return c.json({ ok: true });
  });

  return pushRoutes;
}
