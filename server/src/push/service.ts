import webpush from "web-push";

import { prisma } from "../db/client";
import type { PrismaClient, PushSubscription } from "../generated/prisma/client";

/**
 * Web Push notifications for build completion (issue #77).
 *
 * The VAPID key pair is generated automatically on first use and persisted in
 * the database, so no manual configuration is required. Browsers subscribe via
 * the /api/push routes; the build worker calls notifyAll() when a build
 * finishes.
 */

// VAPID subject: a contact URL push services may use to reach the operator.
const VAPID_SUBJECT = "https://github.com/shiroha-a/pr-preview-orchestrator";

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** Load the persisted VAPID key pair, generating and saving one on first use. */
export async function getVapidKeys(p: PrismaClient = prisma): Promise<VapidKeys> {
  const existing = await p.webPushKeys.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return { publicKey: existing.publicKey, privateKey: existing.privateKey };
  const generated = webpush.generateVAPIDKeys();
  // 同時リクエストで二重生成した場合も、常に最古の1行を使うため実害はない。
  await p.webPushKeys.create({
    data: { publicKey: generated.publicKey, privateKey: generated.privateKey },
  });
  return generated;
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Register (or refresh) a browser push subscription, keyed by endpoint. */
export async function saveSubscription(
  input: SubscriptionInput,
  p: PrismaClient = prisma,
): Promise<void> {
  await p.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: { endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth },
    update: { p256dh: input.keys.p256dh, auth: input.keys.auth },
  });
}

/** Remove a push subscription by endpoint. Missing endpoints are ignored. */
export async function removeSubscription(
  endpoint: string,
  p: PrismaClient = prisma,
): Promise<void> {
  await p.pushSubscription.deleteMany({ where: { endpoint } });
}

/** Notification payload delivered to the service worker (web/public/sw.js). */
export interface PushPayload {
  title: string;
  body: string;
  /** App path to open when the notification is clicked (e.g. /repos/o/n/pull/1). */
  url: string;
}

/** Sender function, injectable for tests. Rejects with { statusCode } on failure. */
export type PushSender = (
  subscription: SubscriptionInput,
  payload: string,
  vapid: VapidKeys,
) => Promise<unknown>;

const defaultSender: PushSender = (subscription, payload, vapid) =>
  webpush.sendNotification(subscription, payload, {
    vapidDetails: { subject: VAPID_SUBJECT, ...vapid },
    TTL: 60 * 60,
  });

/**
 * Send a notification to every registered subscription. Subscriptions rejected
 * as gone (404/410) are deleted; other failures are logged only. Never throws,
 * so callers can fire-and-forget without affecting the build flow.
 */
export async function notifyAll(
  payload: PushPayload,
  p: PrismaClient = prisma,
  send: PushSender = defaultSender,
): Promise<void> {
  try {
    const subscriptions = await p.pushSubscription.findMany();
    if (subscriptions.length === 0) return;
    const vapid = await getVapidKeys(p);
    const body = JSON.stringify(payload);
    await Promise.all(
      subscriptions.map(async (sub: PushSubscription) => {
        try {
          await send(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
            vapid,
          );
        } catch (e) {
          const statusCode = (e as { statusCode?: number }).statusCode;
          // 404/410はプッシュサービス側で購読が失効している(ブラウザ削除等)。
          if (statusCode === 404 || statusCode === 410) {
            await p.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } });
          } else {
            console.error(`web push failed (${statusCode ?? "?"}): ${String(e)}`);
          }
        }
      }),
    );
  } catch (e) {
    console.error(`web push notify failed: ${String(e)}`);
  }
}
