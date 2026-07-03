export type BadgeTone = "gray" | "green" | "blue" | "amber" | "red" | "purple";

export interface RewriteRule {
  file: string;
  pattern: string;
  replacement: string;
  flags?: string;
}

export interface OverlayFile {
  path: string;
  content: string;
}

// プロファイルのオーバーレイエントリ: 既定への追加(同pathは上書き)または
// delete=trueで既定ファイルの除外(issue #56)。
export interface ProfileOverlayEntry {
  path: string;
  content?: string;
  delete?: boolean;
}

export interface PrLabel {
  name: string;
  color: string;
}

// 既定設定を項目単位で上書きするプロファイル(null=既定を継承。issue #52)。
export interface SettingsProfileDTO {
  id: string;
  repositoryId: string;
  name: string;
  // Newline-separated compose file paths; later files override earlier ones.
  composePath: string | null;
  webService: string | null;
  internalPort: number | null;
  fileRewrites: string | null;
  overlayFiles: string | null;
  resetVolumes: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryDTO {
  id: string;
  owner: string;
  name: string;
  installationId?: number | null;
  // Newline-separated compose file paths (issue #52).
  composePath: string;
  webService: string | null;
  internalPort: number | null;
  fileRewrites: string | null;
  overlayFiles: string | null;
  resetVolumes: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { pullRequests: number };
  // Included by GET /repositories/:owner/:name (issue #52).
  profiles?: SettingsProfileDTO[];
}

export interface PreviewDTO {
  id: string;
  // "pr" | "branch" (issue #25)
  kind: string;
  pullRequestId: string | null;
  repositoryId: string | null;
  branchRef: string | null;
  status: string;
  composeProject: string;
  url: string | null;
  hostPort: number | null;
  commitSha: string | null;
  logs: string;
  // 使用中の設定プロファイル(null=既定の設定。issue #52)。
  profileId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PreviewListItem extends PreviewDTO {
  // Set for PR previews; null for branch previews.
  pullRequest: {
    number: number;
    title: string;
    repository: { owner: string; name: string };
  } | null;
  // Set for branch previews; null for PR previews.
  repository: { owner: string; name: string } | null;
}

export interface BranchInfo {
  name: string;
  commitSha: string;
}

export interface PullRequestDTO {
  id: string;
  repositoryId: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  authorLogin: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  htmlUrl: string | null;
  prUpdatedAt: string;
  // JSON-encoded PrLabel[] and milestone title; parsed on display (issue #24).
  labels: string | null;
  milestone: string | null;
  preview?: PreviewDTO | null;
}

export interface CommentDTO {
  id: string;
  kind: "issue" | "review-comment" | "review";
  author: string;
  authorAvatar: string | null;
  body: string;
  createdAt: string;
  htmlUrl: string | null;
  state: string | null;
  path: string | null;
  line: number | null;
}

// 個別コンテナ(サービス)の使用量。
export interface ContainerUsage {
  name: string;
  cpu: number;
  memBytes: number;
}

// プレビュー(composeプロジェクト)単位に集計したリソース使用量 + 内訳。
export interface PreviewUsage {
  label: string;
  cpu: number; // 合計CPU使用率(%)
  memBytes: number; // 合計使用メモリ(バイト)
  containers: ContainerUsage[]; // 個別コンテナの内訳
}

export interface SystemMetrics {
  memory: { total: number; used: number; free: number };
  swap: { total: number; used: number; free: number };
  disk: { total: number; used: number; free: number };
  loadavg: number[];
  previews: PreviewUsage[];
}

export interface AppConfig {
  tokenSet: boolean;
  webhookSecretSet: boolean;
  adminAuthEnabled: boolean;
  preview: {
    host: string;
    portMin: number;
    portMax: number;
    workspacesDir: string;
    tunnel: boolean;
  };
}

export interface UserDTO {
  id: string;
  username: string;
  createdAt: string;
  updatedAt: string;
}
