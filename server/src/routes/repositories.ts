import { Hono } from "hono";
import { z } from "zod";

import { prisma } from "../db/client";
import {
  fetchAndCachePullRequest,
  fetchPullRequestComments,
  fetchPullRequestDiff,
  syncPullRequests,
} from "../github/pulls";
import { addRepository } from "../github/repositories";
import { enqueueJob } from "../jobs/queue";
import { composeProjectName, destroyPreview } from "../preview/service";

export const repositoriesRoutes = new Hono();

/** Resolve a cached repository by owner/name or return null. */
async function findRepo(owner: string, name: string) {
  return prisma.repository.findUnique({ where: { owner_name: { owner, name } } });
}

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
  const repository = await findRepo(owner, name);
  if (!repository) return c.json({ error: "Repository not found" }, 404);
  return c.json({ repository });
});

// Remove a repository: tear down previews then delete all data (issue #12).
repositoriesRoutes.delete("/:owner/:name", async (c) => {
  const { owner, name } = c.req.param();
  const repository = await prisma.repository.findUnique({
    where: { owner_name: { owner, name } },
    include: { pullRequests: { include: { preview: true } } },
  });
  if (!repository) return c.json({ error: "Repository not found" }, 404);

  // 稼働中のプレビューを破棄(コンテナ・ボリューム・workspace・トンネルを片付ける)。
  for (const pr of repository.pullRequests) {
    if (pr.preview) {
      try {
        await destroyPreview(pr.id);
      } catch {
        // best-effort: 失敗しても削除は続行する。
      }
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

const settingsSchema = z.object({
  composePath: z.string().min(1),
  webService: z.string().nullable().optional(),
  internalPort: z.coerce.number().int().positive().nullable().optional(),
  fileRewrites: z.array(rewriteRuleSchema).optional(),
  overlayFiles: z.array(overlayFileSchema).optional(),
  resetVolumes: z.boolean().optional(),
});

repositoriesRoutes.put("/:owner/:name/settings", async (c) => {
  const { owner, name } = c.req.param();
  const repository = await findRepo(owner, name);
  if (!repository) return c.json({ error: "Repository not found" }, 404);

  const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
  }

  const updated = await prisma.repository.update({
    where: { id: repository.id },
    data: {
      composePath: parsed.data.composePath,
      webService: parsed.data.webService ?? null,
      internalPort: parsed.data.internalPort ?? null,
      fileRewrites: parsed.data.fileRewrites ? JSON.stringify(parsed.data.fileRewrites) : null,
      overlayFiles: parsed.data.overlayFiles ? JSON.stringify(parsed.data.overlayFiles) : null,
      resetVolumes: parsed.data.resetVolumes ?? false,
    },
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

  // プレビュー設定が未設定なら起動しない(pending で固まるのを防ぐ。issue #8)。
  if (!repository.webService || !repository.internalPort) {
    return c.json(
      {
        error:
          "プレビュー設定が未設定です。リポジトリのプレビュー設定で公開Webサービス名と内部ポートを指定してください。",
      },
      400,
    );
  }

  // 即座にpending状態のpreviewを用意し、フロントがSSE購読を開始できるようにする。
  const preview = await prisma.previewEnvironment.upsert({
    where: { pullRequestId: pull.id },
    create: {
      pullRequestId: pull.id,
      status: "pending",
      composeProject: composeProjectName(owner, name, number),
    },
    update: { status: "pending" },
  });
  const jobId = await enqueueJob("build", { pullRequestId: pull.id });
  return c.json({ jobId, previewId: preview.id });
});

repositoriesRoutes.delete("/:owner/:name/pulls/:number/preview", async (c) => {
  const { owner, name } = c.req.param();
  const number = Number(c.req.param("number"));
  if (!Number.isInteger(number)) return c.json({ error: "Invalid pull request number" }, 400);
  const pull = await findPull(owner, name, number);
  if (!pull) return c.json({ error: "Pull request not found" }, 404);
  const jobId = await enqueueJob("destroy", { pullRequestId: pull.id });
  return c.json({ jobId });
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
  const jobId = await enqueueJob("restart", { pullRequestId: pull.id });
  return c.json({ jobId, previewId: preview.id });
});
