import { afterEach, describe, expect, it } from "vitest";

import {
  appendRemoteBuildLogs,
  claimNextRemoteBuild,
  completeRemoteBuild,
  getRemoteBuild,
  resetRemoteBuildRegistry,
  runRemoteBuild,
  type RemoteBuildPayload,
} from "../../src/agents/registry";
import { BuildCancelledError } from "../../src/preview/engine";

function makePayload(overrides: Partial<RemoteBuildPayload> = {}): RemoteBuildPayload {
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
    ...overrides,
  };
}

afterEach(() => {
  resetRemoteBuildRegistry();
});

describe("remote build registry", () => {
  it("claims a queued job and resolves on success completion", async () => {
    const lines: string[] = [];
    const build = runRemoteBuild(makePayload(), {
      onLine: (l) => lines.push(l),
      claimTimeoutMs: 5000,
      idleTimeoutMs: 5000,
    });

    const job = await claimNextRemoteBuild("agent1", 1000);
    expect(job).not.toBeNull();
    expect(job?.payload.composeProject).toBe("preview-acme-app-pr1");

    expect(appendRemoteBuildLogs(job!.id, ["building...", "done"])).toBe(true);
    expect(completeRemoteBuild(job!.id, true)).toBe(true);

    await expect(build).resolves.toBeUndefined();
    expect(lines).toEqual(["building...", "done"]);
  });

  it("rejects the build when the agent reports failure", async () => {
    const build = runRemoteBuild(makePayload(), {
      onLine: () => {},
      claimTimeoutMs: 5000,
      idleTimeoutMs: 5000,
    });
    const job = await claimNextRemoteBuild("agent1", 1000);
    expect(completeRemoteBuild(job!.id, false, "compose build failed")).toBe(true);
    await expect(build).rejects.toThrow("compose build failed");
  });

  it("rejects after the claim timeout when no agent picks the job up", async () => {
    const build = runRemoteBuild(makePayload(), {
      onLine: () => {},
      claimTimeoutMs: 30,
      idleTimeoutMs: 5000,
    });
    await expect(build).rejects.toThrow(/No build agent claimed/);
  });

  it("rejects after the idle timeout when a claimed agent goes silent", async () => {
    const build = runRemoteBuild(makePayload(), {
      onLine: () => {},
      claimTimeoutMs: 5000,
      idleTimeoutMs: 40,
    });
    const job = await claimNextRemoteBuild("agent1", 1000);
    expect(job).not.toBeNull();
    await expect(build).rejects.toThrow(/no activity/);
    // 失効後のログ投稿は拒否され、エージェントに中止が伝わる。
    expect(appendRemoteBuildLogs(job!.id, ["late"])).toBe(false);
  });

  it("rejects with BuildCancelledError when the abort signal fires", async () => {
    const controller = new AbortController();
    const build = runRemoteBuild(makePayload(), {
      onLine: () => {},
      signal: controller.signal,
      claimTimeoutMs: 5000,
      idleTimeoutMs: 5000,
    });
    const job = await claimNextRemoteBuild("agent1", 1000);
    controller.abort();
    await expect(build).rejects.toBeInstanceOf(BuildCancelledError);
    expect(getRemoteBuild(job!.id)).toBeNull();
  });

  it("resolves a waiting long-poll when a job arrives", async () => {
    // 先にpollを開始し、あとからジョブを積んでも即座に払い出されること。
    const claim = claimNextRemoteBuild("agent1", 3000);
    const build = runRemoteBuild(makePayload(), {
      onLine: () => {},
      claimTimeoutMs: 5000,
      idleTimeoutMs: 5000,
    });
    const job = await claim;
    expect(job).not.toBeNull();
    completeRemoteBuild(job!.id, true);
    await expect(build).resolves.toBeUndefined();
  });

  it("returns null from a long-poll when nothing is queued", async () => {
    const job = await claimNextRemoteBuild("agent1", 30);
    expect(job).toBeNull();
  });

  it("hands each queued job to exactly one claimer", async () => {
    const build1 = runRemoteBuild(makePayload({ previewId: "p1" }), {
      onLine: () => {},
      claimTimeoutMs: 5000,
      idleTimeoutMs: 5000,
    });
    const build2 = runRemoteBuild(makePayload({ previewId: "p2" }), {
      onLine: () => {},
      claimTimeoutMs: 5000,
      idleTimeoutMs: 5000,
    });
    const [a, b] = await Promise.all([
      claimNextRemoteBuild("agent1", 1000),
      claimNextRemoteBuild("agent2", 1000),
    ]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id).not.toBe(b!.id);
    completeRemoteBuild(a!.id, true);
    completeRemoteBuild(b!.id, true);
    await Promise.all([build1, build2]);
  });
});
