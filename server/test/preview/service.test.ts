import { describe, expect, it } from "vitest";

import type { PullRequest, Repository, SettingsProfile } from "../../src/generated/prisma/client";
import { BuildCancelledError } from "../../src/preview/engine";
import {
  executeBuildStep,
  resolveBuildTarget,
  type PreviewWithTarget,
} from "../../src/preview/service";

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
    buildMode: null,
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
    buildMode: null,
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

// executeBuildStep: ビルド工程の実行先決定(issue #80)。リモート分岐と
// フォールバックを疑似dispatch/buildで検証する(レビュー指摘のカバレッジ補完)。
describe("executeBuildStep", () => {
  interface Trace {
    dispatched: boolean;
    builtLocally: boolean;
    logs: string[];
  }

  function run(opts: { buildMode: string; agentOnline: boolean; dispatchError?: Error }): {
    trace: Trace;
    result: Promise<void>;
  } {
    const trace: Trace = { dispatched: false, builtLocally: false, logs: [] };
    const result = executeBuildStep({
      buildMode: opts.buildMode,
      agentOnline: opts.agentOnline,
      log: (line) => trace.logs.push(line),
      dispatchRemote: async () => {
        trace.dispatched = true;
        if (opts.dispatchError) throw opts.dispatchError;
      },
      buildLocal: async () => {
        trace.builtLocally = true;
      },
    });
    return { trace, result };
  }

  it("local: リモートへ行かずローカルビルドのみ実行する", async () => {
    const { trace, result } = run({ buildMode: "local", agentOnline: true });
    await result;
    expect(trace.dispatched).toBe(false);
    expect(trace.builtLocally).toBe(true);
  });

  it("auto+オフライン: リモートをスキップして直接ローカルビルドする", async () => {
    const { trace, result } = run({ buildMode: "auto", agentOnline: false });
    await result;
    expect(trace.dispatched).toBe(false);
    expect(trace.builtLocally).toBe(true);
    expect(trace.logs.some((l) => l.includes("Dispatching"))).toBe(false);
  });

  it("auto+オンライン: リモート成功時はローカルビルドしない", async () => {
    const { trace, result } = run({ buildMode: "auto", agentOnline: true });
    await result;
    expect(trace.dispatched).toBe(true);
    expect(trace.builtLocally).toBe(false);
  });

  it("auto+オンライン: リモート失敗時はWARNしてローカルへフォールバックする", async () => {
    const { trace, result } = run({
      buildMode: "auto",
      agentOnline: true,
      dispatchError: new Error("boom"),
    });
    await result;
    expect(trace.dispatched).toBe(true);
    expect(trace.builtLocally).toBe(true);
    expect(trace.logs.some((l) => l.includes("falling back"))).toBe(true);
  });

  it("remote+オフライン: 明示エラーで失敗しローカルビルドしない", async () => {
    const { trace, result } = run({ buildMode: "remote", agentOnline: false });
    await expect(result).rejects.toThrow(/オンラインの外部ビルドサーバーがありません/);
    expect(trace.dispatched).toBe(false);
    expect(trace.builtLocally).toBe(false);
  });

  it("remote+オンライン: リモート失敗はフォールバックせず失敗する", async () => {
    const { trace, result } = run({
      buildMode: "remote",
      agentOnline: true,
      dispatchError: new Error("boom"),
    });
    await expect(result).rejects.toThrow(/リモートビルドに失敗しました: boom/);
    expect(trace.builtLocally).toBe(false);
  });

  it("キャンセルはモードに関わらずそのまま伝播しローカルビルドしない", async () => {
    const { trace, result } = run({
      buildMode: "auto",
      agentOnline: true,
      dispatchError: new BuildCancelledError(),
    });
    await expect(result).rejects.toBeInstanceOf(BuildCancelledError);
    expect(trace.builtLocally).toBe(false);
  });
});
