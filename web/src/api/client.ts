import type {
  AppConfig,
  CommentDTO,
  DockerDiskUsage,
  OverlayFile,
  PreviewDTO,
  PreviewListItem,
  ProfileOverlayEntry,
  PullRequestDTO,
  RepositoryDTO,
  RewriteRule,
  SystemMetrics,
} from "../types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: string }).error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

/** Profile payload for settings sync; null fields inherit the defaults (issue #52). */
export interface ProfileInput {
  /** Existing profile id to update; omit to create a new profile. */
  id?: string;
  name: string;
  composePath: string | null;
  webService: string | null;
  internalPort: number | null;
  fileRewrites: RewriteRule[] | null;
  /** Additive entries applied over the default overlays (issue #56). */
  overlayFiles: ProfileOverlayEntry[] | null;
  resetVolumes: boolean | null;
}

export interface RepoSettingsInput {
  composePath: string;
  webService: string | null;
  internalPort: number | null;
  fileRewrites: RewriteRule[];
  overlayFiles: OverlayFile[];
  resetVolumes: boolean;
  profiles: ProfileInput[];
}

export interface CreateUserInput {
  username: string;
  password: string;
}

/** Build options for starting/rebuilding a preview (issue #20/#41/#42/#52). */
export interface StartPreviewOptions {
  noCache?: boolean;
  resetVolumes?: boolean;
  keepTunnel?: boolean;
  /** Settings profile to build with: id, null for the defaults, undefined to keep current. */
  profileId?: string | null;
}

/** Restart options: the discard checkboxes also apply to a plain restart (issue #58). */
export interface RestartPreviewOptions {
  resetVolumes?: boolean;
  resetTunnel?: boolean;
}

/** A docker volume of a preview's compose project (issue #61). */
export interface VolumeInfo {
  name: string;
  /** Approximate content size in MB, or null when unknown. */
  sizeMb: number | null;
}

// CFのリクエストbodyサイズ上限(既定100MB)を安全に下回るチャンクで分割する(issue #61)。
export const VOLUME_UPLOAD_CHUNK_SIZE = 32 * 1024 * 1024;

export const api = {
  getConfig: () => request<AppConfig>("/config"),

  getMetrics: () => request<SystemMetrics>("/metrics"),

  // Dockerのディスク使用状況(docker system df 相当。issue #68)。
  getDockerDf: (refresh = false) =>
    request<DockerDiskUsage>(`/docker/df${refresh ? "?refresh=1" : ""}`),

  getPreviews: () => request<{ previews: PreviewListItem[] }>("/preview"),

  pruneBuilderCache: () =>
    request<{ output: string }>("/preview/builder-prune", { method: "POST" }),

  getRepositories: () => request<{ repositories: RepositoryDTO[] }>("/repositories"),

  addRepository: (owner: string, name: string) =>
    request<{ repository: RepositoryDTO }>("/repositories", {
      method: "POST",
      body: JSON.stringify({ owner, name }),
    }),

  deleteRepository: (owner: string, name: string) =>
    request<{ ok: boolean }>(`/repositories/${owner}/${name}`, { method: "DELETE" }),

  getRepo: (owner: string, name: string) =>
    request<{ repository: RepositoryDTO }>(`/repositories/${owner}/${name}`),

  updateRepoSettings: (owner: string, name: string, body: RepoSettingsInput) =>
    request<{ repository: RepositoryDTO }>(`/repositories/${owner}/${name}/settings`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  getRepoPulls: (owner: string, name: string) =>
    request<{ repository: RepositoryDTO; pullRequests: PullRequestDTO[] }>(
      `/repositories/${owner}/${name}/pulls`,
    ),

  syncPulls: (owner: string, name: string) =>
    request<{ count: number }>(`/repositories/${owner}/${name}/pulls/sync`, { method: "POST" }),

  getPull: (owner: string, name: string, number: number, refresh = false) =>
    request<{ pullRequest: PullRequestDTO; preview: PreviewDTO | null; loadError: string | null }>(
      `/repositories/${owner}/${name}/pulls/${number}${refresh ? "?refresh=1" : ""}`,
    ),

  getPullDiff: (owner: string, name: string, number: number, refresh = false) =>
    request<{ diff: string; error?: string }>(
      `/repositories/${owner}/${name}/pulls/${number}/diff${refresh ? "?refresh=1" : ""}`,
    ),

  getPullComments: (owner: string, name: string, number: number, refresh = false) =>
    request<{ comments: CommentDTO[]; error?: string }>(
      `/repositories/${owner}/${name}/pulls/${number}/comments${refresh ? "?refresh=1" : ""}`,
    ),

  getPreview: (owner: string, name: string, number: number) =>
    request<{ preview: PreviewDTO | null }>(
      `/repositories/${owner}/${name}/pulls/${number}/preview`,
    ),

  startPreview: (owner: string, name: string, number: number, opts: StartPreviewOptions = {}) =>
    request<{ jobId: string; previewId: string }>(
      `/repositories/${owner}/${name}/pulls/${number}/preview`,
      { method: "POST", body: JSON.stringify(opts) },
    ),

  restartPreview: (owner: string, name: string, number: number, opts: RestartPreviewOptions = {}) =>
    request<{ jobId: string; previewId: string }>(
      `/repositories/${owner}/${name}/pulls/${number}/preview/restart`,
      { method: "POST", body: JSON.stringify(opts) },
    ),

  destroyPreview: (owner: string, name: string, number: number) =>
    request<{ jobId: string }>(`/repositories/${owner}/${name}/pulls/${number}/preview`, {
      method: "DELETE",
    }),

  // 破棄せずコンテナを停止する(issue #32)。
  stopPreview: (owner: string, name: string, number: number) =>
    request<{ jobId: string; previewId: string }>(
      `/repositories/${owner}/${name}/pulls/${number}/preview/stop`,
      { method: "POST" },
    ),

  // --- Branch-based previews (issue #25) ---

  getBranches: (owner: string, name: string, refresh = false) =>
    request<{ branches: import("../types").BranchInfo[] }>(
      `/repositories/${owner}/${name}/branches${refresh ? "?refresh=1" : ""}`,
    ),

  getBranchPreviews: (owner: string, name: string) =>
    request<{ previews: PreviewDTO[] }>(`/repositories/${owner}/${name}/branch-previews`),

  startBranchPreview: (
    owner: string,
    name: string,
    branch: string,
    opts: StartPreviewOptions = {},
  ) =>
    request<{ jobId: string; previewId: string }>(`/repositories/${owner}/${name}/branch-preview`, {
      method: "POST",
      body: JSON.stringify({ branch, ...opts }),
    }),

  getPreviewById: (id: string) => request<{ preview: PreviewDTO | null }>(`/preview/${id}`),

  restartPreviewById: (id: string, opts: RestartPreviewOptions = {}) =>
    request<{ jobId: string; previewId: string }>(`/preview/${id}/restart`, {
      method: "POST",
      body: JSON.stringify(opts),
    }),

  stopPreviewById: (id: string) =>
    request<{ jobId: string; previewId: string }>(`/preview/${id}/stop`, { method: "POST" }),

  // --- Volume export/import (issue #61) ---

  listPreviewVolumes: (id: string) => request<{ volumes: VolumeInfo[] }>(`/preview/${id}/volumes`),

  /** Download URL for a volume's tar.gz export (used as a plain link href). */
  volumeExportUrl: (id: string, volume: string) =>
    `/api/preview/${id}/volumes/${encodeURIComponent(volume)}/export`,

  /**
   * Upload a tar.gz archive in chunks and enqueue the import job. Chunked to
   * stay below Cloudflare's request body size limit (issue #61).
   */
  importPreviewVolume: async (
    id: string,
    volume: string,
    file: Blob,
    onProgress?: (sentBytes: number, totalBytes: number) => void,
  ): Promise<{ jobId: string; previewId: string }> => {
    const base = `/preview/${id}/volumes/${encodeURIComponent(volume)}/import`;
    const totalChunks = Math.max(1, Math.ceil(file.size / VOLUME_UPLOAD_CHUNK_SIZE));
    const { uploadId } = await request<{ uploadId: string }>(`${base}/start`, {
      method: "POST",
      body: JSON.stringify({ totalChunks, totalSize: file.size }),
    });
    try {
      for (let index = 0; index < totalChunks; index++) {
        const chunk = file.slice(
          index * VOLUME_UPLOAD_CHUNK_SIZE,
          Math.min((index + 1) * VOLUME_UPLOAD_CHUNK_SIZE, file.size),
        );
        // request() はJSONのContent-Type固定のため、バイナリは素のfetchで送る。
        const res = await fetch(`/api${base}/${uploadId}/chunk/${index}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: chunk,
        });
        if (!res.ok) {
          const data: unknown = await res.json().catch(() => ({}));
          throw new Error(
            (data as { error?: string }).error ?? `チャンクの送信に失敗しました (${res.status})`,
          );
        }
        onProgress?.(Math.min((index + 1) * VOLUME_UPLOAD_CHUNK_SIZE, file.size), file.size);
      }
      return await request<{ jobId: string; previewId: string }>(`${base}/${uploadId}/finish`, {
        method: "POST",
      });
    } catch (e) {
      // 失敗時はサーバー側の一時ファイルを片付ける(掃除自体の失敗は無視)。
      void request(`${base}/${uploadId}`, { method: "DELETE" }).catch(() => undefined);
      throw e;
    }
  },

  destroyPreviewById: (id: string) =>
    request<{ jobId?: string; ok?: boolean }>(`/preview/${id}`, { method: "DELETE" }),

  getUsers: () => request<{ users: import("../types").UserDTO[] }>("/users"),

  createUser: (body: CreateUserInput) =>
    request<{ user: import("../types").UserDTO }>("/users", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteUser: (id: string) => request<{ ok: boolean }>(`/users/${id}`, { method: "DELETE" }),
};
