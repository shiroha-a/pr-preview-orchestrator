import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  completeRemoteBuild,
  resetRemoteBuildRegistry,
  runRemoteBuild,
  type RemoteBuildPayload,
} from "../../src/agents/registry";
import { agentGatewayRoutes, agentsAdminRoutes } from "../../src/routes/agents";
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

afterEach(() => {
  resetRemoteBuildRegistry();
});

function createApp() {
  return new Hono().route("/api/agent", agentGatewayRoutes).route("/api/agents", agentsAdminRoutes);
}

async function registerAgent(app: Hono, name = "box1"): Promise<{ id: string; token: string }> {
  const res = await app.request("/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { agent: { id: string }; token: string };
  return { id: body.agent.id, token: body.token };
}

function makePayload(): RemoteBuildPayload {
  return {
    previewId: "p1",
    owner: "acme",
    name: "app",
    fetchRef: "pull/1/head",
    sha: "abc123",
    composeProject: "preview-acme-app-pr1",
    composePath: "docker-compose.yml",
    overlayFiles: [],
    fileRewrites: null,
    webService: "web",
    internalPort: 3000,
    hostPort: 13000,
    templateVars: {},
    noCache: false,
    expectedImages: [],
  };
}

describe("agents admin API", () => {
  it("registers an agent and returns the token exactly once", async () => {
    const app = createApp();
    const res = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "box1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token).toMatch(/^pra_[0-9a-f]{64}$/);

    // 一覧にトークン(平文もハッシュも)を含めない。
    const list = await app.request("/api/agents");
    const listBody = (await list.json()) as { agents: Array<Record<string, unknown>> };
    expect(listBody.agents).toHaveLength(1);
    expect(listBody.agents[0]).not.toHaveProperty("token");
    expect(listBody.agents[0]).not.toHaveProperty("tokenHash");
    expect(listBody.agents[0].online).toBe(false);
  });

  it("rejects duplicate agent names", async () => {
    const app = createApp();
    await registerAgent(app, "box1");
    const res = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "box1" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("agent gateway auth", () => {
  it("rejects requests without a valid bearer token", async () => {
    const app = createApp();
    expect((await app.request("/api/agent/jobs?wait=0")).status).toBe(401);
    expect(
      (
        await app.request("/api/agent/jobs?wait=0", {
          headers: { Authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(401);
  });

  it("rejects a disabled agent's token", async () => {
    const app = createApp();
    const { id, token } = await registerAgent(app);
    await app.request(`/api/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    const res = await app.request("/api/agent/jobs?wait=0", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });
});

describe("agent gateway job flow", () => {
  it("returns 204 when no job is queued", async () => {
    const app = createApp();
    const { token } = await registerAgent(app);
    const res = await app.request("/api/agent/jobs?wait=0", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(204);
  });

  it("claims a job, ingests logs, and completes the build", async () => {
    const app = createApp();
    const { id, token } = await registerAgent(app);
    const lines: string[] = [];
    const build = runRemoteBuild(makePayload(), {
      onLine: (l) => lines.push(l),
      claimTimeoutMs: 5000,
      idleTimeoutMs: 5000,
    });

    const claim = await app.request("/api/agent/jobs?wait=5", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(claim.status).toBe(200);
    const { job } = (await claim.json()) as { job: { id: string; payload: RemoteBuildPayload } };
    expect(job.payload.sha).toBe("abc123");

    // pollでlastSeenAtが更新されonlineになる。
    const list = await app.request("/api/agents");
    const listBody = (await list.json()) as { agents: Array<{ id: string; online: boolean }> };
    expect(listBody.agents.find((a) => a.id === id)?.online).toBe(true);

    const logs = await app.request(`/api/agent/jobs/${job.id}/logs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ lines: ["step 1", "step 2"] }),
    });
    expect(logs.status).toBe(200);

    const complete = await app.request(`/api/agent/jobs/${job.id}/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
    expect(complete.status).toBe(200);

    await expect(build).resolves.toBeUndefined();
    expect(lines).toEqual(["step 1", "step 2"]);
  });

  it("disabling an agent expires its claimed job immediately", async () => {
    // ビルド中の無効化で以降の報告が401になり、idleタイムアウトまで停滞する問題の
    // 対策(issue #80レビュー2): PATCHでenabled=falseにした時点でジョブを失効させる。
    const app = createApp();
    const { id, token } = await registerAgent(app);
    const build = runRemoteBuild(makePayload(), {
      onLine: () => {},
      claimTimeoutMs: 5000,
      idleTimeoutMs: 600000,
    });
    const claim = await app.request("/api/agent/jobs?wait=5", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(claim.status).toBe(200);

    const patch = await app.request(`/api/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(patch.status).toBe(200);
    await expect(build).rejects.toThrow(/was disabled/);
  });

  it("rejects logs/complete from an agent that did not claim the job", async () => {
    // ジョブをclaimしたエージェント本人のみ操作できる(issue #80レビュー指摘3)。
    const app = createApp();
    const { token } = await registerAgent(app, "box1");
    const { token: otherToken } = await registerAgent(app, "box2");
    const build = runRemoteBuild(makePayload(), {
      onLine: () => {},
      claimTimeoutMs: 5000,
      idleTimeoutMs: 5000,
    });
    const claim = await app.request("/api/agent/jobs?wait=5", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { job } = (await claim.json()) as { job: { id: string } };

    const logs = await app.request(`/api/agent/jobs/${job.id}/logs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${otherToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ lines: ["spoofed"] }),
    });
    expect(logs.status).toBe(410);
    const complete = await app.request(`/api/agent/jobs/${job.id}/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${otherToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
    expect(complete.status).toBe(410);

    // 本人からのcompleteは通る。
    const own = await app.request(`/api/agent/jobs/${job.id}/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
    expect(own.status).toBe(200);
    await expect(build).resolves.toBeUndefined();
  });

  it("returns 410 for logs/complete on an expired job", async () => {
    const app = createApp();
    const { token } = await registerAgent(app);
    const build = runRemoteBuild(makePayload(), {
      onLine: () => {},
      claimTimeoutMs: 5000,
      idleTimeoutMs: 5000,
    });
    const claim = await app.request("/api/agent/jobs?wait=5", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { job } = (await claim.json()) as { job: { id: string } };
    completeRemoteBuild(job.id, false, "boom");
    await expect(build).rejects.toThrow("boom");

    const logs = await app.request(`/api/agent/jobs/${job.id}/logs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ lines: ["late"] }),
    });
    expect(logs.status).toBe(410);
    const complete = await app.request(`/api/agent/jobs/${job.id}/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
    expect(complete.status).toBe(410);
  });
});
