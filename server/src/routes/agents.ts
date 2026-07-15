import { Readable } from "node:stream";

import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
  appendRemoteBuildLogs,
  claimNextRemoteBuild,
  completeRemoteBuild,
  getRemoteBuild,
  touchRemoteBuild,
} from "../agents/registry";
import { createAgent, findAgentByToken, isAgentOnline, touchAgent } from "../agents/service";
import { prisma } from "../db/client";
import { dockerLoadFromStream } from "../docker/load";
import { env } from "../env";
import type { BuildAgent } from "../generated/prisma/client";

/**
 * HTTP surface for external build agents (issue #80).
 *
 * - agentGatewayRoutes: token-authenticated endpoints the pulling agent talks
 *   to (job claim / logs / image upload / completion). Mounted OUTSIDE the
 *   admin basic-auth because agents have no admin credentials.
 * - agentsAdminRoutes: management endpoints for the WebUI (register/list/
 *   enable/delete), protected by the normal admin auth.
 */

// Long-poll wait is capped below typical proxy/idle timeouts.
const MAX_POLL_WAIT_MS = 25000;

type AgentEnv = { Variables: { agent: BuildAgent } };

/** Bearer-token authentication for build agents. */
function agentAuth(): MiddlewareHandler<AgentEnv> {
  return async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    const agent = token ? await findAgentByToken(token) : null;
    if (!agent) {
      throw new HTTPException(401, { message: "invalid agent token" });
    }
    c.set("agent", agent);
    await next();
  };
}

export const agentGatewayRoutes = new Hono<AgentEnv>();

agentGatewayRoutes.use("*", agentAuth());

/**
 * Long-poll for the next build job. Returns 200 {job} when one is claimed, or
 * 204 after the wait elapses (the agent immediately polls again).
 */
agentGatewayRoutes.get("/jobs", async (c) => {
  const agent = c.get("agent");
  // poll毎にlastSeenAtを更新する(オンライン判定のハートビートを兼ねる)。
  await touchAgent(agent.id);
  const waitSec = Number(c.req.query("wait") ?? "20");
  const waitMs = Math.min(
    Math.max(Number.isFinite(waitSec) ? waitSec * 1000 : 20000, 0),
    MAX_POLL_WAIT_MS,
  );
  const job = await claimNextRemoteBuild(agent.id, waitMs);
  if (!job) return c.body(null, 204);
  return c.json({ job });
});

const logsSchema = z.object({ lines: z.array(z.string()).max(1000) });

/** Ingest a batch of build log lines (forwarded to the preview's SSE stream). */
agentGatewayRoutes.post("/jobs/:id/logs", async (c) => {
  const parsed = logsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);
  const ok = appendRemoteBuildLogs(c.req.param("id"), parsed.data.lines);
  // 410: ジョブは失効済み(完了/キャンセル/タイムアウト)。エージェントはビルドを中止する。
  if (!ok) return c.json({ error: "job gone" }, 410);
  return c.json({ ok: true });
});

/**
 * Receive the built images as a gzipped `docker save` stream and load them into
 * the local Docker daemon, so the subsequent local `compose up -d` finds the
 * tags it expects.
 */
agentGatewayRoutes.post("/jobs/:id/image", async (c) => {
  const jobId = c.req.param("id");
  const job = getRemoteBuild(jobId);
  if (!job) return c.json({ error: "job gone" }, 410);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "empty body" }, 400);

  const stream = Readable.fromWeb(body as import("node:stream/web").ReadableStream);
  const result = await dockerLoadFromStream(stream, {
    idleTimeoutMs: env.PREVIEW_BUILD_TIMEOUT_MS,
    // 転送中はチャンク受信でジョブを生存扱いにする(ログは流れないため)。
    onChunk: () => void touchRemoteBuild(jobId),
  });
  const lines = result.output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  appendRemoteBuildLogs(jobId, lines);
  if (result.code !== 0) {
    return c.json({ error: `docker load exited with code ${result.code}` }, 500);
  }
  return c.json({ ok: true });
});

const completeSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

/** Final success/failure report; resolves the awaiting buildPreview(). */
agentGatewayRoutes.post("/jobs/:id/complete", async (c) => {
  const parsed = completeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);
  const ok = completeRemoteBuild(c.req.param("id"), parsed.data.ok, parsed.data.error);
  if (!ok) return c.json({ error: "job gone" }, 410);
  return c.json({ ok: true });
});

// --- Admin management (WebUI) ---

export const agentsAdminRoutes = new Hono();

agentsAdminRoutes.get("/", async (c) => {
  const agents = await prisma.buildAgent.findMany({ orderBy: { name: "asc" } });
  return c.json({
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      enabled: a.enabled,
      lastSeenAt: a.lastSeenAt,
      online: a.enabled && isAgentOnline(a.lastSeenAt),
      createdAt: a.createdAt,
    })),
  });
});

const createAgentSchema = z.object({ name: z.string().min(1) });

agentsAdminRoutes.post("/", async (c) => {
  const parsed = createAgentSchema.safeParse(await c.req.json().catch(() => null));
  const name = parsed.success ? parsed.data.name.trim() : "";
  if (!name) return c.json({ error: "ビルドサーバー名を入力してください。" }, 400);
  const existing = await prisma.buildAgent.findUnique({ where: { name } });
  if (existing) return c.json({ error: "同名のビルドサーバーが既に登録されています。" }, 400);
  const { agent, token } = await createAgent(name);
  // トークンはこのレスポンスでのみ平文を返す(DBにはハッシュのみ保存)。
  return c.json({
    agent: { id: agent.id, name: agent.name, enabled: agent.enabled },
    token,
  });
});

const patchAgentSchema = z.object({ enabled: z.boolean() });

agentsAdminRoutes.patch("/:id", async (c) => {
  const parsed = patchAgentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);
  const agent = await prisma.buildAgent
    .update({ where: { id: c.req.param("id") }, data: { enabled: parsed.data.enabled } })
    .catch(() => null);
  if (!agent) return c.json({ error: "Build agent not found" }, 404);
  return c.json({ ok: true });
});

agentsAdminRoutes.delete("/:id", async (c) => {
  const deleted = await prisma.buildAgent
    .delete({ where: { id: c.req.param("id") } })
    .catch(() => null);
  if (!deleted) return c.json({ error: "Build agent not found" }, 404);
  return c.json({ ok: true });
});
