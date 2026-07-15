import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";

import type { ClaimedJob, RemoteBuildPayload } from "../agents/registry";
import { env } from "../env";
import {
  buildImages,
  composeArgs,
  injectBuildFiles,
  prepareWorkspace,
  runCommand,
} from "../preview/engine";

/**
 * Build agent runtime (issue #80), started with SERVER_MODE=agent.
 *
 * The agent needs only outbound access to the orchestrator: it long-polls for
 * build jobs, reproduces the checkout (exact commit) and file injection with
 * the shared engine, runs `docker compose build`, then streams the built
 * images back as a gzipped `docker save` tar. It has no HTTP server, no
 * database and no GitHub credentials of its own (a token, when needed for a
 * private clone, arrives inside the job payload and is never persisted).
 */

const POLL_WAIT_SEC = 20;
// pollの失敗種別ごとの待機。認証エラーは設定ミスの可能性が高いので長めに待つ。
const RETRY_AFTER_ERROR_MS = 5000;
const RETRY_AFTER_AUTH_ERROR_MS = 30000;
const LOG_FLUSH_INTERVAL_MS = 500;
const LOG_FLUSH_MAX_LINES = 100;

interface AgentConfig {
  baseUrl: string;
  token: string;
}

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[agent] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function authHeaders(cfg: AgentConfig): Record<string, string> {
  return { Authorization: `Bearer ${cfg.token}` };
}

/**
 * Batches build log lines and ships them to the orchestrator. A 410 response
 * means the job was cancelled/expired on the orchestrator side; the shipper
 * then flags itself gone and fires onGone so the running build gets aborted.
 */
class LogShipper {
  private buffer: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending = false;
  gone = false;

  constructor(
    private readonly cfg: AgentConfig,
    private readonly jobId: string,
    private readonly onGone: () => void,
  ) {}

  push(line: string): void {
    if (this.gone) return;
    this.buffer.push(line);
    if (this.buffer.length >= LOG_FLUSH_MAX_LINES) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), LOG_FLUSH_INTERVAL_MS);
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // 送信中の再入は順序が乱れるためスキップする(残りは次のflushが拾う)。
    if (this.sending || this.gone || this.buffer.length === 0) return;
    this.sending = true;
    const lines = this.buffer.splice(0);
    try {
      const res = await fetch(`${this.cfg.baseUrl}/api/agent/jobs/${this.jobId}/logs`, {
        method: "POST",
        headers: { ...authHeaders(this.cfg), "Content-Type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      if (res.status === 410) {
        this.gone = true;
        this.onGone();
      }
    } catch {
      // 一時的な送信失敗はログ欠落として許容する(ビルド自体は継続)。
    } finally {
      this.sending = false;
      if (this.buffer.length > 0 && !this.gone) void this.flush();
    }
  }
}

/** Run a command and capture raw stdout (stderr is forwarded to onLine). */
function collectOutput(
  command: string,
  args: string[],
  opts: { cwd?: string; onLine?: (line: string) => void } = {},
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd: opts.cwd });
    let stdout = "";
    child.stdout.on("data", (buf: Buffer) => {
      stdout += buf.toString();
    });
    child.stderr.on("data", (buf: Buffer) => {
      for (const line of buf.toString().split(/\r?\n/)) {
        if (line.length > 0) opts.onLine?.(line);
      }
    });
    child.on("error", () => resolvePromise({ code: -1, stdout }));
    child.on("close", (code) => resolvePromise({ code: code ?? 0, stdout }));
  });
}

/**
 * Extract the image tags of services that are BUILT (have a `build:` section)
 * from `docker compose config --format json` output. Pull-only images are
 * excluded: the orchestrator can pull those itself, so transferring them would
 * only waste bandwidth. Exported for tests.
 */
export function parseBuiltImages(configJson: string, project: string): string[] {
  const parsed = JSON.parse(configJson) as {
    services?: Record<string, { image?: string; build?: unknown } | null>;
  };
  const images: string[] = [];
  for (const [serviceName, service] of Object.entries(parsed.services ?? {})) {
    if (!service || service.build == null) continue;
    // compose の既定イメージ名は <project>-<service>(issue #67 と同じ前提)。
    images.push(service.image ?? `${project}-${serviceName}`);
  }
  return images;
}

async function listBuiltImages(
  dir: string,
  payload: RemoteBuildPayload,
  onLine: (line: string) => void,
): Promise<string[]> {
  const { code, stdout } = await collectOutput(
    "docker",
    [...composeArgs(payload.composePath, payload.composeProject), "config", "--format", "json"],
    { cwd: dir, onLine },
  );
  if (code !== 0) throw new Error(`docker compose config exited with code ${code}`);
  return parseBuiltImages(stdout, payload.composeProject);
}

/**
 * Stream `docker save <images> | gzip` to the orchestrator's image endpoint,
 * which docker-loads it so the local `compose up -d` finds the tags.
 */
async function uploadImages(
  cfg: AgentConfig,
  jobId: string,
  images: string[],
  onLine: (line: string) => void,
): Promise<void> {
  const child = spawn("docker", ["save", ...images]);
  const gzip = createGzip();
  child.stdout.pipe(gzip);
  child.stderr.on("data", (buf: Buffer) => {
    for (const line of buf.toString().split(/\r?\n/)) {
      if (line.length > 0) onLine(line);
    }
  });
  const exit = new Promise<number>((resolvePromise) => {
    child.on("error", () => resolvePromise(-1));
    child.on("close", (code) => resolvePromise(code ?? 0));
  });

  // Node 22のfetchはduplex:"half"でリクエストボディのストリーミングに対応する。
  const res = await fetch(`${cfg.baseUrl}/api/agent/jobs/${jobId}/image`, {
    method: "POST",
    headers: { ...authHeaders(cfg), "Content-Type": "application/octet-stream" },
    body: Readable.toWeb(gzip) as unknown as RequestInit["body"],
    duplex: "half",
  } as RequestInit);

  const code = await exit;
  if (code !== 0) throw new Error(`docker save exited with code ${code}`);
  if (res.status === 410) throw new JobGoneError();
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `image upload failed (${res.status})`);
  }
}

/** Thrown when the orchestrator reports the job as cancelled/expired (410). */
class JobGoneError extends Error {
  constructor() {
    super("Job gone");
    this.name = "JobGoneError";
  }
}

async function completeJob(
  cfg: AgentConfig,
  jobId: string,
  ok: boolean,
  error?: string,
): Promise<void> {
  await fetch(`${cfg.baseUrl}/api/agent/jobs/${jobId}/complete`, {
    method: "POST",
    headers: { ...authHeaders(cfg), "Content-Type": "application/json" },
    body: JSON.stringify({ ok, ...(error ? { error } : {}) }),
  }).catch(() => {
    // 完了報告の失敗はオーケストレーター側のidleタイムアウトに委ねる。
  });
}

/** Execute one claimed build job end-to-end. Never throws. */
async function runJob(cfg: AgentConfig, job: ClaimedJob): Promise<void> {
  const { payload } = job;
  const controller = new AbortController();
  const shipper = new LogShipper(cfg, job.id, () => controller.abort());
  const onLine = (line: string) => shipper.push(line);
  const mask = payload.githubToken ? [payload.githubToken] : [];
  log(`Building ${payload.owner}/${payload.name} (${payload.composeProject})`);

  try {
    const dir = resolve(env.WORKSPACES_DIR, payload.composeProject);
    onLine(`[agent] Cloning ${payload.owner}/${payload.name} (${payload.fetchRef})...`);
    const sha = await prepareWorkspace({
      dir,
      owner: payload.owner,
      name: payload.name,
      fetchRef: payload.fetchRef,
      token: payload.githubToken,
      onLine,
      signal: controller.signal,
    });

    // 本体が解決したコミットSHAへ厳密に合わせる(push直後にrefが進んだ場合の再現性)。
    if (payload.sha && sha && sha !== payload.sha) {
      const code = await runCommand("git", ["-C", dir, "checkout", "-f", payload.sha], {
        onLine,
        mask,
        signal: controller.signal,
      });
      if (code !== 0) {
        onLine(
          `[agent] WARN: commit ${payload.sha.slice(0, 7)} not found; building ${sha.slice(0, 7)}`,
        );
      }
    }

    injectBuildFiles({
      dir,
      overlayFiles: payload.overlayFiles,
      fileRewrites: payload.fileRewrites,
      webService: payload.webService,
      hostPort: payload.hostPort,
      internalPort: payload.internalPort,
      templateVars: payload.templateVars,
      onLine,
    });

    onLine(`[agent] Running docker compose build${payload.noCache ? " --no-cache" : ""}...`);
    await buildImages({
      dir,
      composePath: payload.composePath,
      composeProject: payload.composeProject,
      noCache: payload.noCache,
      timeoutMs: env.PREVIEW_BUILD_TIMEOUT_MS,
      mask,
      signal: controller.signal,
      onLine,
    });

    const images = await listBuiltImages(dir, payload, onLine);
    if (images.length === 0) {
      onLine("[agent] No service has a build section; nothing to transfer.");
    } else {
      onLine(`[agent] Transferring ${images.length} image(s): ${images.join(", ")}`);
      await uploadImages(cfg, job.id, images, onLine);
      onLine("[agent] Image transfer complete.");
    }

    await shipper.flush();
    await completeJob(cfg, job.id, true);
    log(`Build finished: ${payload.composeProject}`);
  } catch (e) {
    // 410(本体側でジョブ失効)やそれに伴うabortは失敗報告せず静かに終える。
    if (e instanceof JobGoneError || shipper.gone || controller.signal.aborted) {
      log(`Job cancelled by orchestrator: ${payload.composeProject}`);
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    shipper.push(`[agent] ERROR: ${message}`);
    await shipper.flush();
    await completeJob(cfg, job.id, false, message);
    log(`Build failed: ${payload.composeProject} (${message})`);
  }
}

async function pollOnce(cfg: AgentConfig): Promise<ClaimedJob | null> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/api/agent/jobs?wait=${POLL_WAIT_SEC}`, {
      headers: authHeaders(cfg),
    });
  } catch (e) {
    log(`Cannot reach orchestrator (${e instanceof Error ? e.message : String(e)}); retrying...`);
    await sleep(RETRY_AFTER_ERROR_MS);
    return null;
  }
  if (res.status === 204) return null;
  if (res.status === 401) {
    log("Token rejected (invalid, or the agent is disabled). Check AGENT_TOKEN.");
    await sleep(RETRY_AFTER_AUTH_ERROR_MS);
    return null;
  }
  if (!res.ok) {
    log(`Unexpected poll response ${res.status}; retrying...`);
    await sleep(RETRY_AFTER_ERROR_MS);
    return null;
  }
  const body = (await res.json().catch(() => null)) as { job?: ClaimedJob } | null;
  return body?.job ?? null;
}

/** Entry point for SERVER_MODE=agent: poll the orchestrator forever. */
export async function runAgent(): Promise<void> {
  const baseUrl = env.ORCHESTRATOR_URL?.replace(/\/+$/, "");
  const token = env.AGENT_TOKEN;
  if (!baseUrl || !token) {
    // eslint-disable-next-line no-console
    console.error(
      "SERVER_MODE=agent には ORCHESTRATOR_URL と AGENT_TOKEN が必要です。管理画面の「ビルドサーバーを追加」で発行したコマンドを使用してください。",
    );
    process.exit(1);
  }
  const cfg: AgentConfig = { baseUrl, token };
  log(`Build agent started (orchestrator: ${baseUrl}, workspaces: ${env.WORKSPACES_DIR})`);

  // ジョブは1件ずつ直列に処理する(ビルドはCPU/IOを使い切るため並列にしない)。
  for (;;) {
    const job = await pollOnce(cfg);
    if (job) await runJob(cfg, job);
  }
}
