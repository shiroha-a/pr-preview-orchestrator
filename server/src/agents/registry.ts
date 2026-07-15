import { randomUUID } from "node:crypto";

import { BuildCancelledError } from "../preview/engine";
import type { OverlayFile } from "../preview/overlay";

/**
 * In-memory coordination between an in-flight buildPreview() awaiting a remote
 * build and the HTTP endpoints the pulling agent talks to (issue #80).
 *
 * Jobs live only in memory: if the orchestrator restarts mid-build the awaiting
 * promise is gone anyway (existing behavior marks in-flight previews failed on
 * startup), and the agent's next POST simply gets "gone" and aborts its build.
 */

/** Everything an agent needs to reproduce the build (design #80, section 4.2). */
export interface RemoteBuildPayload {
  previewId: string;
  owner: string;
  name: string;
  /** Ref to fetch (e.g. `pull/12/head` or a branch name). */
  fetchRef: string;
  /** Exact commit to build, resolved by the orchestrator for reproducibility. */
  sha: string;
  composeProject: string;
  composePath: string;
  overlayFiles: OverlayFile[];
  fileRewrites: string | null;
  webService: string;
  internalPort: number;
  hostPort: number;
  templateVars: Record<string, string>;
  noCache: boolean;
  /** Injected per job for private clones; never persisted on the agent. */
  githubToken?: string;
}

export interface ClaimedJob {
  id: string;
  payload: RemoteBuildPayload;
}

type JobState = "queued" | "claimed" | "finished";

interface RemoteJob {
  id: string;
  payload: RemoteBuildPayload;
  state: JobState;
  agentId: string | null;
  onLine: (line: string) => void;
  resolve: () => void;
  reject: (e: Error) => void;
  claimTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  idleTimeoutMs: number;
  firstActivityTimeoutMs: number;
  cleanupAbort: () => void;
}

interface Waiter {
  resolve: (job: ClaimedJob | null) => void;
  timer: ReturnType<typeof setTimeout>;
  agentId: string;
}

const jobs = new Map<string, RemoteJob>();
// FIFO of queued job ids, paired with long-poll waiters in arrival order.
const queue: string[] = [];
const waiters: Waiter[] = [];

function finishJob(job: RemoteJob, outcome: { ok: true } | { ok: false; error: Error }): void {
  if (job.state === "finished") return;
  job.state = "finished";
  if (job.claimTimer) clearTimeout(job.claimTimer);
  if (job.idleTimer) clearTimeout(job.idleTimer);
  job.cleanupAbort();
  const idx = queue.indexOf(job.id);
  if (idx >= 0) queue.splice(idx, 1);
  jobs.delete(job.id);
  if (outcome.ok) job.resolve();
  else job.reject(outcome.error);
}

function armIdleTimer(job: RemoteJob, timeoutMs = job.idleTimeoutMs): void {
  if (job.idleTimer) clearTimeout(job.idleTimer);
  job.idleTimer = setTimeout(() => {
    finishJob(job, {
      ok: false,
      error: new Error(
        `Remote build timed out: no activity from the build agent for ${timeoutMs}ms`,
      ),
    });
  }, timeoutMs);
}

function claimJob(job: RemoteJob, agentId: string): ClaimedJob {
  job.state = "claimed";
  job.agentId = agentId;
  if (job.claimTimer) {
    clearTimeout(job.claimTimer);
    job.claimTimer = null;
  }
  // claim直後は短い初動タイムアウトで監視する。claim後に応答が届かないケース
  // (エージェントのクラッシュ、切断済みpollへの払い出し)で、フルのidle
  // タイムアウトまで待たずに素早くフォールバックさせるため。最初のログ受信で
  // 通常のidleタイムアウトに切り替わる。
  armIdleTimer(job, Math.min(job.firstActivityTimeoutMs, job.idleTimeoutMs));
  return { id: job.id, payload: job.payload };
}

/** Pair queued jobs with pending long-poll waiters (FIFO on both sides). */
function drainQueue(): void {
  while (queue.length > 0 && waiters.length > 0) {
    const jobId = queue.shift();
    const job = jobId ? jobs.get(jobId) : undefined;
    if (!job || job.state !== "queued") continue;
    const waiter = waiters.shift();
    if (!waiter) {
      // 相手がいなければキューへ戻す(次のpollで拾われる)。
      queue.unshift(job.id);
      return;
    }
    clearTimeout(waiter.timer);
    waiter.resolve(claimJob(job, waiter.agentId));
  }
}

export interface RunRemoteBuildOptions {
  onLine: (line: string) => void;
  signal?: AbortSignal;
  /** How long the job may sit unclaimed before failing (fallback trigger). */
  claimTimeoutMs: number;
  /** Idle timeout after claim: no logs/upload/completion for this long fails it. */
  idleTimeoutMs: number;
  /**
   * Max wait between the claim and the agent's first sign of life. Defaults to
   * 30s: far shorter than idleTimeoutMs, so a claim handed to a dead agent
   * fails fast instead of stalling a full build timeout.
   */
  firstActivityTimeoutMs?: number;
  /**
   * Consulted when the claim timeout fires; return true to re-arm the timer
   * and keep waiting. buildMode=remote passes an online-agent check here so a
   * busy (serially building) agent does not fail queued jobs, while an agent
   * that went offline still expires them. Absent → fail on the first timeout.
   */
  shouldKeepWaiting?: () => Promise<boolean> | boolean;
}

const DEFAULT_FIRST_ACTIVITY_TIMEOUT_MS = 30000;

/**
 * Queue a build for a pulling agent and resolve when the agent reports success
 * (after its image upload). Rejects on cancellation (BuildCancelledError), on
 * claim timeout, on agent-side failure and on idle timeout, so the caller can
 * decide whether to fall back to a local build.
 */
export function runRemoteBuild(
  payload: RemoteBuildPayload,
  opts: RunRemoteBuildOptions,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new BuildCancelledError());
      return;
    }
    const job: RemoteJob = {
      id: randomUUID(),
      payload,
      state: "queued",
      agentId: null,
      onLine: opts.onLine,
      resolve,
      reject,
      claimTimer: null,
      idleTimer: null,
      idleTimeoutMs: opts.idleTimeoutMs,
      firstActivityTimeoutMs: opts.firstActivityTimeoutMs ?? DEFAULT_FIRST_ACTIVITY_TIMEOUT_MS,
      cleanupAbort: () => {},
    };

    // 停止/破棄要求はリモートビルドも中断する(issue #33 と同じ扱い)。エージェントは
    // 次のPOSTで "gone" を受け取り、自分側のビルドを中止する。
    const onAbort = () => finishJob(job, { ok: false, error: new BuildCancelledError() });
    if (opts.signal) {
      opts.signal.addEventListener("abort", onAbort, { once: true });
      job.cleanupAbort = () => opts.signal?.removeEventListener("abort", onAbort);
    }

    // claimタイムアウト時、shouldKeepWaitingがtrueを返す限りタイマーを張り直す
    // (ビジー中のオンラインエージェント待ち)。判定中にclaim/完了された場合は何もしない。
    const onClaimTimeout = async () => {
      if (job.state !== "queued") return;
      let keepWaiting = false;
      if (opts.shouldKeepWaiting) {
        try {
          keepWaiting = await opts.shouldKeepWaiting();
        } catch {
          keepWaiting = false;
        }
      }
      if (job.state !== "queued") return;
      if (keepWaiting) {
        job.claimTimer = setTimeout(() => void onClaimTimeout(), opts.claimTimeoutMs);
        return;
      }
      finishJob(job, {
        ok: false,
        error: new Error(`No build agent claimed the job within ${opts.claimTimeoutMs}ms`),
      });
    };
    job.claimTimer = setTimeout(() => void onClaimTimeout(), opts.claimTimeoutMs);

    jobs.set(job.id, job);
    queue.push(job.id);
    drainQueue();
  });
}

/**
 * Long-poll for the next queued build job. Resolves with a claimed job, or null
 * after waitMs when nothing arrives (the agent then polls again). Pass the HTTP
 * request's abort signal so a dead connection stops claiming jobs: a waiter
 * whose poll was disconnected must not receive work it can never act on.
 */
export function claimNextRemoteBuild(
  agentId: string,
  waitMs: number,
  signal?: AbortSignal,
): Promise<ClaimedJob | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null);
      return;
    }
    const remove = () => {
      const idx = waiters.indexOf(waiter);
      if (idx >= 0) waiters.splice(idx, 1);
    };
    const onAbort = () => {
      clearTimeout(waiter.timer);
      remove();
      resolve(null);
    };
    const waiter: Waiter = {
      agentId,
      resolve: (job) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(job);
      },
      timer: setTimeout(() => {
        remove();
        signal?.removeEventListener("abort", onAbort);
        resolve(null);
      }, waitMs),
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    waiters.push(waiter);
    drainQueue();
  });
}

/**
 * Look up a claimed job, verifying (when agentId is given) that the caller is
 * the agent the job was handed to. Job ids are unguessable UUIDs, but the
 * ownership check keeps multi-agent deployments honest at no cost.
 */
function claimedJobFor(jobId: string, agentId?: string): RemoteJob | null {
  const job = jobs.get(jobId);
  if (!job || job.state !== "claimed") return null;
  if (agentId !== undefined && job.agentId !== agentId) return null;
  return job;
}

/**
 * Forward a batch of build log lines from the agent. Returns false when the job
 * no longer exists (finished/cancelled) so the agent aborts its build.
 */
export function appendRemoteBuildLogs(jobId: string, lines: string[], agentId?: string): boolean {
  const job = claimedJobFor(jobId, agentId);
  if (!job) return false;
  armIdleTimer(job);
  for (const line of lines) job.onLine(line);
  return true;
}

/** Keep a claimed job alive during a long image upload. False when gone. */
export function touchRemoteBuild(jobId: string, agentId?: string): boolean {
  const job = claimedJobFor(jobId, agentId);
  if (!job) return false;
  armIdleTimer(job);
  return true;
}

/** The claimed job for id, or null (used by the image upload endpoint). */
export function getRemoteBuild(jobId: string, agentId?: string): ClaimedJob | null {
  const job = claimedJobFor(jobId, agentId);
  if (!job) return null;
  return { id: job.id, payload: job.payload };
}

/**
 * Final report from the agent. ok=true resolves the awaiting buildPreview();
 * ok=false rejects it (auto mode then falls back to a local build). Returns
 * false when the job no longer exists.
 */
export function completeRemoteBuild(
  jobId: string,
  ok: boolean,
  error?: string,
  agentId?: string,
): boolean {
  const job = claimedJobFor(jobId, agentId);
  if (!job) return false;
  finishJob(
    job,
    ok ? { ok: true } : { ok: false, error: new Error(error || "Remote build failed") },
  );
  return true;
}

/** Test helper: drop all in-memory jobs and waiters. */
export function resetRemoteBuildRegistry(): void {
  for (const job of [...jobs.values()]) {
    finishJob(job, { ok: false, error: new Error("registry reset") });
  }
  for (const waiter of waiters.splice(0)) {
    clearTimeout(waiter.timer);
    waiter.resolve(null);
  }
  queue.length = 0;
  jobs.clear();
}
