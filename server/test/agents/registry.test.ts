import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendRemoteBuildLogs,
  claimNextRemoteBuild,
  completeRemoteBuild,
  expireAgentJobs,
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
    expectedImages: [],
    ...overrides,
  };
}

// タイマー依存のテストが低速CIでflakeしないようfake timersで時間を制御する。
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  resetRemoteBuildRegistry();
  vi.useRealTimers();
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
      claimTimeoutMs: 30000,
      idleTimeoutMs: 60000,
    });
    const assertion = expect(build).rejects.toThrow(/No build agent claimed/);
    await vi.advanceTimersByTimeAsync(30000);
    await assertion;
  });

  it("keeps waiting past the claim timeout while shouldKeepWaiting returns true", async () => {
    // ビジー中のオンラインエージェント待ち(issue #80レビュー指摘1):
    // claimタイムアウトが2回過ぎてもtrueの間は失効せず、その後のclaimで完走する。
    const build = runRemoteBuild(makePayload(), {
      onLine: () => {},
      claimTimeoutMs: 30000,
      idleTimeoutMs: 60000,
      shouldKeepWaiting: () => true,
    });
    await vi.advanceTimersByTimeAsync(70000);

    const job = await claimNextRemoteBuild("agent1", 1000);
    expect(job).not.toBeNull();
    expect(completeRemoteBuild(job!.id, true)).toBe(true);
    await expect(build).resolves.toBeUndefined();
  });

  it("expires an unclaimed job once shouldKeepWaiting turns false", async () => {
    // エージェントがオフラインになった時点(false)で失効させる。
    let online = true;
    const build = runRemoteBuild(makePayload(), {
      onLine: () => {},
      claimTimeoutMs: 30000,
      idleTimeoutMs: 60000,
      shouldKeepWaiting: () => online,
    });
    const assertion = expect(build).rejects.toThrow(/No build agent claimed/);
    await vi.advanceTimersByTimeAsync(30000);
    online = false;
    await vi.advanceTimersByTimeAsync(30000);
    await assertion;
  });

  it("rejects after the idle timeout when a claimed agent goes silent", async () => {
    const build = runRemoteBuild(makePayload(), {
      onLine: () => {},
      claimTimeoutMs: 60000,
      idleTimeoutMs: 5000,
      firstActivityTimeoutMs: 5000,
    });
    const job = await claimNextRemoteBuild("agent1", 1000);
    expect(job).not.toBeNull();
    const assertion = expect(build).rejects.toThrow(/no activity/);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
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
    const claim = claimNextRemoteBuild("agent1", 30000);
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
    const claim = claimNextRemoteBuild("agent1", 30000);
    await vi.advanceTimersByTimeAsync(30000);
    await expect(claim).resolves.toBeNull();
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

  it("does not hand a job to a disconnected long-poll waiter", async () => {
    // 切断済み(abort)のpollがジョブをclaimすると、エージェント不在のまま
    // idleタイムアウトまで停滞してしまう(E2Eで発見したバグの回帰テスト)。
    const pollController = new AbortController();
    const claim = claimNextRemoteBuild("agent1", 30000, pollController.signal);
    pollController.abort();
    await expect(claim).resolves.toBeNull();

    const build = runRemoteBuild(makePayload(), {
      onLine: () => {},
      claimTimeoutMs: 30000,
      idleTimeoutMs: 60000,
    });
    // 切断済みwaiterが残っていない=claimされずclaimタイムアウトで落ちる。
    const assertion = expect(build).rejects.toThrow(/No build agent claimed/);
    await vi.advanceTimersByTimeAsync(30000);
    await assertion;
  });

  it("fails fast when a claimed agent never reports any activity", async () => {
    const build = runRemoteBuild(makePayload(), {
      onLine: () => {},
      claimTimeoutMs: 60000,
      idleTimeoutMs: 600000,
      firstActivityTimeoutMs: 30000,
    });
    const job = await claimNextRemoteBuild("agent1", 1000);
    expect(job).not.toBeNull();
    // 初動タイムアウト(30s)がフルのidleタイムアウト(600s)より先に効く。
    const assertion = expect(build).rejects.toThrow(/no activity/);
    await vi.advanceTimersByTimeAsync(30000);
    await assertion;
  });

  it("switches to the full idle timeout after the first activity", async () => {
    const build = runRemoteBuild(makePayload(), {
      onLine: () => {},
      claimTimeoutMs: 60000,
      idleTimeoutMs: 600000,
      firstActivityTimeoutMs: 30000,
    });
    const job = await claimNextRemoteBuild("agent1", 1000);
    // 初動タイムアウト前にログが届けば、以降はidleTimeoutMsで生存する。
    expect(appendRemoteBuildLogs(job!.id, ["alive"])).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(completeRemoteBuild(job!.id, true)).toBe(true);
    await expect(build).resolves.toBeUndefined();
  });

  it("expires only the disabled agent's claimed jobs", async () => {
    // 無効化/削除時にclaim中ジョブを即失効させ、idleタイムアウトまでの停滞を防ぐ
    // (issue #80レビュー2)。他エージェントのジョブは巻き込まない。
    const build1 = runRemoteBuild(makePayload({ previewId: "p1" }), {
      onLine: () => {},
      claimTimeoutMs: 5000,
      idleTimeoutMs: 600000,
    });
    const build2 = runRemoteBuild(makePayload({ previewId: "p2" }), {
      onLine: () => {},
      claimTimeoutMs: 5000,
      idleTimeoutMs: 600000,
    });
    const [a, b] = await Promise.all([
      claimNextRemoteBuild("agent1", 1000),
      claimNextRemoteBuild("agent2", 1000),
    ]);
    expect(expireAgentJobs("agent1", "Build agent was disabled")).toBe(1);
    await expect(build1).rejects.toThrow(/disabled/);
    // agent2側のジョブは生きている。
    expect(getRemoteBuild(b!.id, "agent2")).not.toBeNull();
    expect(completeRemoteBuild(b!.id, true)).toBe(true);
    await expect(build2).resolves.toBeUndefined();
    expect(getRemoteBuild(a!.id)).toBeNull();
  });

  it("rejects job operations from an agent that did not claim the job", async () => {
    // claimしたエージェント本人のみ操作できる(issue #80レビュー指摘3)。
    const build = runRemoteBuild(makePayload(), {
      onLine: () => {},
      claimTimeoutMs: 5000,
      idleTimeoutMs: 5000,
    });
    const job = await claimNextRemoteBuild("agent1", 1000);
    expect(appendRemoteBuildLogs(job!.id, ["x"], "agent2")).toBe(false);
    expect(getRemoteBuild(job!.id, "agent2")).toBeNull();
    expect(completeRemoteBuild(job!.id, true, undefined, "agent2")).toBe(false);
    // 本人からの操作は通る。
    expect(appendRemoteBuildLogs(job!.id, ["x"], "agent1")).toBe(true);
    expect(completeRemoteBuild(job!.id, true, undefined, "agent1")).toBe(true);
    await expect(build).resolves.toBeUndefined();
  });
});
