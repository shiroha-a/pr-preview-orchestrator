import type {
  AppConfig,
  CommentDTO,
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

export const api = {
  getConfig: () => request<AppConfig>("/config"),

  getMetrics: () => request<SystemMetrics>("/metrics"),

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

  restartPreview: (owner: string, name: string, number: number) =>
    request<{ jobId: string; previewId: string }>(
      `/repositories/${owner}/${name}/pulls/${number}/preview/restart`,
      { method: "POST" },
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

  restartPreviewById: (id: string) =>
    request<{ jobId: string; previewId: string }>(`/preview/${id}/restart`, { method: "POST" }),

  stopPreviewById: (id: string) =>
    request<{ jobId: string; previewId: string }>(`/preview/${id}/stop`, { method: "POST" }),

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
