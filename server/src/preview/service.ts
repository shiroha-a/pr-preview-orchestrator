import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { prisma } from "../db/client";
import type { Prisma, Repository } from "../generated/prisma/client";
import { env } from "../env";

import { emitPreviewLog, emitPreviewStatus } from "./events";
import { startLogStream, stopLogStream } from "./logstream";
import { allocateHostPort } from "./ports";
import { applyOverlays, parseOverlayFiles } from "./overlay";
import { applyRewrites, parseRewriteRules } from "./rewrite";
import { isTunnelAlive, startTunnel, stopTunnel } from "./tunnel";

const OVERRIDE_FILE = "preview.orchestrator.override.yml";

function sanitize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

export function composeProjectName(owner: string, name: string, number: number): string {
  return `preview-${sanitize(owner)}-${sanitize(name)}-pr${number}`;
}

/** Compose project name for a branch-based preview (issue #25). */
export function branchComposeProjectName(owner: string, name: string, branch: string): string {
  return `preview-${sanitize(owner)}-${sanitize(name)}-branch-${sanitize(branch)}`;
}

function workspaceDir(slug: string): string {
  return resolve(env.WORKSPACES_DIR, slug);
}

function prWorkspaceSlug(owner: string, name: string, number: number): string {
  return `${sanitize(owner)}__${sanitize(name)}__pr${number}`;
}

function branchWorkspaceSlug(owner: string, name: string, branch: string): string {
  return `${sanitize(owner)}__${sanitize(name)}__branch-${sanitize(branch)}`;
}

/** A preview row with its target relations loaded (PR and/or repository). */
type PreviewWithTarget = Prisma.PreviewEnvironmentGetPayload<{
  include: { pullRequest: { include: { repository: true } }; repository: true };
}>;

/** Resolved git/compose parameters needed to build a preview, for either kind. */
interface BuildTarget {
  repo: Repository;
  owner: string;
  name: string;
  /** Ref to `git fetch origin` (e.g. `pull/12/head` or a branch name). */
  fetchRef: string;
  composeProject: string;
  dir: string;
  /** Human-readable label for logs (e.g. "PR #12" / "branch main"). */
  label: string;
  /** Known commit SHA up front (PR head); null for branches (resolved after clone). */
  knownSha: string | null;
}

/** Derive the build parameters for a preview from its kind (PR or branch). */
function resolveBuildTarget(preview: PreviewWithTarget): BuildTarget {
  if (preview.kind === "branch") {
    const repo = preview.repository;
    const branch = preview.branchRef;
    if (!repo || !branch) {
      throw new Error("ブランチプレビューにリポジトリまたはブランチ名がありません。");
    }
    return {
      repo,
      owner: repo.owner,
      name: repo.name,
      fetchRef: branch,
      composeProject: branchComposeProjectName(repo.owner, repo.name, branch),
      dir: workspaceDir(branchWorkspaceSlug(repo.owner, repo.name, branch)),
      label: `branch ${branch}`,
      knownSha: null,
    };
  }

  const pr = preview.pullRequest;
  if (!pr) throw new Error("PRプレビューにプルリクエストがありません。");
  const repo = pr.repository;
  return {
    repo,
    owner: repo.owner,
    name: repo.name,
    fetchRef: `pull/${pr.number}/head`,
    composeProject: composeProjectName(repo.owner, repo.name, pr.number),
    dir: workspaceDir(prWorkspaceSlug(repo.owner, repo.name, pr.number)),
    label: `PR #${pr.number}`,
    knownSha: pr.headSha,
  };
}

/** Load a preview with the relations needed to resolve its build target. */
function loadPreviewWithTarget(previewId: string): Promise<PreviewWithTarget | null> {
  return prisma.previewEnvironment.findUnique({
    where: { id: previewId },
    include: { pullRequest: { include: { repository: true } }, repository: true },
  });
}

interface RunOptions {
  cwd?: string;
  onLine?: (line: string) => void;
  /** Substrings to redact from output (e.g. access tokens). */
  mask?: string[];
  /** Kill the process and reject after this many milliseconds. */
  timeoutMs?: number;
}

/** Run a command, streaming combined stdout/stderr line-by-line to onLine. */
function runCommand(command: string, args: string[], options: RunOptions = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd });

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    // アイドルタイムアウト: 出力が一定時間途切れたときだけ打ち切る。巨大ビルドでも
    // 進捗(出力)がある限りタイムアウトしない(issue #14)。
    const armTimer = () => {
      if (!options.timeoutMs) return;
      clearTimer();
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(
          new Error(`Command timed out after ${options.timeoutMs}ms with no output: ${command}`),
        );
      }, options.timeoutMs);
    };
    armTimer();

    const handle = (buf: Buffer) => {
      armTimer();
      let text = buf.toString();
      for (const secret of options.mask ?? []) {
        if (secret) text = text.split(secret).join("***");
      }
      for (const line of text.split(/\r?\n/)) {
        if (line.length > 0) options.onLine?.(line);
      }
    };

    child.stdout.on("data", handle);
    child.stderr.on("data", handle);
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimer();
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimer();
      resolve(code ?? 0);
    });
  });
}

interface PrepareWorkspaceOptions {
  dir: string;
  owner: string;
  name: string;
  /** Ref to fetch from origin (e.g. `pull/12/head` or a branch name). */
  fetchRef: string;
  /** Optional token for cloning private repositories. */
  token?: string;
  onLine: (line: string) => void;
}

/**
 * Clone (or update) the target repository, check out the requested ref (a PR
 * head or a branch), and return the checked-out commit SHA.
 */
async function prepareWorkspace(opts: PrepareWorkspaceOptions): Promise<string> {
  const { dir, owner, name, fetchRef, token, onLine } = opts;
  const cloneUrl = token
    ? `https://x-access-token:${token}@github.com/${owner}/${name}.git`
    : `https://github.com/${owner}/${name}.git`;
  const mask = token ? [token] : [];

  if (!existsSync(dir)) {
    await mkdir(dirname(dir), { recursive: true });
    await runCommand("git", ["clone", "--depth", "50", cloneUrl, dir], { onLine, mask });
  } else {
    await runCommand("git", ["-C", dir, "remote", "set-url", "origin", cloneUrl], { mask });
    await runCommand("git", ["-C", dir, "fetch", "--depth", "50", "origin"], { onLine, mask });
  }

  // Fetch the requested ref (PR head ref works for forks too) and check it out.
  const fetchCode = await runCommand("git", ["-C", dir, "fetch", "origin", fetchRef], {
    onLine,
    mask,
  });
  if (fetchCode !== 0) throw new Error(`git fetch of ${fetchRef} failed (code ${fetchCode})`);

  const checkoutCode = await runCommand("git", ["-C", dir, "checkout", "-f", "FETCH_HEAD"], {
    onLine,
    mask,
  });
  if (checkoutCode !== 0) throw new Error(`git checkout failed (code ${checkoutCode})`);

  // 実際にチェックアウトしたコミットSHAを取得する(ブランチは事前にSHA不明なため)。
  let sha = "";
  await runCommand("git", ["-C", dir, "rev-parse", "HEAD"], {
    onLine: (line) => {
      const trimmed = line.trim();
      if (trimmed) sha = trimmed;
    },
  });
  return sha;
}

interface WriteOverrideOptions {
  dir: string;
  webService: string;
  hostPort: number;
  internalPort: number;
}

/** Write a compose override mapping the web service to a dynamic host port. */
function writeOverride(opts: WriteOverrideOptions): void {
  const { dir, webService, hostPort, internalPort } = opts;
  // `!override` replaces any existing `ports` on the service, so a repository's
  // existing docker-compose.yml (even with fixed host ports) can be reused
  // without conflicts across simultaneous previews.
  const yaml = `services:\n  ${webService}:\n    ports: !override\n      - "${hostPort}:${internalPort}"\n`;
  writeFileSync(join(dir, OVERRIDE_FILE), yaml);
}

function hostnameOf(url: string, fallback: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return fallback;
  }
}

/**
 * Build (or rebuild) the preview environment identified by previewId. The
 * preview may target a pull request or a branch (issue #25).
 *
 * Order: clone the ref, allocate a port, start the Cloudflare tunnel (so its
 * URL is known), apply file rewrite rules (e.g. inject the URL into a config
 * file), generate a compose override, optionally reset volumes, then
 * `docker compose up`.
 *
 * When `noCache` is true the images are rebuilt from scratch via
 * `docker compose build --no-cache` before starting (issue #20).
 */
export async function buildPreview(previewId: string, noCache = false): Promise<void> {
  const loaded = await loadPreviewWithTarget(previewId);
  if (!loaded) throw new Error("Preview environment not found");
  const target = resolveBuildTarget(loaded);
  const { repo, dir, composeProject: project } = target;

  const preview = await prisma.previewEnvironment.update({
    where: { id: previewId },
    data: { status: "pending", composeProject: project, commitSha: target.knownSha, logs: "" },
  });

  const logBuffer: string[] = [];
  const log = (line: string) => {
    logBuffer.push(line);
    emitPreviewLog(previewId, line);
  };
  const setStatus = async (
    status: string,
    extra: { hostPort?: number; url?: string | null } = {},
  ) => {
    emitPreviewStatus(previewId, status);
    await prisma.previewEnvironment.update({
      where: { id: previewId },
      data: { status, logs: logBuffer.join("\n").slice(-20000), ...extra },
    });
  };

  const token = env.GITHUB_TOKEN;
  const mask = token ? [token] : [];

  try {
    // 設定チェックは preview 作成後・try 内で行う。preview 作成前に投げると
    // status が pending のまま残り「待機中」で固まってしまう(issue #8)。
    if (!repo.webService || !repo.internalPort) {
      throw new Error(
        "プレビュー設定(公開Webサービス名・内部ポート)が未設定です。リポジトリのプレビュー設定で指定してください。",
      );
    }

    await setStatus("cloning");
    log(`Cloning ${target.owner}/${target.name} ${target.label}...`);

    const sha = await prepareWorkspace({
      dir,
      owner: target.owner,
      name: target.name,
      fetchRef: target.fetchRef,
      token,
      onLine: log,
    });
    if (sha) {
      log(`Checked out ${sha.slice(0, 7)}`);
      // 実際にチェックアウトしたSHAを記録(ブランチは事前不明、PRも最新を反映)。
      await prisma.previewEnvironment.update({
        where: { id: previewId },
        data: { commitSha: sha },
      });
    }

    const hostPort = preview.hostPort ?? (await allocateHostPort());
    log(`Allocated host port ${hostPort}`);

    // Start the tunnel first so its URL is known to the rewrite step.
    let url = `http://${env.PREVIEW_HOST}:${hostPort}`;
    if (env.PREVIEW_TUNNEL) {
      try {
        log("Starting Cloudflare Quick Tunnel...");
        url = await startTunnel(previewId, hostPort);
        log(`Tunnel ready: ${url}`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log(`WARN: Cloudflare tunnel failed (${message}); falling back to ${url}`);
      }
    }

    const templateVars = {
      PREVIEW_URL: url,
      PREVIEW_HOST: hostnameOf(url, env.PREVIEW_HOST),
      HOST_PORT: String(hostPort),
    };

    // Write overlay files (e.g. a test-specific compose file or config from
    // outside the target repo) into the workspace. Content supports the same
    // template variables.
    const overlays = parseOverlayFiles(repo.overlayFiles);
    if (overlays.length > 0) {
      log(`Writing ${overlays.length} overlay file(s)...`);
      applyOverlays(dir, overlays, templateVars, log);
    }

    // Apply file rewrite rules (e.g. inject the preview URL into a config file).
    const rules = parseRewriteRules(repo.fileRewrites);
    if (rules.length > 0) {
      log(`Applying ${rules.length} file rewrite rule(s)...`);
      applyRewrites(dir, rules, templateVars, log);
    }

    writeOverride({ dir, webService: repo.webService, hostPort, internalPort: repo.internalPort });

    await setStatus("building", { hostPort, url });

    if (repo.resetVolumes) {
      log("Resetting volumes (docker compose down -v)...");
      await runCommand(
        "docker",
        [
          "compose",
          "-f",
          repo.composePath,
          "-f",
          OVERRIDE_FILE,
          "-p",
          project,
          "down",
          "-v",
          "--remove-orphans",
        ],
        { cwd: dir, onLine: log, mask },
      );
    }

    const composeFiles = ["compose", "-f", repo.composePath, "-f", OVERRIDE_FILE, "-p", project];

    // `docker compose up` には --no-cache がないため、キャッシュ破棄時は先に
    // `build --no-cache` でイメージを作り直してから up する(issue #20)。
    if (noCache) {
      log("Running docker compose build --no-cache...");
      const buildCode = await runCommand("docker", [...composeFiles, "build", "--no-cache"], {
        cwd: dir,
        onLine: log,
        mask,
        timeoutMs: env.PREVIEW_BUILD_TIMEOUT_MS,
      });
      if (buildCode !== 0) throw new Error(`docker compose build exited with code ${buildCode}`);
    }

    log(`Running docker compose up -d${noCache ? "" : " --build"}...`);
    const code = await runCommand(
      "docker",
      [...composeFiles, "up", "-d", ...(noCache ? [] : ["--build"])],
      { cwd: dir, onLine: log, mask, timeoutMs: env.PREVIEW_BUILD_TIMEOUT_MS },
    );
    if (code !== 0) throw new Error(`docker compose up exited with code ${code}`);

    await setStatus("running", { url, hostPort });
    log(`Preview is running at ${url}`);

    // 実行時ログのストリーミングを開始(ビルドログに続けてSSE配信。issue #16)。
    startLogStream({
      previewId,
      dir,
      composePath: repo.composePath,
      overrideFile: OVERRIDE_FILE,
      project,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(`ERROR: ${message}`);
    stopTunnel(previewId);
    await setStatus("failed");
    throw e;
  }
}

/** Tear down the preview environment (PR or branch) and clean its workspace. */
export async function destroyPreview(previewId: string): Promise<void> {
  const loaded = await loadPreviewWithTarget(previewId);
  if (!loaded) return;
  const preview = loaded;
  const { repo, dir } = resolveBuildTarget(loaded);
  const log = (line: string) => emitPreviewLog(previewId, line);

  emitPreviewStatus(previewId, "stopping");
  await prisma.previewEnvironment.update({
    where: { id: previewId },
    data: { status: "stopping" },
  });

  // Stop the runtime log stream and the Cloudflare tunnel first.
  stopLogStream(previewId);
  stopTunnel(previewId);

  try {
    if (existsSync(dir)) {
      await runCommand(
        "docker",
        [
          "compose",
          "-f",
          repo.composePath,
          "-f",
          OVERRIDE_FILE,
          "-p",
          preview.composeProject,
          "down",
          "-v",
          "--remove-orphans",
        ],
        { cwd: dir, onLine: log },
      );
    } else {
      await runCommand(
        "docker",
        ["compose", "-p", preview.composeProject, "down", "-v", "--remove-orphans"],
        { onLine: log },
      );
    }
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
    }
  } catch (e) {
    log(`ERROR during teardown: ${e instanceof Error ? e.message : String(e)}`);
  }

  await prisma.previewEnvironment.update({
    where: { id: previewId },
    data: { status: "stopped", url: null, hostPort: null },
  });
  emitPreviewStatus(previewId, "stopped");
}

/**
 * Restart the preview's containers without rebuilding (issue #15).
 * Reuses the existing Cloudflare tunnel when it is still alive; otherwise starts
 * a new one (e.g. after a server restart).
 */
export async function restartPreview(previewId: string): Promise<void> {
  const loaded = await loadPreviewWithTarget(previewId);
  if (!loaded) throw new Error("Preview environment not found");
  const preview = loaded;
  const { repo, dir } = resolveBuildTarget(loaded);

  const logBuffer: string[] = [];
  const log = (line: string) => {
    logBuffer.push(line);
    emitPreviewLog(previewId, line);
  };
  const setStatus = async (status: string, extra: { url?: string | null } = {}) => {
    emitPreviewStatus(previewId, status);
    await prisma.previewEnvironment.update({
      where: { id: previewId },
      data: { status, logs: logBuffer.join("\n").slice(-20000), ...extra },
    });
  };

  try {
    if (!existsSync(dir)) {
      throw new Error("ワークスペースがありません。先にプレビューを起動してください。");
    }

    await setStatus("building");
    log("Restarting containers (docker compose restart)...");
    const code = await runCommand(
      "docker",
      [
        "compose",
        "-f",
        repo.composePath,
        "-f",
        OVERRIDE_FILE,
        "-p",
        preview.composeProject,
        "restart",
      ],
      { cwd: dir, onLine: log, timeoutMs: env.PREVIEW_BUILD_TIMEOUT_MS },
    );
    if (code !== 0) throw new Error(`docker compose restart exited with code ${code}`);

    // トンネルは流用。生きていなければ(サーバー再起動後など)張り直す。
    let url = preview.url ?? `http://${env.PREVIEW_HOST}:${preview.hostPort ?? 0}`;
    if (env.PREVIEW_TUNNEL && preview.hostPort && !isTunnelAlive(previewId)) {
      try {
        log("Tunnel is not active; starting a new Cloudflare Quick Tunnel...");
        url = await startTunnel(previewId, preview.hostPort);
        log(`Tunnel ready: ${url}`);
      } catch (e) {
        log(`WARN: tunnel failed (${e instanceof Error ? e.message : String(e)}); keeping ${url}`);
      }
    } else if (env.PREVIEW_TUNNEL) {
      log("Reusing the existing tunnel.");
    }

    await setStatus("running", { url });
    log(`Preview restarted at ${url}`);

    startLogStream({
      previewId,
      dir,
      composePath: repo.composePath,
      overrideFile: OVERRIDE_FILE,
      project: preview.composeProject,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(`ERROR: ${message}`);
    await setStatus("failed");
    throw e;
  }
}

/**
 * Prune the global Docker build cache via `docker builder prune -f`.
 *
 * This affects the whole Docker host, not a single preview environment. Returns
 * the command output, whose last line is the reclaimed-space summary (issue #20).
 */
export async function pruneBuilderCache(): Promise<string> {
  const lines: string[] = [];
  const code = await runCommand("docker", ["builder", "prune", "-f"], {
    onLine: (line) => lines.push(line),
    timeoutMs: env.PREVIEW_BUILD_TIMEOUT_MS,
  });
  if (code !== 0) throw new Error(`docker builder prune exited with code ${code}`);
  return lines.join("\n");
}
