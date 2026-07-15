import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import { prisma } from "../db/client";
import type { Repository, SettingsProfile } from "../generated/prisma/client";
import {
  fetchAndCachePullRequest,
  fetchPullRequestComments,
  fetchPullRequestDiff,
  syncPullRequests,
} from "../github/pulls";
import { addRepository, listRepositoryBranches } from "../github/repositories";
import { enqueueJob } from "../jobs/queue";
import {
  branchComposeProjectName,
  cancelBuild,
  composeProjectName,
  destroyPreview,
} from "../preview/service";
import { resolveSettings } from "../preview/settings";

export const repositoriesRoutes = new Hono();

/** Resolve a cached repository by owner/name or return null. */
async function findRepo(owner: string, name: string) {
  return prisma.repository.findUnique({ where: { owner_name: { owner, name } } });
}

interface BuildOptionsBody {
  noCache?: boolean;
  resetVolumes?: boolean;
  keepTunnel?: boolean;
  profileId?: string | null;
}

/**
 * Parse optional build option flags from a request body: noCache (#20),
 * resetVolumes (#41), keepTunnel (#42), profileId (#52). Body is optional.
 * profileId is tri-state: a string selects a profile, null resets to the
 * repository defaults, undefined keeps the preview's current profile.
 */
async function parseBuildOptions(c: Context): Promise<{
  noCache: boolean;
  resetVolumes: boolean;
  keepTunnel: boolean;
  profileId: string | null | undefined;
}> {
  const body = await c.req.json<BuildOptionsBody>().catch(() => ({}) as BuildOptionsBody);
  return {
    noCache: body.noCache === true,
    resetVolumes: body.resetVolumes === true,
    keepTunnel: body.keepTunnel === true,
    profileId:
      body.profileId === null
        ? null
        : typeof body.profileId === "string"
          ? body.profileId
          : undefined,
  };
}

/**
 * Resolve the settings profile a build should use: the explicitly requested one
 * (validated to belong to the repository), or the preview's current profile
 * when the request leaves profileId undefined (issue #52).
 */
async function resolveBuildProfile(
  repository: Repository,
  profileId: string | null | undefined,
  currentProfileId: string | null | undefined,
): Promise<{ profile: SettingsProfile | null; error?: string }> {
  const targetId = profileId === undefined ? (currentProfileId ?? null) : profileId;
  if (targetId === null) return { profile: null };
  const profile = await prisma.settingsProfile.findFirst({
    where: { id: targetId, repositoryId: repository.id },
  });
  if (!profile) {
    return { profile: null, error: "指定されたプロファイルが見つかりません。" };
  }
  return { profile };
}

/** Error message when the effective settings are incomplete for a preview build. */
const SETTINGS_INCOMPLETE_ERROR =
  "プレビュー設定が未設定です。リポジトリのプレビュー設定で公開Webサービス名と内部ポートを指定してください。";

// --- Repositories ---

const addRepoSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
});

repositoriesRoutes.post("/", async (c) => {
  const parsed = addRepoSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "owner と name を指定してください" }, 400);
  }
  try {
    const repository = await addRepository(parsed.data.owner, parsed.data.name);
    return c.json({ repository });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "リポジトリの追加に失敗しました" },
      400,
    );
  }
});

repositoriesRoutes.get("/", async (c) => {
  const repositories = await prisma.repository.findMany({
    include: { _count: { select: { pullRequests: true } } },
    orderBy: [{ owner: "asc" }, { name: "asc" }],
  });
  return c.json({ repositories });
});

repositoriesRoutes.get("/:owner/:name", async (c) => {
  const { owner, name } = c.req.param();
  const repository = await prisma.repository.findUnique({
    where: { owner_name: { owner, name } },
    include: { profiles: { orderBy: { name: "asc" } } },
  });
  if (!repository) return c.json({ error: "Repository not found" }, 404);
  return c.json({ repository });
});

// Remove a repository: tear down previews then delete all data (issue #12).
repositoriesRoutes.delete("/:owner/:name", async (c) => {
  const { owner, name } = c.req.param();
  const repository = await prisma.repository.findUnique({
    where: { owner_name: { owner, name } },
    include: { pullRequests: { include: { preview: true } }, previews: true },
  });
  if (!repository) return c.json({ error: "Repository not found" }, 404);

  // このリポジトリの全プレビューID(PR紐付け + ブランチ紐付けの両方)。
  const previewIds = [
    ...repository.pullRequests.map((pr) => pr.preview?.id),
    ...repository.previews.map((p) => p.id),
  ].filter((id): id is string => Boolean(id));

  // 稼働中のプレビューを破棄(コンテナ・ボリューム・workspace・トンネルを片付ける)。
  // 進行中ビルドは先に中断する(issue #33)。destroyPreview には previewId を渡す。
  for (const id of previewIds) {
    try {
      cancelBuild(id);
      await destroyPreview(id);
    } catch {
      // best-effort: 失敗しても削除は続行する。
    }
  }

  // DB から削除(PullRequest / PreviewEnvironment / 設定は cascade)。
  await prisma.repository.delete({ where: { id: repository.id } });
  return c.json({ ok: true });
});

const rewriteRuleSchema = z.object({
  file: z.string().min(1),
  pattern: z.string().min(1),
  replacement: z.string(),
  flags: z.string().optional(),
});

const overlayFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

// Profile overlay entry: add/replace a file, or remove a default one (issue #56).
const profileOverlayEntrySchema = z.object({
  path: z.string().min(1),
  content: z.string().optional(),
  delete: z.boolean().optional(),
});

// Profile overrides: null = inherit the repository default (issue #52).
// overlayFiles is additive over the defaults instead of replacing them (issue #56).
const profileSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  composePath: z.string().min(1).nullable().optional(),
  webService: z.string().nullable().optional(),
  internalPort: z.coerce.number().int().positive().nullable().optional(),
  fileRewrites: z.array(rewriteRuleSchema).nullable().optional(),
  overlayFiles: z.array(profileOverlayEntrySchema).nullable().optional(),
  resetVolumes: z.boolean().nullable().optional(),
  buildMode: z.enum(["auto", "remote", "local"]).nullable().optional(),
});

const settingsSchema = z.object({
  composePath: z.string().min(1),
  webService: z.string().nullable().optional(),
  internalPort: z.coerce.number().int().positive().nullable().optional(),
  fileRewrites: z.array(rewriteRuleSchema).optional(),
  overlayFiles: z.array(overlayFileSchema).optional(),
  resetVolumes: z.boolean().optional(),
  buildMode: z.enum(["auto", "remote", "local"]).nullable().optional(),
  profiles: z.array(profileSchema).optional(),
});

repositoriesRoutes.put("/:owner/:name/settings", async (c) => {
  const { owner, name } = c.req.param();
  const repository = await findRepo(owner, name);
  if (!repository) return c.json({ error: "Repository not found" }, 404);

  const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
  }

  const profiles = parsed.data.profiles ?? [];
  const profileNames = profiles.map((p) => p.name.trim());
  // zodのmin(1)は空白のみの名前を通すため、trim後の空文字はここで拒否する(issue #54)。
  if (profileNames.some((n) => n.length === 0)) {
    return c.json({ error: "プロファイル名を入力してください。" }, 400);
  }
  if (new Set(profileNames).size !== profileNames.length) {
    return c.json({ error: "プロファイル名が重複しています。" }, 400);
  }

  // 既存プロファイルとの同期: 自リポジトリのidのみ更新対象とし、payloadに無い既存
  // プロファイルは削除、id無し(または他リポジトリのid)は新規作成する(issue #52)。
  const existing = await prisma.settingsProfile.findMany({
    where: { repositoryId: repository.id },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((p) => p.id));
  const keptIds = new Set(
    profiles.map((p) => p.id).filter((id): id is string => !!id && existingIds.has(id)),
  );

  const profileData = (p: (typeof profiles)[number]) => ({
    name: p.name.trim(),
    composePath: p.composePath ?? null,
    webService: p.webService ?? null,
    internalPort: p.internalPort ?? null,
    fileRewrites: p.fileRewrites ? JSON.stringify(p.fileRewrites) : null,
    overlayFiles: p.overlayFiles ? JSON.stringify(p.overlayFiles) : null,
    resetVolumes: p.resetVolumes ?? null,
    buildMode: p.buildMode ?? null,
  });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.settingsProfile.deleteMany({
      where: { repositoryId: repository.id, id: { notIn: [...keptIds] } },
    });
    for (const p of profiles) {
      if (p.id && keptIds.has(p.id)) {
        await tx.settingsProfile.update({ where: { id: p.id }, data: profileData(p) });
      } else {
        await tx.settingsProfile.create({
          data: { repositoryId: repository.id, ...profileData(p) },
        });
      }
    }
    return tx.repository.update({
      where: { id: repository.id },
      data: {
        composePath: parsed.data.composePath,
        webService: parsed.data.webService ?? null,
        internalPort: parsed.data.internalPort ?? null,
        fileRewrites: parsed.data.fileRewrites ? JSON.stringify(parsed.data.fileRewrites) : null,
        overlayFiles: parsed.data.overlayFiles ? JSON.stringify(parsed.data.overlayFiles) : null,
        resetVolumes: parsed.data.resetVolumes ?? false,
        buildMode: parsed.data.buildMode ?? null,
      },
      include: { profiles: { orderBy: { name: "asc" } } },
    });
  });
  return c.json({ repository: updated });
});

// --- Pull requests (nested under a repository) ---

repositoriesRoutes.post("/:owner/:name/pulls/sync", async (c) => {
  const { owner, name } = c.req.param();
  const repository = await findRepo(owner, name);
  if (!repository) return c.json({ error: "Repository not found" }, 404);
  const count = await syncPullRequests(repository);
  return c.json({ count });
});

repositoriesRoutes.get("/:owner/:name/pulls", async (c) => {
  const { owner, name } = c.req.param();
  const repository = await findRepo(owner, name);
  if (!repository) return c.json({ error: "Repository not found" }, 404);

  const pullRequests = await prisma.pullRequest.findMany({
    where: { repositoryId: repository.id },
    include: { preview: true },
    orderBy: { prUpdatedAt: "desc" },
  });
  return c.json({ repository, pullRequests });
});

repositoriesRoutes.get("/:owner/:name/pulls/:number", async (c) => {
  const { owner, name } = c.req.param();
  const number = Number(c.req.param("number"));
  if (!Number.isInteger(number)) return c.json({ error: "Invalid pull request number" }, 400);

  const repository = await findRepo(owner, name);
  if (!repository) return c.json({ error: "Repository not found" }, 404);

  const refresh = c.req.query("refresh") === "1";
  let pullRequest = await prisma.pullRequest.findUnique({
    where: { repositoryId_number: { repositoryId: repository.id, number } },
  });
  let loadError: string | null = null;

  // キャッシュが無い、または明示更新(?refresh=1)時のみ GitHub から取得する。
  // ページを開くたびにAPIを叩かないようにしてレート制限を抑える(issue #10)。
  if (refresh || !pullRequest) {
    try {
      pullRequest = await fetchAndCachePullRequest(repository, number);
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Failed to fetch from GitHub";
    }
  }

  if (!pullRequest) return c.json({ error: "Pull request not found" }, 404);

  const preview = await prisma.previewEnvironment.findUnique({
    where: { pullRequestId: pullRequest.id },
  });

  return c.json({ pullRequest, preview, loadError });
});

repositoriesRoutes.get("/:owner/:name/pulls/:number/diff", async (c) => {
  const { owner, name } = c.req.param();
  const number = Number(c.req.param("number"));
  if (!Number.isInteger(number)) return c.json({ error: "Invalid pull request number" }, 400);

  const refresh = c.req.query("refresh") === "1";
  const repository = await findRepo(owner, name);
  if (!repository) return c.json({ error: "Repository not found" }, 404);

  const pr = await prisma.pullRequest.findUnique({
    where: { repositoryId_number: { repositoryId: repository.id, number } },
  });

  // キャッシュ優先。無い or 明示更新時のみ取得して保存(issue #10)。
  if (!refresh && pr?.diffCache != null) {
    return c.json({ diff: pr.diffCache, cached: true });
  }
  try {
    const diff = await fetchPullRequestDiff(repository, number);
    if (pr) await prisma.pullRequest.update({ where: { id: pr.id }, data: { diffCache: diff } });
    return c.json({ diff });
  } catch (e) {
    return c.json({
      diff: pr?.diffCache ?? "",
      error: e instanceof Error ? e.message : "Failed to fetch diff",
    });
  }
});

repositoriesRoutes.get("/:owner/:name/pulls/:number/comments", async (c) => {
  const { owner, name } = c.req.param();
  const number = Number(c.req.param("number"));
  if (!Number.isInteger(number)) return c.json({ error: "Invalid pull request number" }, 400);

  const refresh = c.req.query("refresh") === "1";
  const repository = await findRepo(owner, name);
  if (!repository) return c.json({ error: "Repository not found" }, 404);

  const pr = await prisma.pullRequest.findUnique({
    where: { repositoryId_number: { repositoryId: repository.id, number } },
  });

  // キャッシュ優先(issue #10)。
  if (!refresh && pr?.commentsCache != null) {
    try {
      return c.json({ comments: JSON.parse(pr.commentsCache) as unknown, cached: true });
    } catch {
      // キャッシュが壊れている場合は取得し直す。
    }
  }
  try {
    const comments = await fetchPullRequestComments(repository, number);
    if (pr) {
      await prisma.pullRequest.update({
        where: { id: pr.id },
        data: { commentsCache: JSON.stringify(comments) },
      });
    }
    return c.json({ comments });
  } catch (e) {
    let cached: unknown = [];
    try {
      cached = pr?.commentsCache ? JSON.parse(pr.commentsCache) : [];
    } catch {
      cached = [];
    }
    return c.json({
      comments: cached,
      error: e instanceof Error ? e.message : "Failed to fetch comments",
    });
  }
});

// --- Preview environment operations ---

async function findPull(owner: string, name: string, number: number) {
  const repo = await findRepo(owner, name);
  if (!repo) return null;
  return prisma.pullRequest.findUnique({
    where: { repositoryId_number: { repositoryId: repo.id, number } },
  });
}

repositoriesRoutes.get("/:owner/:name/pulls/:number/preview", async (c) => {
  const { owner, name } = c.req.param();
  const number = Number(c.req.param("number"));
  if (!Number.isInteger(number)) return c.json({ error: "Invalid pull request number" }, 400);
  const pull = await findPull(owner, name, number);
  if (!pull) return c.json({ error: "Pull request not found" }, 404);
  const preview = await prisma.previewEnvironment.findUnique({
    where: { pullRequestId: pull.id },
  });
  return c.json({ preview });
});

repositoriesRoutes.post("/:owner/:name/pulls/:number/preview", async (c) => {
  const { owner, name } = c.req.param();
  const number = Number(c.req.param("number"));
  if (!Number.isInteger(number)) return c.json({ error: "Invalid pull request number" }, 400);
  const repository = await findRepo(owner, name);
  if (!repository) return c.json({ error: "Repository not found" }, 404);
  const pull = await prisma.pullRequest.findUnique({
    where: { repositoryId_number: { repositoryId: repository.id, number } },
  });
  if (!pull) return c.json({ error: "Pull request not found" }, 404);

  // ボディは任意。ビルドオプション(noCache #20 / resetVolumes #41 / keepTunnel #42 / profileId #52)。
  const opts = await parseBuildOptions(c);

  // 使用するプロファイルを解決する(未指定なら既存previewのプロファイルを維持)。
  const existing = await prisma.previewEnvironment.findUnique({
    where: { pullRequestId: pull.id },
    select: { profileId: true },
  });
  const { profile, error } = await resolveBuildProfile(
    repository,
    opts.profileId,
    existing?.profileId,
  );
  if (error) return c.json({ error }, 400);

  // プレビュー設定(プロファイル適用後)が未設定なら起動しない(pending で固まるのを防ぐ。issue #8)。
  const effective = resolveSettings(repository, profile);
  if (!effective.webService || !effective.internalPort) {
    return c.json({ error: SETTINGS_INCOMPLETE_ERROR }, 400);
  }

  // 即座にpending状態のpreviewを用意し、フロントがSSE購読を開始できるようにする。
  const preview = await prisma.previewEnvironment.upsert({
    where: { pullRequestId: pull.id },
    create: {
      pullRequestId: pull.id,
      status: "pending",
      composeProject: composeProjectName(owner, name, number),
      profileId: profile?.id ?? null,
    },
    update: { status: "pending", profileId: profile?.id ?? null },
  });
  const jobId = await enqueueJob("build", {
    previewId: preview.id,
    noCache: opts.noCache,
    resetVolumes: opts.resetVolumes,
    keepTunnel: opts.keepTunnel,
  });
  return c.json({ jobId, previewId: preview.id });
});

repositoriesRoutes.delete("/:owner/:name/pulls/:number/preview", async (c) => {
  const { owner, name } = c.req.param();
  const number = Number(c.req.param("number"));
  if (!Number.isInteger(number)) return c.json({ error: "Invalid pull request number" }, 400);
  const pull = await findPull(owner, name, number);
  if (!pull) return c.json({ error: "Pull request not found" }, 404);
  const preview = await prisma.previewEnvironment.findUnique({
    where: { pullRequestId: pull.id },
  });
  if (!preview) return c.json({ ok: true });
  // ビルド中なら中断してワーカーを解放する(issue #33)。
  cancelBuild(preview.id);
  const jobId = await enqueueJob("destroy", { previewId: preview.id });
  return c.json({ jobId });
});

// Stop containers without removing them (issue #32).
repositoriesRoutes.post("/:owner/:name/pulls/:number/preview/stop", async (c) => {
  const { owner, name } = c.req.param();
  const number = Number(c.req.param("number"));
  if (!Number.isInteger(number)) return c.json({ error: "Invalid pull request number" }, 400);
  const pull = await findPull(owner, name, number);
  if (!pull) return c.json({ error: "Pull request not found" }, 404);
  const preview = await prisma.previewEnvironment.findUnique({
    where: { pullRequestId: pull.id },
  });
  if (!preview) {
    return c.json({ error: "プレビュー環境がありません。先に起動してください。" }, 400);
  }
  // ビルド中なら中断してワーカーを解放する(issue #33)。
  cancelBuild(preview.id);
  const jobId = await enqueueJob("stop", { previewId: preview.id });
  return c.json({ jobId, previewId: preview.id });
});

// Restart containers without rebuilding (issue #15).
repositoriesRoutes.post("/:owner/:name/pulls/:number/preview/restart", async (c) => {
  const { owner, name } = c.req.param();
  const number = Number(c.req.param("number"));
  if (!Number.isInteger(number)) return c.json({ error: "Invalid pull request number" }, 400);
  const pull = await findPull(owner, name, number);
  if (!pull) return c.json({ error: "Pull request not found" }, 404);
  const preview = await prisma.previewEnvironment.findUnique({
    where: { pullRequestId: pull.id },
  });
  if (!preview) {
    return c.json({ error: "プレビュー環境がありません。先に起動してください。" }, 400);
  }
  // ボディは任意。再起動でも破棄オプションを適用する(issue #58)。
  const body = await c.req
    .json<{ resetVolumes?: boolean; resetTunnel?: boolean }>()
    .catch(() => ({}) as { resetVolumes?: boolean; resetTunnel?: boolean });
  const jobId = await enqueueJob("restart", {
    previewId: preview.id,
    resetVolumes: body.resetVolumes === true,
    resetTunnel: body.resetTunnel === true,
  });
  return c.json({ jobId, previewId: preview.id });
});

// --- Branch-based previews (issue #25) ---

/** List branches available on GitHub for this repository(5分キャッシュ。?refresh=1で更新)。 */
repositoriesRoutes.get("/:owner/:name/branches", async (c) => {
  const { owner, name } = c.req.param();
  const repository = await findRepo(owner, name);
  if (!repository) return c.json({ error: "Repository not found" }, 404);
  const refresh = c.req.query("refresh") === "1";
  try {
    const branches = await listRepositoryBranches(owner, name, refresh);
    return c.json({ branches });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "ブランチの取得に失敗しました" }, 502);
  }
});

/** List branch-based preview environments for this repository. */
repositoriesRoutes.get("/:owner/:name/branch-previews", async (c) => {
  const { owner, name } = c.req.param();
  const repository = await findRepo(owner, name);
  if (!repository) return c.json({ error: "Repository not found" }, 404);
  const previews = await prisma.previewEnvironment.findMany({
    where: { repositoryId: repository.id, kind: "branch" },
    orderBy: { updatedAt: "desc" },
  });
  return c.json({ previews });
});

/** Start (or rebuild) a preview for a specific branch. */
repositoriesRoutes.post("/:owner/:name/branch-preview", async (c) => {
  const { owner, name } = c.req.param();
  const repository = await findRepo(owner, name);
  if (!repository) return c.json({ error: "Repository not found" }, 404);

  const body = await c.req
    .json<BuildOptionsBody & { branch?: string }>()
    .catch(() => ({}) as BuildOptionsBody & { branch?: string });
  const branch = body.branch?.trim();
  if (!branch) return c.json({ error: "branch を指定してください" }, 400);
  const opts = {
    noCache: body.noCache === true,
    resetVolumes: body.resetVolumes === true,
    keepTunnel: body.keepTunnel === true,
  };
  const requestedProfileId =
    body.profileId === null
      ? null
      : typeof body.profileId === "string"
        ? body.profileId
        : undefined;

  // 使用するプロファイルを解決する(未指定なら既存previewのプロファイルを維持)。issue #52。
  const existing = await prisma.previewEnvironment.findUnique({
    where: { repositoryId_branchRef: { repositoryId: repository.id, branchRef: branch } },
    select: { profileId: true },
  });
  const { profile, error } = await resolveBuildProfile(
    repository,
    requestedProfileId,
    existing?.profileId,
  );
  if (error) return c.json({ error }, 400);

  const effective = resolveSettings(repository, profile);
  if (!effective.webService || !effective.internalPort) {
    return c.json({ error: SETTINGS_INCOMPLETE_ERROR }, 400);
  }

  const preview = await prisma.previewEnvironment.upsert({
    where: { repositoryId_branchRef: { repositoryId: repository.id, branchRef: branch } },
    create: {
      kind: "branch",
      repositoryId: repository.id,
      branchRef: branch,
      status: "pending",
      composeProject: branchComposeProjectName(owner, name, branch),
      profileId: profile?.id ?? null,
    },
    update: { status: "pending", profileId: profile?.id ?? null },
  });
  const jobId = await enqueueJob("build", { previewId: preview.id, ...opts });
  return c.json({ jobId, previewId: preview.id });
});
