import { createHash, randomBytes } from "node:crypto";

import { prisma } from "../db/client";
import type { BuildAgent } from "../generated/prisma/client";
import { env } from "../env";

/**
 * Build agent registry (issue #80): registration, token authentication and
 * online tracking. Agents authenticate with a bearer token whose SHA-256 hash
 * is stored; the plaintext is shown only once at registration time.
 */

/** Hash an agent bearer token for storage/lookup. */
export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Generate a new agent bearer token (returned to the operator only once). */
export function generateAgentToken(): string {
  return `pra_${randomBytes(32).toString("hex")}`;
}

/** Whether a lastSeenAt timestamp counts as online right now. */
export function isAgentOnline(lastSeenAt: Date | null): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - lastSeenAt.getTime() <= env.AGENT_ONLINE_THRESHOLD_MS;
}

/** Register a new agent and return it with its plaintext token (shown once). */
export async function createAgent(name: string): Promise<{ agent: BuildAgent; token: string }> {
  const token = generateAgentToken();
  const agent = await prisma.buildAgent.create({
    data: { name, tokenHash: hashAgentToken(token) },
  });
  return { agent, token };
}

/** Look up an enabled agent by its bearer token, or null. */
export function findAgentByToken(token: string): Promise<BuildAgent | null> {
  return prisma.buildAgent.findFirst({
    where: { tokenHash: hashAgentToken(token), enabled: true },
  });
}

/** Record agent activity (called on every authenticated poll). */
export async function touchAgent(agentId: string): Promise<void> {
  await prisma.buildAgent.update({ where: { id: agentId }, data: { lastSeenAt: new Date() } });
}

/** Whether at least one enabled agent is currently online. */
export async function hasOnlineAgent(): Promise<boolean> {
  const cutoff = new Date(Date.now() - env.AGENT_ONLINE_THRESHOLD_MS);
  const count = await prisma.buildAgent.count({
    where: { enabled: true, lastSeenAt: { gte: cutoff } },
  });
  return count > 0;
}
