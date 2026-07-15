import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { applyOverlays, type OverlayFile } from "./overlay";
import { applyRewrites, parseRewriteRules } from "./rewrite";
import { composeFileArgs } from "./settings";

/**
 * DB-independent build engine: workspace checkout, build-time file injection
 * and image building for a preview environment.
 *
 * Extracted from preview/service.ts (issue #80) so the same build steps can run
 * either in-process (local builds) or inside a remote build agent later. Keep
 * this module free of Prisma/env access: every dependency is passed in.
 */

/** Compose override file generated into the workspace for each preview. */
export const OVERRIDE_FILE = "preview.orchestrator.override.yml";

/** Error thrown when a build is cancelled by a stop/destroy request (issue #33). */
export class BuildCancelledError extends Error {
  constructor() {
    super("Build cancelled");
    this.name = "BuildCancelledError";
  }
}

export interface RunOptions {
  cwd?: string;
  onLine?: (line: string) => void;
  /** Substrings to redact from output (e.g. access tokens). */
  mask?: string[];
  /** Kill the process and reject after this many milliseconds. */
  timeoutMs?: number;
  /** Abort signal to cancel (kill) the running process (issue #33). */
  signal?: AbortSignal;
}

/** Run a command, streaming combined stdout/stderr line-by-line to onLine. */
export function runCommand(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new BuildCancelledError());
      return;
    }
    const child = spawn(command, args, { cwd: options.cwd });

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    // 中断要求が来たら子プロセスをkillしてキャンセルとして reject する(issue #33)。
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimer();
      child.kill("SIGKILL");
      reject(new BuildCancelledError());
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const cleanupAbort = () => options.signal?.removeEventListener("abort", onAbort);
    // アイドルタイムアウト: 出力が一定時間途切れたときだけ打ち切る。巨大ビルドでも
    // 進捗(出力)がある限りタイムアウトしない(issue #14)。
    const armTimer = () => {
      if (!options.timeoutMs) return;
      clearTimer();
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanupAbort();
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
      cleanupAbort();
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimer();
      cleanupAbort();
      resolve(code ?? 0);
    });
  });
}

/**
 * Build the `docker compose` argument prefix for a preview: configured compose
 * files (later files override earlier ones, issue #52), the generated override
 * file and the compose project name.
 */
export function composeArgs(composePath: string, project: string): string[] {
  return ["compose", ...composeFileArgs(composePath), "-f", OVERRIDE_FILE, "-p", project];
}

export interface PrepareWorkspaceOptions {
  dir: string;
  owner: string;
  name: string;
  /** Ref to fetch from origin (e.g. `pull/12/head` or a branch name). */
  fetchRef: string;
  /** Optional token for cloning private repositories. */
  token?: string;
  onLine: (line: string) => void;
  /** Abort signal to cancel the clone/fetch mid-flight (issue #33). */
  signal?: AbortSignal;
}

/**
 * Clone (or update) the target repository, check out the requested ref (a PR
 * head or a branch), and return the checked-out commit SHA.
 */
export async function prepareWorkspace(opts: PrepareWorkspaceOptions): Promise<string> {
  const { dir, owner, name, fetchRef, token, onLine, signal } = opts;
  const cleanUrl = `https://github.com/${owner}/${name}.git`;
  const cloneUrl = token
    ? `https://x-access-token:${token}@github.com/${owner}/${name}.git`
    : cleanUrl;
  const mask = token ? [token] : [];

  try {
    if (!existsSync(dir)) {
      await mkdir(dirname(dir), { recursive: true });
      await runCommand("git", ["clone", "--depth", "50", cloneUrl, dir], { onLine, mask, signal });
    } else {
      await runCommand("git", ["-C", dir, "remote", "set-url", "origin", cloneUrl], {
        mask,
        signal,
      });
      await runCommand("git", ["-C", dir, "fetch", "--depth", "50", "origin"], {
        onLine,
        mask,
        signal,
      });
    }

    // Fetch the requested ref (PR head ref works for forks too) and check it out.
    const fetchCode = await runCommand("git", ["-C", dir, "fetch", "origin", fetchRef], {
      onLine,
      mask,
      signal,
    });
    if (fetchCode !== 0) throw new Error(`git fetch of ${fetchRef} failed (code ${fetchCode})`);

    const checkoutCode = await runCommand("git", ["-C", dir, "checkout", "-f", "FETCH_HEAD"], {
      onLine,
      mask,
      signal,
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
  } finally {
    // トークン入りURLを.git/configに残さない(issue #80レビュー2)。失敗・中断時も
    // 必ず掃除するためsignalは渡さない(abort済みだとrunCommandが即rejectするため)。
    if (token && existsSync(dir)) {
      await runCommand("git", ["-C", dir, "remote", "set-url", "origin", cleanUrl], { mask });
    }
  }
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

export interface InjectBuildFilesOptions {
  dir: string;
  /** Resolved overlay files (repository defaults merged with the profile). */
  overlayFiles: OverlayFile[];
  /** JSON-encoded rewrite rules (EffectiveSettings.fileRewrites). */
  fileRewrites: string | null;
  webService: string;
  hostPort: number;
  internalPort: number;
  templateVars: Record<string, string>;
  onLine: (line: string) => void;
}

/**
 * Write all build-time files into the checked-out workspace: overlay files,
 * file rewrites (both with template variables expanded) and the generated
 * compose override mapping the web service to the allocated host port.
 */
export function injectBuildFiles(opts: InjectBuildFilesOptions): void {
  const { dir, overlayFiles, fileRewrites, templateVars, onLine } = opts;

  // Write overlay files (e.g. a test-specific compose file or config from
  // outside the target repo) into the workspace. Content supports the same
  // template variables. 既定+プロファイルのマージ済み(issue #56)。
  if (overlayFiles.length > 0) {
    onLine(`Writing ${overlayFiles.length} overlay file(s)...`);
    applyOverlays(dir, overlayFiles, templateVars, onLine);
  }

  // Apply file rewrite rules (e.g. inject the preview URL into a config file).
  const rules = parseRewriteRules(fileRewrites);
  if (rules.length > 0) {
    onLine(`Applying ${rules.length} file rewrite rule(s)...`);
    applyRewrites(dir, rules, templateVars, onLine);
  }

  writeOverride({
    dir,
    webService: opts.webService,
    hostPort: opts.hostPort,
    internalPort: opts.internalPort,
  });
}

export interface BuildImagesOptions {
  dir: string;
  /** Newline-separated compose file paths (EffectiveSettings.composePath). */
  composePath: string;
  composeProject: string;
  /** Rebuild images from scratch (`docker compose build --no-cache`, issue #20). */
  noCache?: boolean;
  /** Idle timeout for the build command (no output for this long aborts it). */
  timeoutMs?: number;
  /** Substrings to redact from output (e.g. access tokens). */
  mask?: string[];
  signal?: AbortSignal;
  onLine: (line: string) => void;
}

/** Build the preview's images with `docker compose build`. Throws on failure. */
export async function buildImages(opts: BuildImagesOptions): Promise<void> {
  const args = [
    ...composeArgs(opts.composePath, opts.composeProject),
    "build",
    ...(opts.noCache ? ["--no-cache"] : []),
  ];
  const code = await runCommand("docker", args, {
    cwd: opts.dir,
    onLine: opts.onLine,
    mask: opts.mask,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  });
  if (code !== 0) throw new Error(`docker compose build exited with code ${code}`);
}
