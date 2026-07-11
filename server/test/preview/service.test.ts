import { describe, expect, it } from "vitest";

import type { PullRequest, Repository, SettingsProfile } from "../../src/generated/prisma/client";
import { resolveBuildTarget, type PreviewWithTarget } from "../../src/preview/service";

function makeRepo(overrides: Partial<Repository> = {}): Repository {
  return {
    id: "repo1",
    owner: "acme",
    name: "app",
    installationId: null,
    composePath: "docker-compose.yml",
    webService: "web",
    internalPort: 3000,
    fileRewrites: null,
    overlayFiles: null,
    resetVolumes: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePullRequest(
  repo: Repository,
  overrides: Partial<PullRequest> = {},
): PullRequest & { repository: Repository } {
  return {
    id: "pr1",
    repositoryId: repo.id,
    number: 123,
    title: "Add awesome feature",
    body: null,
    state: "open",
    draft: false,
    authorLogin: "octocat",
    headRef: "feature/awesome",
    headSha: "abcdef1234567890",
    baseRef: "main",
    htmlUrl: null,
    prUpdatedAt: new Date(),
    labels: null,
    milestone: null,
    diffCache: null,
    commentsCache: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    repository: repo,
    ...overrides,
  };
}

function makeProfile(overrides: Partial<SettingsProfile> = {}): SettingsProfile {
  return {
    id: "profile1",
    repositoryId: "repo1",
    name: "search",
    composePath: null,
    webService: null,
    internalPort: null,
    fileRewrites: null,
    overlayFiles: null,
    resetVolumes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePreview(overrides: Partial<PreviewWithTarget> = {}): PreviewWithTarget {
  return {
    id: "preview1",
    kind: "pr",
    pullRequestId: null,
    repositoryId: null,
    branchRef: null,
    status: "idle",
    composeProject: "preview-acme-app-pr123",
    url: null,
    hostPort: null,
    commitSha: null,
    logs: "",
    profileId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    pullRequest: null,
    repository: null,
    profile: null,
    ...overrides,
  };
}

describe("resolveBuildTarget templateVars (issue #75)", () => {
  it("PRプレビューではPR番号とタイトルを展開する", () => {
    const repo = makeRepo();
    const preview = makePreview({
      kind: "pr",
      pullRequestId: "pr1",
      pullRequest: makePullRequest(repo),
    });
    expect(resolveBuildTarget(preview).templateVars).toEqual({
      PR_NUMBER: "123",
      PR_TITLE: "Add awesome feature",
      PROFILE_NAME: "",
    });
  });

  it("PRプレビューでプロファイル使用時はPROFILE_NAMEを展開する", () => {
    const repo = makeRepo();
    const preview = makePreview({
      kind: "pr",
      pullRequestId: "pr1",
      pullRequest: makePullRequest(repo),
      profileId: "profile1",
      profile: makeProfile({ name: "search" }),
    });
    expect(resolveBuildTarget(preview).templateVars.PROFILE_NAME).toBe("search");
  });

  it("ブランチプレビューではPR番号・タイトルの代わりにブランチ名を展開する", () => {
    const preview = makePreview({
      kind: "branch",
      repositoryId: "repo1",
      repository: makeRepo(),
      branchRef: "develop",
    });
    expect(resolveBuildTarget(preview).templateVars).toEqual({
      PR_NUMBER: "develop",
      PR_TITLE: "develop",
      PROFILE_NAME: "",
    });
  });

  it("ブランチプレビューでもプロファイル名を展開する", () => {
    const preview = makePreview({
      kind: "branch",
      repositoryId: "repo1",
      repository: makeRepo(),
      branchRef: "develop",
      profileId: "profile1",
      profile: makeProfile({ name: "no-search" }),
    });
    expect(resolveBuildTarget(preview).templateVars.PROFILE_NAME).toBe("no-search");
  });
});
