import type {
  AppConfig,
  CommentDTO,
  OverlayFile,
  PreviewDTO,
  PreviewListItem,
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

export interface RepoSettingsInput {
  composePath: string;
  webService: string | null;
  internalPort: number | null;
  fileRewrites: RewriteRule[];
  overlayFiles: OverlayFile[];
  resetVolumes: boolean;
}

export const api = {
  getConfig: () => request<AppConfig>("/config"),

  getMetrics: () => request<SystemMetrics>("/metrics"),

  getPreviews: () => request<{ previews: PreviewListItem[] }>("/preview"),

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

  startPreview: (owner: string, name: string, number: number) =>
    request<{ jobId: string; previewId: string }>(
      `/repositories/${owner}/${name}/pulls/${number}/preview`,
      { method: "POST" },
    ),

  destroyPreview: (owner: string, name: string, number: number) =>
    request<{ jobId: string }>(`/repositories/${owner}/${name}/pulls/${number}/preview`, {
      method: "DELETE",
    }),
};
