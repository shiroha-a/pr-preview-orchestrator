import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { Hono } from "hono";

import { dbBasicAuth, setCachedUserCount } from "../../src/auth/middleware";
import { hashPassword } from "../../src/auth/password";
import { basicAuthHeader, createTestPrisma, prepareSharedTestDb, truncateAll } from "../helpers";

const prisma = createTestPrisma();

beforeAll(() => {
  prepareSharedTestDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
  setCachedUserCount(null);
});

describe("dbBasicAuth", () => {
  it("ユーザー0件時は認証をスキップする", async () => {
    setCachedUserCount(0);
    const app = new Hono().use("*", dbBasicAuth(prisma)).get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("cachedUserCount=null時はDBを照合して認証を要求する（遅延初期化）", async () => {
    await prisma.user.create({
      data: { username: "admin", passwordHash: await hashPassword("pass") },
    });
    setCachedUserCount(null);

    const app = new Hono().use("*", dbBasicAuth(prisma)).get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe('Basic realm="Admin"');
  });

  it("正しい認証でnext()を呼び出す", async () => {
    await prisma.user.create({
      data: { username: "admin", passwordHash: await hashPassword("pass") },
    });
    setCachedUserCount(1);

    const app = new Hono()
      .use("*", dbBasicAuth(prisma))
      .get("/", (c) => c.json({ user: c.get("authUsername") }));
    const res = await app.request("/", {
      headers: { Authorization: basicAuthHeader("admin", "pass") },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: "admin" });
  });

  it("誤ったパスワードで401", async () => {
    await prisma.user.create({
      data: { username: "admin", passwordHash: await hashPassword("pass") },
    });
    setCachedUserCount(1);

    const app = new Hono().use("*", dbBasicAuth(prisma)).get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/", {
      headers: { Authorization: basicAuthHeader("admin", "wrong") },
    });
    expect(res.status).toBe(401);
  });

  it("存在しないユーザーでも401（ダミーハッシュによるタイミング攻撃対策）", async () => {
    await prisma.user.create({
      data: { username: "admin", passwordHash: await hashPassword("pass") },
    });
    setCachedUserCount(1);

    const app = new Hono().use("*", dbBasicAuth(prisma)).get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/", {
      headers: { Authorization: basicAuthHeader("nosuchuser", "pass") },
    });
    expect(res.status).toBe(401);
  });

  it("Authorizationヘッダーなしで401", async () => {
    await prisma.user.create({
      data: { username: "admin", passwordHash: await hashPassword("pass") },
    });
    setCachedUserCount(1);

    const app = new Hono().use("*", dbBasicAuth(prisma)).get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    expect(res.status).toBe(401);
  });
});
