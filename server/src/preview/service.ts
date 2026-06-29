import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { prisma } from "../db/client";
import { env } from "../env";

import { emitPreviewLog, emitPreviewStatus } from "./events";
import { allocateHostPort } from "./ports";
import { applyOverlays, parseOverlayFiles } from "./overlay";
import { applyRewrites, parseRewriteRules } from "./rewrite";
import { startTunnel, stopTunnel } from "./tunnel";

const OVERRIDE_FILE = "preview.orchestrator.override.yml";

function sanitize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

export function composeProjectName(owner: string, name: string, number: number): string {
  return `preview-${sanitize(owner)}-${sanitize(name)}-pr${number}`;
}

function workspaceDir(owner: string, name: string, number: number): string {
  return resolve(env.WORKSPACES_DIR, `${sanitize(owner)}__${sanitize(name)}__pr${number}`);
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

    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`Command timed out after ${options.timeoutMs}ms: ${command}`));
        }, options.timeoutMs)
      : null;

    const handle = (buf: Buffer) => {
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
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve(code ?? 0);
    });
  });
}

interface PrepareWorkspaceOptions {
  dir: string;
  owner: string;
  name: string;
  number: number;
  /** Optional token for cloning private repositories. */
  token?: string;
  onLine: (line: string) => void;
}

/** Clone (or update) the target repository and check out the PR head. */
async function prepareWorkspace(opts: PrepareWorkspaceOptions): Promise<void> {
  const { dir, owner, name, number, token, onLine } = opts;
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

  // Fetch the PR head ref (works for forks too) and check it out.
  const fetchCode = await runCommand("git", ["-C", dir, "fetch", "origin", `pull/${number}/head`], {
    onLine,
    mask,
  });
  if (fetchCode !== 0) throw new Error(`git fetch of PR #${number} failed (code ${fetchCode})`);

  const checkoutCode = await runCommand("git", ["-C", dir, "checkout", "-f", "FETCH_HEAD"], {
    onLine,
    mask,
  });
  if (checkoutCode !== 0) throw new Error(`git checkout failed (code ${checkoutCode})`);
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
 * Build (or rebuild) the preview environment for a pull request.
 *
 * Order: clone the PR head, allocate a port, start the Cloudflare tunnel (so its
 * URL is known), apply file rewrite rules (e.g. inject the URL into a config
 * file), generate a compose override, optionally reset volumes, then
 * `docker compose up`.
 */
export async function buildPreview(pullRequestId: string): Promise<void> {
  const pr = await prisma.pullRequest.findUnique({
    where: { id: pullRequestId },
    include: { repository: true },
  });
  if (!pr) throw new Error("Pull request not found");
  const repo = pr.repository;

  if (!repo.webService || !repo.internalPort) {
    throw new Error(
      "プレビュー設定(公開Webサービス名・内部ポート)が未設定です。リポジトリのプレビュー設定で指定してください。",
    );
  }

  const project = composeProjectName(repo.owner, repo.name, pr.number);
  const preview = await prisma.previewEnvironment.upsert({
    where: { pullRequestId },
    create: {
      pullRequestId,
      status: "pending",
      composeProject: project,
      commitSha: pr.headSha,
    },
    update: { status: "pending", composeProject: project, commitSha: pr.headSha, logs: "" },
  });

  const previewId = preview.id;
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
    await setStatus("cloning");
    log(`Cloning ${repo.owner}/${repo.name} PR #${pr.number} (${pr.headSha.slice(0, 7)})...`);

    const dir = workspaceDir(repo.owner, repo.name, pr.number);
    await prepareWorkspace({
      dir,
      owner: repo.owner,
      name: repo.name,
      number: pr.number,
      token,
      onLine: log,
    });

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

    log("Running docker compose up -d --build...");
    const code = await runCommand(
      "docker",
      [
        "compose",
        "-f",
        repo.composePath,
        "-f",
        OVERRIDE_FILE,
        "-p",
        project,
        "up",
        "-d",
        "--build",
      ],
      { cwd: dir, onLine: log, mask, timeoutMs: env.PREVIEW_BUILD_TIMEOUT_MS },
    );
    if (code !== 0) throw new Error(`docker compose up exited with code ${code}`);

    await setStatus("running", { url, hostPort });
    log(`Preview is running at ${url}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(`ERROR: ${message}`);
    stopTunnel(previewId);
    await setStatus("failed");
    throw e;
  }
}

/** Tear down the preview environment for a pull request and clean its workspace. */
export async function destroyPreview(pullRequestId: string): Promise<void> {
  const preview = await prisma.previewEnvironment.findUnique({
    where: { pullRequestId },
    include: { pullRequest: { include: { repository: true } } },
  });
  if (!preview) return;

  const previewId = preview.id;
  const repo = preview.pullRequest.repository;
  const dir = workspaceDir(repo.owner, repo.name, preview.pullRequest.number);
  const log = (line: string) => emitPreviewLog(previewId, line);

  emitPreviewStatus(previewId, "stopping");
  await prisma.previewEnvironment.update({
    where: { id: previewId },
    data: { status: "stopping" },
  });

  // Stop the Cloudflare tunnel first.
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
