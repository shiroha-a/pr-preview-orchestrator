export type BadgeTone = "gray" | "green" | "blue" | "amber" | "red" | "purple";

export interface RepositoryDTO {
  id: string;
  owner: string;
  name: string;
  installationId?: number | null;
  composePath: string;
  webService: string | null;
  internalPort: number | null;
  createdAt: string;
  updatedAt: string;
  _count?: { pullRequests: number };
}

export interface PreviewDTO {
  id: string;
  pullRequestId: string;
  status: string;
  composeProject: string;
  url: string | null;
  hostPort: number | null;
  commitSha: string | null;
  logs: string;
  createdAt: string;
  updatedAt: string;
}

export interface PullRequestDTO {
  id: string;
  repositoryId: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  authorLogin: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  htmlUrl: string | null;
  prUpdatedAt: string;
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

export interface AppConfig {
  tokenSet: boolean;
  preview: {
    host: string;
    portMin: number;
    portMax: number;
    workspacesDir: string;
    tunnel: boolean;
  };
}
