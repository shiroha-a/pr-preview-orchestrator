import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { Hono } from "hono";

import { createUsersRoutes } from "../../src/routes/users";
import { hashPassword } from "../../src/auth/password";
import { setCachedUserCount, dbBasicAuth } from "../../src/auth/middleware";
import {
  basicAuthHeader,
  createTestPrisma,
  setupTestDb,
  truncateAll,
  cleanupTestDb,
} from "../helpers";

const prisma = createTestPrisma();

beforeAll(() => {
  setupTestDb();
});

afterAll(() => {
  cleanupTestDb();
});

beforeEach(async () => {
  await truncateAll(prisma);
  setCachedUserCount(null);
});

function createApp() {
  const app = new Hono();
  app.use("*", dbBasicAuth(prisma));
  app.route("/api/users", createUsersRoutes(prisma));
  return app;
}

async function createUser(name: string, pass: string) {
  return prisma.user.create({
    data: { username: name, passwordHash: await hashPassword(pass) },
  });
}

describe("GET /api/users", () => {
  it("ユーザー一覧を取得できる（passwordHash除外）", async () => {
    await createUser("admin", "pass");
    setCachedUserCount(1);

    const app = createApp();
    const res = await app.request("/api/users", {
      headers: { Authorization: basicAuthHeader("admin", "pass") },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: Array<Record<string, unknown>> };
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toHaveProperty("username", "admin");
    expect(body.users[0]).not.toHaveProperty("passwordHash");
  });
});

describe("POST /api/users", () => {
  it("新規ユーザーを作成できる", async () => {
    await createUser("admin", "pass");
    setCachedUserCount(1);

    const app = createApp();
    const res = await app.request("/api/users", {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader("admin", "pass"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "op", password: "op" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: { username: string } };
    expect(body.user.username).toBe("op");
  });

  it("認証無効時（ユーザー0件）は403", async () => {
    setCachedUserCount(0);

    const app = createApp();
    const res = await app.request("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "x", password: "y" }),
    });
    expect(res.status).toBe(403);
  });

  it("重複ユーザーは409", async () => {
    await createUser("admin", "pass");
    setCachedUserCount(1);

    const app = createApp();
    const res = await app.request("/api/users", {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader("admin", "pass"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "admin", password: "x" }),
    });
    expect(res.status).toBe(409);
  });

  it("未入力は400", async () => {
    await createUser("admin", "pass");
    setCachedUserCount(1);

    const app = createApp();
    const res = await app.request("/api/users", {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader("admin", "pass"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/users/:id", () => {
  it("ユーザーを削除できる", async () => {
    await createUser("admin", "pass");
    const op = await createUser("op", "op");
    setCachedUserCount(2);

    const app = createApp();
    const res = await app.request(`/api/users/${op.id}`, {
      method: "DELETE",
      headers: { Authorization: basicAuthHeader("admin", "pass") },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("自分自身は削除できない（403）", async () => {
    const admin = await createUser("admin", "pass");
    const op = await createUser("op", "op");
    setCachedUserCount(2);

    const app = createApp();
    const res = await app.request(`/api/users/${admin.id}`, {
      method: "DELETE",
      headers: { Authorization: basicAuthHeader("admin", "pass") },
    });
    expect(res.status).toBe(403);
  });

  it("最後の1人かつ自分自身の場合は403", async () => {
    const admin = await createUser("admin", "pass");
    setCachedUserCount(1);

    const app = createApp();
    const res = await app.request(`/api/users/${admin.id}`, {
      method: "DELETE",
      headers: { Authorization: basicAuthHeader("admin", "pass") },
    });
    expect(res.status).toBe(403);
  });

  it("最後の1人は削除できない（400）", async () => {
    const admin = await createUser("admin", "pass");
    setCachedUserCount(1);

    const app = new Hono().route("/api/users", createUsersRoutes(prisma));
    const res = await app.request(`/api/users/${admin.id}`, { method: "DELETE" });
    expect(res.status).toBe(400);
  });

  it("存在しないユーザーは404", async () => {
    await createUser("admin", "pass");
    setCachedUserCount(1);

    const app = createApp();
    const res = await app.request("/api/users/nonexistent", {
      method: "DELETE",
      headers: { Authorization: basicAuthHeader("admin", "pass") },
    });
    expect(res.status).toBe(404);
  });

  it("認証なしは401", async () => {
    const admin = await createUser("admin", "pass");
    setCachedUserCount(1);

    const app = createApp();
    const res = await app.request(`/api/users/${admin.id}`, { method: "DELETE" });
    expect(res.status).toBe(401);
  });
});
