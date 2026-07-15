import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { runRemoteBuild } from "../agents/registry";
import { hasOnlineAgent } from "../agents/service";
import { prisma } from "../db/client";
import type { Prisma, Repository } from "../generated/prisma/client";
import { env } from "../env";

import { notifyAll } from "../push/service";

import {
  BuildCancelledError,
  buildImages,
  composeArgs,
  injectBuildFiles,
  OVERRIDE_FILE,
  prepareWorkspace,
  runCommand,
} from "./engine";
import { emitPreviewLog, emitPreviewStatus } from "./events";
import { startLogStream, stopLogStream } from "./logstream";
import { reserveHostPort } from "./ports";
import { type EffectiveSettings, resolveSettings } from "./settings";
import { getTunnelUrl, isTunnelAlive, startTunnel, stopTunnel } from "./tunnel";

/**
 * In-flight builds, keyed by previewId. A stop/destroy request aborts the
 * controller to kill the running git/docker child process so the worker is
 * freed to process the teardown immediately, even mid-build (issue #33).
 */
const activeBuilds = new Map<string, AbortController>();

/** Cancel an in-flight build for a preview, if any. Returns whether one was cancelled. */
export function cancelBuild(previewId: string): boolean {
  const controller = activeBuilds.get(previewId);
  if (!controller) return false;
  controller.abort();
  return true;
}

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
export type PreviewWithTarget = Prisma.PreviewEnvironmentGetPayload<{
  include: {
    pullRequest: { include: { repository: true } };
    repository: true;
    profile: true;
  };
}>;

/** Resolved git/compose parameters needed to build a preview, for either kind. */
interface BuildTarget {
  repo: Repository;
  /** Repository defaults merged with the preview's settings profile (issue #52). */
  settings: EffectiveSettings;
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
  /** Web UI path opened from a push notification click (issue #77). */
  appPath: string;
  /**
   * Static template variables known before the build starts (issue #75):
   * PR_NUMBER / PR_TITLE (branch previews fall back to the branch name) and
   * PROFILE_NAME (empty string when using the repository defaults). Dynamic
   * variables (PREVIEW_URL etc.) are added during the build.
   */
  templateVars: Record<string, string>;
}

/** Derive the build parameters for a preview from its kind (PR or branch). Exported for tests. */
export function resolveBuildTarget(preview: PreviewWithTarget): BuildTarget {
  // ブランチプレビューにはPRタイトル・番号が無いため、どちらもブランチ名で代用する(issue #75)。
  const profileName = preview.profile?.name ?? "";

  if (preview.kind === "branch") {
    const repo = preview.repository;
    const branch = preview.branchRef;
    if (!repo || !branch) {
      throw new Error("ブランチプレビューにリポジトリまたはブランチ名がありません。");
    }
    return {
      repo,
      settings: resolveSettings(repo, preview.profile),
      owner: repo.owner,
      name: repo.name,
      fetchRef: branch,
      composeProject: branchComposeProjectName(repo.owner, repo.name, branch),
      dir: workspaceDir(branchWorkspaceSlug(repo.owner, repo.name, branch)),
      label: `branch ${branch}`,
      knownSha: null,
      appPath: `/repos/${repo.owner}/${repo.name}`,
      templateVars: { PR_NUMBER: branch, PR_TITLE: branch, PROFILE_NAME: profileName },
    };
  }

  const pr = preview.pullRequest;
  if (!pr) throw new Error("PRプレビューにプルリクエストがありません。");
  const repo = pr.repository;
  return {
    repo,
    settings: resolveSettings(repo, preview.profile),
    owner: repo.owner,
    name: repo.name,
    fetchRef: `pull/${pr.number}/head`,
    composeProject: composeProjectName(repo.owner, repo.name, pr.number),
    dir: workspaceDir(prWorkspaceSlug(repo.owner, repo.name, pr.number)),
    label: `PR #${pr.number}`,
    knownSha: pr.headSha,
    appPath: `/repos/${repo.owner}/${repo.name}/pull/${pr.number}`,
    templateVars: { PR_NUMBER: String(pr.number), PR_TITLE: pr.title, PROFILE_NAME: profileName },
  };
}

/** Load a preview with the relations needed to resolve its build target. */
function loadPreviewWithTarget(previewId: string): Promise<PreviewWithTarget | null> {
  return prisma.previewEnvironment.findUnique({
    where: { id: previewId },
    include: {
      pullRequest: { include: { repository: true } },
      repository: true,
      profile: true,
    },
  });
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
 * Build options (issue #20/#41/#42):
 * - `noCache`: rebuild images from scratch (`docker compose build --no-cache`).
 * - `resetVolumes`: destroy volumes before building for a fresh DB.
 * - `keepTunnel`: reuse the existing tunnel/URL instead of creating a new one
 *   (keeps the app's baked-in URL valid; avoids DB regeneration for e.g. Misskey).
 */
/** Inputs for the build-step decision (issue #80). Exported for tests. */
export interface BuildStepOptions {
  /** Effective build mode: "auto" | "remote" | "local". */
  buildMode: string;
  /** Whether at least one enabled agent is currently online. */
  agentOnline: boolean;
  /** Queue the build on a remote agent and resolve when its images are loaded. */
  dispatchRemote: () => Promise<void>;
  /** Run `docker compose build` locally. */
  buildLocal: () => Promise<void>;
  log: (line: string) => void;
}

/**
 * Decide where the image build runs and execute it (issue #80). "remote"
 * requires an online agent and never falls back; "auto" prefers a remote agent
 * but falls back to a local build when none is online or the dispatch fails.
 * Cancellation (BuildCancelledError) always propagates unchanged.
 */
export async function executeBuildStep(opts: BuildStepOptions): Promise<void> {
  const { buildMode, agentOnline, dispatchRemote, buildLocal, log } = opts;
  if (buildMode !== "local") {
    if (!agentOnline && buildMode === "remote") {
      throw new Error(
        "ビルドモードがremoteに設定されていますが、オンラインの外部ビルドサーバーがありません。",
      );
    }
    if (agentOnline) {
      try {
        log("Dispatching image build to a remote build agent...");
        await dispatchRemote();
        log("Remote build finished; images are loaded locally.");
        return;
      } catch (e) {
        if (e instanceof BuildCancelledError) throw e;
        const message = e instanceof Error ? e.message : String(e);
        // remote指定はフォールバックせず失敗させる。autoはローカルビルドへ縮退する。
        if (buildMode === "remote") throw new Error(`リモートビルドに失敗しました: ${message}`);
        log(`WARN: remote build failed (${message}); falling back to a local build`);
      }
    }
  }
  await buildLocal();
}

export interface BuildOptions {
  noCache?: boolean;
  resetVolumes?: boolean;
  keepTunnel?: boolean;
}

export async function buildPreview(previewId: string, opts: BuildOptions = {}): Promise<void> {
  const { noCache = false, resetVolumes = false, keepTunnel = false } = opts;
  const loaded = await loadPreviewWithTarget(previewId);
  if (!loaded) throw new Error("Preview environment not found");
  const target = resolveBuildTarget(loaded);
  const { settings, dir, composeProject: project } = target;
  // プッシュ通知の本文: 対象を1行で表す(PRはタイトル付き。issue #77)。
  const notifyBody = `${target.owner}/${target.name} ${target.label}${
    loaded.pullRequest ? `「${loaded.pullRequest.title}」` : ""
  }`;

  // 停止/破棄要求でビルドを中断できるようにする(issue #33)。controllerの登録は
  // try 内で行い、この後の更新が投げても finally で確実に解除されるようにする。
  const controller = new AbortController();
  const signal = controller.signal;

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
    activeBuilds.set(previewId, controller);
    // 設定チェックは preview 作成後・try 内で行う。preview 作成前に投げると
    // status が pending のまま残り「待機中」で固まってしまう(issue #8)。
    // プロファイル適用後の実効設定に対して確認する(issue #52)。
    if (!settings.webService || !settings.internalPort) {
      throw new Error(
        "プレビュー設定(公開Webサービス名・内部ポート)が未設定です。リポジトリのプレビュー設定で指定してください。",
      );
    }
    // narrowing後に束縛しておく(クロージャ内では絞り込みが効かないため)。
    const webService = settings.webService;
    const internalPort = settings.internalPort;
    if (loaded.profile) {
      log(`Using settings profile "${loaded.profile.name}"`);
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
      signal,
    });
    if (sha) {
      log(`Checked out ${sha.slice(0, 7)}`);
      // 実際にチェックアウトしたSHAを記録(ブランチは事前不明、PRも最新を反映)。
      await prisma.previewEnvironment.update({
        where: { id: previewId },
        data: { commitSha: sha },
      });
    }

    // 並列ビルドでのポート衝突を避けるため、確保と同時にDBへ予約する(issue #33)。
    const hostPort = preview.hostPort ?? (await reserveHostPort(previewId));
    log(`Allocated host port ${hostPort}`);

    // Start the tunnel first so its URL is known to the rewrite step.
    let url = `http://${env.PREVIEW_HOST}:${hostPort}`;
    if (env.PREVIEW_TUNNEL) {
      // keepTunnel時は既存トンネルを流用しURLを維持する(DB再生成不要。issue #42)。
      if (keepTunnel && (await isTunnelAlive(previewId)) && preview.url) {
        url = preview.url;
        log(`Reusing existing tunnel: ${url}`);
      } else {
        try {
          log("Starting Cloudflare Quick Tunnel...");
          url = await startTunnel(previewId, hostPort);
          log(`Tunnel ready: ${url}`);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          log(`WARN: Cloudflare tunnel failed (${message}); falling back to ${url}`);
        }
      }
    }

    const templateVars = {
      ...target.templateVars,
      PREVIEW_URL: url,
      PREVIEW_HOST: hostnameOf(url, env.PREVIEW_HOST),
      HOST_PORT: String(hostPort),
    };

    injectBuildFiles({
      dir,
      overlayFiles: settings.overlayFiles,
      fileRewrites: settings.fileRewrites,
      webService,
      hostPort,
      internalPort,
      templateVars,
      onLine: log,
    });

    await setStatus("building", { hostPort, url });

    // リポジトリ設定またはオンデマンド要求(issue #41)でボリュームを破棄する。
    if (settings.resetVolumes || resetVolumes) {
      log("Resetting volumes (docker compose down -v)...");
      await runCommand(
        "docker",
        [...composeArgs(settings.composePath, project), "down", "-v", "--remove-orphans"],
        { cwd: dir, onLine: log, mask, signal },
      );
    }

    // ビルド工程は buildMode に応じて外部ビルドサーバーへ委譲できる(issue #80)。
    // リモート成功時はイメージが docker load 済みなので、後続の up -d がそのまま使う。
    const buildMode = settings.buildMode ?? env.BUILD_MODE_DEFAULT;
    await executeBuildStep({
      buildMode,
      agentOnline: buildMode === "local" ? false : await hasOnlineAgent(),
      log,
      dispatchRemote: () =>
        runRemoteBuild(
          {
            previewId,
            owner: target.owner,
            name: target.name,
            fetchRef: target.fetchRef,
            sha,
            composeProject: project,
            composePath: settings.composePath,
            overlayFiles: settings.overlayFiles,
            fileRewrites: settings.fileRewrites,
            webService,
            internalPort,
            hostPort,
            templateVars,
            noCache,
            githubToken: token,
          },
          {
            onLine: log,
            signal,
            claimTimeoutMs: env.REMOTE_BUILD_CLAIM_TIMEOUT_MS,
            idleTimeoutMs: env.PREVIEW_BUILD_TIMEOUT_MS,
            // remote指定はフォールバックしないため、オンラインのエージェントが居る限り
            // claim待ちを続ける(直列処理中のビジー待ち)。オフラインになれば失効する。
            // autoはフォールバックがあるので早期にローカルへ縮退する(issue #80レビュー指摘1)。
            shouldKeepWaiting: buildMode === "remote" ? () => hasOnlineAgent() : undefined,
          },
        ),
      buildLocal: async () => {
        log(`Running docker compose build${noCache ? " --no-cache" : ""}...`);
        await buildImages({
          dir,
          composePath: settings.composePath,
          composeProject: project,
          noCache,
          timeoutMs: env.PREVIEW_BUILD_TIMEOUT_MS,
          mask,
          signal,
          onLine: log,
        });
      },
    });

    log("Running docker compose up -d...");
    const code = await runCommand(
      "docker",
      [...composeArgs(settings.composePath, project), "up", "-d"],
      { cwd: dir, onLine: log, mask, timeoutMs: env.PREVIEW_BUILD_TIMEOUT_MS, signal },
    );
    if (code !== 0) throw new Error(`docker compose up exited with code ${code}`);

    await setStatus("running", { url, hostPort });
    log(`Preview is running at ${url}`);

    // ビルド完了をプッシュ通知する(issue #77)。失敗してもビルドには影響させない。
    void notifyAll({
      title: "プレビュー起動完了",
      body: notifyBody,
      url: target.appPath,
    });

    // 実行時ログのストリーミングを開始(ビルドログに続けてSSE配信。issue #16)。
    startLogStream({
      previewId,
      dir,
      composePath: settings.composePath,
      overrideFile: OVERRIDE_FILE,
      project,
    });
  } catch (e) {
    await stopTunnel(previewId);
    // 中断された場合は失敗扱いにせず、後続の停止/破棄ジョブに最終ステータスを委ねる(issue #33)。
    if (e instanceof BuildCancelledError || signal.aborted) {
      log("Build cancelled by stop/destroy request.");
      await setStatus("stopping");
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    log(`ERROR: ${message}`);
    await setStatus("failed");
    void notifyAll({ title: "ビルド失敗", body: notifyBody, url: target.appPath });
    throw e;
  } finally {
    activeBuilds.delete(previewId);
  }
}

/** Tear down the preview environment (PR or branch) and clean its workspace. */
export async function destroyPreview(previewId: string): Promise<void> {
  const loaded = await loadPreviewWithTarget(previewId);
  if (!loaded) return;
  const preview = loaded;
  const { settings, dir } = resolveBuildTarget(loaded);
  const log = (line: string) => emitPreviewLog(previewId, line);

  emitPreviewStatus(previewId, "stopping");
  await prisma.previewEnvironment.update({
    where: { id: previewId },
    data: { status: "stopping" },
  });

  // Stop the runtime log stream and the Cloudflare tunnel first.
  stopLogStream(previewId);
  await stopTunnel(previewId);

  // dockerデーモン無応答でジョブが固着しないようアイドルタイムアウトを設ける(issue #33)。
  const timeoutMs = env.PREVIEW_BUILD_TIMEOUT_MS;
  try {
    // --rmi local: compose既定名(<project>-<service>)でビルドされたイメージを破棄時に
    // 一緒に削除する(issue #67)。composeファイルの image: で名前指定されたイメージは
    // 他プレビューと共有されうるため対象外(local はカスタムタグ無しのみ削除する)。
    if (existsSync(dir)) {
      await runCommand(
        "docker",
        [
          ...composeArgs(settings.composePath, preview.composeProject),
          "down",
          "-v",
          "--remove-orphans",
          "--rmi",
          "local",
        ],
        { cwd: dir, onLine: log, timeoutMs },
      );
    } else {
      await runCommand(
        "docker",
        [
          "compose",
          "-p",
          preview.composeProject,
          "down",
          "-v",
          "--remove-orphans",
          "--rmi",
          "local",
        ],
        { onLine: log, timeoutMs },
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
 * Stop the preview's containers without removing them (issue #32). Unlike
 * destroy, the containers, volumes, workspace and allocated host port are kept,
 * so the preview can be resumed quickly (via restart) without rebuilding.
 * Frees memory/CPU and the Cloudflare tunnel; sets status to "paused".
 */
export async function stopPreview(previewId: string): Promise<void> {
  const loaded = await loadPreviewWithTarget(previewId);
  if (!loaded) return;
  const preview = loaded;

  // 破棄済み・既に停止済み・未作成の preview を "paused" に復活させない(destroy→stop
  // の順や二重投入での退行を防ぐ)。
  if (["stopped", "paused", "idle"].includes(preview.status)) return;

  const { settings, dir } = resolveBuildTarget(loaded);
  const log = (line: string) => emitPreviewLog(previewId, line);

  emitPreviewStatus(previewId, "stopping");
  await prisma.previewEnvironment.update({
    where: { id: previewId },
    data: { status: "stopping" },
  });

  // 実行時ログストリームとトンネルを止める(コンテナ・ボリューム・workspaceは残す)。
  stopLogStream(previewId);
  await stopTunnel(previewId);

  const timeoutMs = env.PREVIEW_BUILD_TIMEOUT_MS;
  try {
    if (existsSync(dir)) {
      await runCommand(
        "docker",
        [...composeArgs(settings.composePath, preview.composeProject), "stop"],
        { cwd: dir, onLine: log, timeoutMs },
      );
    } else {
      await runCommand("docker", ["compose", "-p", preview.composeProject, "stop"], {
        onLine: log,
        timeoutMs,
      });
    }
  } catch (e) {
    log(`ERROR during stop: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ビルドが overrideファイル生成まで進んでいない場合(早期中断など)は再開不能なので、
  // 偽の "paused" にせず "stopped"(ポート解放)にする(issue #33)。
  const resumable = existsSync(dir) && existsSync(join(dir, OVERRIDE_FILE));
  await prisma.previewEnvironment.update({
    where: { id: previewId },
    // resumable時のみ hostPort を確保したまま(再開で同じポートを再利用)。
    data: resumable
      ? { status: "paused", url: null }
      : { status: "stopped", url: null, hostPort: null },
  });
  emitPreviewStatus(previewId, resumable ? "paused" : "stopped");
}

/**
 * Restart options (issue #58): the "discard" checkboxes also apply to a plain
 * restart, not only to a rebuild.
 * - `resetVolumes`: destroy volumes and recreate the containers from the
 *   existing images (no rebuild).
 * - `resetTunnel`: discard the tunnel container and create a new one (the
 *   public URL changes).
 */
export interface RestartOptions {
  resetVolumes?: boolean;
  resetTunnel?: boolean;
}

/**
 * Restart the preview's containers without rebuilding (issue #15).
 * Reuses the existing Cloudflare tunnel when it is still alive; otherwise starts
 * a new one (e.g. after a server restart).
 */
export async function restartPreview(previewId: string, opts: RestartOptions = {}): Promise<void> {
  const { resetVolumes = false, resetTunnel = false } = opts;
  const loaded = await loadPreviewWithTarget(previewId);
  if (!loaded) throw new Error("Preview environment not found");
  const preview = loaded;
  const { settings, dir } = resolveBuildTarget(loaded);

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
    const compose = composeArgs(settings.composePath, preview.composeProject);
    if (resetVolumes) {
      // ボリューム破棄は `restart` では反映されないため down -v で作り直す(issue #58)。
      // イメージは既存のものを使うので --build は付けない(再ビルドしない)。
      log("Resetting volumes (docker compose down -v)...");
      const downCode = await runCommand("docker", [...compose, "down", "-v", "--remove-orphans"], {
        cwd: dir,
        onLine: log,
        timeoutMs: env.PREVIEW_BUILD_TIMEOUT_MS,
      });
      if (downCode !== 0) throw new Error(`docker compose down exited with code ${downCode}`);
      log("Recreating containers (docker compose up -d)...");
      const upCode = await runCommand("docker", [...compose, "up", "-d"], {
        cwd: dir,
        onLine: log,
        timeoutMs: env.PREVIEW_BUILD_TIMEOUT_MS,
      });
      if (upCode !== 0) throw new Error(`docker compose up exited with code ${upCode}`);
    } else {
      log("Restarting containers (docker compose restart)...");
      const code = await runCommand("docker", [...compose, "restart"], {
        cwd: dir,
        onLine: log,
        timeoutMs: env.PREVIEW_BUILD_TIMEOUT_MS,
      });
      if (code !== 0) throw new Error(`docker compose restart exited with code ${code}`);
    }

    // トンネルは流用。破棄指定(issue #58)か、生きていなければ(サーバー再起動後など)張り直す。
    let url = preview.url ?? `http://${env.PREVIEW_HOST}:${preview.hostPort ?? 0}`;
    if (
      env.PREVIEW_TUNNEL &&
      preview.hostPort &&
      (resetTunnel || !(await isTunnelAlive(previewId)))
    ) {
      try {
        log(
          resetTunnel
            ? "Discarding the tunnel and starting a new Cloudflare Quick Tunnel..."
            : "Tunnel is not active; starting a new Cloudflare Quick Tunnel...",
        );
        url = await startTunnel(previewId, preview.hostPort);
        log(`Tunnel ready: ${url}`);
      } catch (e) {
        // トンネル破棄時は旧URLが既に無効なので直接アクセス用URLへ退避する。
        if (resetTunnel) url = `http://${env.PREVIEW_HOST}:${preview.hostPort}`;
        log(
          `WARN: tunnel failed (${e instanceof Error ? e.message : String(e)}); falling back to ${url}`,
        );
      }
    } else if (env.PREVIEW_TUNNEL) {
      log("Reusing the existing tunnel.");
    }

    await setStatus("running", { url });
    log(`Preview restarted at ${url}`);

    startLogStream({
      previewId,
      dir,
      composePath: settings.composePath,
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
 * Re-establish the runtime log stream and reattach the Cloudflare tunnel for a
 * single "running" preview after a server restart. Both the preview containers
 * and the tunnel container (issue #48) survive a restart, so this normally just
 * reads back the still-valid tunnel URL and restarts the log stream (which does
 * not survive). Only if the tunnel container is gone does it start a new one.
 */
export async function reattachPreview(previewId: string): Promise<void> {
  const loaded = await loadPreviewWithTarget(previewId);
  if (!loaded) return;
  const preview = loaded;
  if (preview.status !== "running" || preview.hostPort == null) return;

  const { settings, dir } = resolveBuildTarget(loaded);
  const log = (line: string) => emitPreviewLog(previewId, line);

  // トンネルはコンテナ化されアプリ再起動を跨いで生存する(issue #48)。生きていれば
  // 現在のURLを読み直してDBを同期し(=URL維持)、コンテナが無い場合のみ張り直す。
  if (env.PREVIEW_TUNNEL) {
    if (await isTunnelAlive(previewId)) {
      const url = await getTunnelUrl(previewId);
      if (url && url !== preview.url) {
        // コンテナ再起動などでURLが変わっていた場合のみDBを更新して通知する。
        await prisma.previewEnvironment.update({ where: { id: previewId }, data: { url } });
        log(`Reattached to existing tunnel: ${url}`);
        emitPreviewStatus(previewId, "running");
      } else {
        log(`Existing tunnel is still alive: ${url ?? preview.url}`);
      }
    } else {
      try {
        log("Tunnel container is gone; starting a new Cloudflare Quick Tunnel...");
        const url = await startTunnel(previewId, preview.hostPort);
        await prisma.previewEnvironment.update({ where: { id: previewId }, data: { url } });
        log(`Tunnel ready: ${url}`);
        // 開いているパネルにURL更新を促す(statusは running のまま)。
        emitPreviewStatus(previewId, "running");
      } catch (e) {
        log(`WARN: failed to re-establish tunnel: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // 実行時ログのストリーミングも再起動で失われるため、workspaceがあれば再開する。
  if (existsSync(dir)) {
    startLogStream({
      previewId,
      dir,
      composePath: settings.composePath,
      overrideFile: OVERRIDE_FILE,
      project: preview.composeProject,
    });
  }
}

/**
 * On startup, reattach tunnels/log streams for every preview still marked
 * "running" (their containers and tunnel containers survived the restart).
 * Best-effort and sequential to avoid a burst of docker calls at once.
 */
export async function reattachRunningPreviews(): Promise<void> {
  const running = await prisma.previewEnvironment.findMany({
    where: { status: "running" },
    select: { id: true },
  });
  for (const p of running) {
    try {
      await reattachPreview(p.id);
    } catch {
      // best-effort: 1件失敗しても他を続行する。
    }
  }
}
