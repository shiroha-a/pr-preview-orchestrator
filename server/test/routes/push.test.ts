import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { Hono } from "hono";

import { createPushRoutes } from "../../src/routes/push";
import { notifyAll, type PushSender } from "../../src/push/service";
import { createTestPrisma, prepareSharedTestDb, truncateAll } from "../helpers";

const prisma = createTestPrisma();

beforeAll(() => {
  prepareSharedTestDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

function createApp() {
  const app = new Hono();
  app.route("/api/push", createPushRoutes(prisma));
  return app;
}

async function addSubscription(endpoint: string) {
  return prisma.pushSubscription.create({
    data: { endpoint, p256dh: "p256dh-key", auth: "auth-secret" },
  });
}

describe("GET /api/push/public-key", () => {
  it("初回アクセスでVAPIDキーを自動生成し、以降は同じキーを返す", async () => {
    const app = createApp();
    const first = await app.request("/api/push/public-key");
    expect(first.status).toBe(200);
    const { publicKey } = (await first.json()) as { publicKey: string };
    expect(publicKey.length).toBeGreaterThan(0);

    const second = await app.request("/api/push/public-key");
    expect(((await second.json()) as { publicKey: string }).publicKey).toBe(publicKey);
    expect(await prisma.webPushKeys.count()).toBe(1);
  });
});

describe("POST /api/push/subscribe", () => {
  it("購読を登録できる", async () => {
    const app = createApp();
    const res = await app.request("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify({
        endpoint: "https://push.example/ep1",
        keys: { p256dh: "k1", auth: "a1" },
      }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.pushSubscription.count()).toBe(1);
  });

  it("同じendpointは重複せずキーを更新する", async () => {
    const app = createApp();
    const subscribe = (auth: string) =>
      app.request("/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://push.example/ep1",
          keys: { p256dh: "k1", auth },
        }),
      });
    await subscribe("a1");
    await subscribe("a2");
    const subs = await prisma.pushSubscription.findMany();
    expect(subs).toHaveLength(1);
    expect(subs[0].auth).toBe("a2");
  });

  it("endpointやキーが欠けていれば400", async () => {
    const app = createApp();
    const res = await app.request("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: "https://push.example/ep1" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/push/unsubscribe", () => {
  it("購読を削除できる（未登録のendpointでも成功）", async () => {
    await addSubscription("https://push.example/ep1");
    const app = createApp();
    const res = await app.request("/api/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: "https://push.example/ep1" }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.pushSubscription.count()).toBe(0);

    const again = await app.request("/api/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: "https://push.example/ep1" }),
    });
    expect(again.status).toBe(200);
  });
});

describe("notifyAll", () => {
  it("全購読へペイロードを送信する", async () => {
    await addSubscription("https://push.example/ep1");
    await addSubscription("https://push.example/ep2");
    const sent: { endpoint: string; payload: string }[] = [];
    const send: PushSender = (sub, payload) => {
      sent.push({ endpoint: sub.endpoint, payload });
      return Promise.resolve();
    };

    await notifyAll({ title: "t", body: "b", url: "/x" }, prisma, send);

    expect(sent.map((s) => s.endpoint).sort()).toEqual([
      "https://push.example/ep1",
      "https://push.example/ep2",
    ]);
    expect(JSON.parse(sent[0].payload)).toEqual({ title: "t", body: "b", url: "/x" });
  });

  it("410で拒否された購読は削除し、他のエラーでは残す", async () => {
    await addSubscription("https://push.example/gone");
    await addSubscription("https://push.example/flaky");
    const send: PushSender = (sub) => {
      if (sub.endpoint.endsWith("/gone")) return Promise.reject({ statusCode: 410 });
      return Promise.reject({ statusCode: 500 });
    };

    await notifyAll({ title: "t", body: "b", url: "/x" }, prisma, send);

    const remaining = await prisma.pushSubscription.findMany();
    expect(remaining.map((s) => s.endpoint)).toEqual(["https://push.example/flaky"]);
  });

  it("購読が無ければ何もしない（キーも生成しない）", async () => {
    let called = false;
    const send: PushSender = () => {
      called = true;
      return Promise.resolve();
    };
    await notifyAll({ title: "t", body: "b", url: "/x" }, prisma, send);
    expect(called).toBe(false);
    expect(await prisma.webPushKeys.count()).toBe(0);
  });
});
