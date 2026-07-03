import { describe, expect, it } from "vitest";

import type { Repository, SettingsProfile } from "../../src/generated/prisma/client";
import {
  composeFileArgs,
  mergeOverlayFiles,
  parseComposePaths,
  resolveSettings,
} from "../../src/preview/settings";

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

describe("parseComposePaths", () => {
  it("単一パスをそのまま返す", () => {
    expect(parseComposePaths("docker-compose.yml")).toEqual(["docker-compose.yml"]);
  });

  it("改行区切りの複数パスを分割する", () => {
    expect(parseComposePaths("a.yml\nb.yml\nc.yml")).toEqual(["a.yml", "b.yml", "c.yml"]);
  });

  it("空行と前後の空白を除去する", () => {
    expect(parseComposePaths("  a.yml  \n\n\t b.yml \n")).toEqual(["a.yml", "b.yml"]);
  });

  it("CRLFの改行も扱える", () => {
    expect(parseComposePaths("a.yml\r\nb.yml")).toEqual(["a.yml", "b.yml"]);
  });
});

describe("composeFileArgs", () => {
  it("各パスに-fを付けた引数列を生成する", () => {
    expect(composeFileArgs("a.yml\nb.yml")).toEqual(["-f", "a.yml", "-f", "b.yml"]);
  });

  it("単一パスでは従来と同じ引数になる", () => {
    expect(composeFileArgs("docker-compose.yml")).toEqual(["-f", "docker-compose.yml"]);
  });
});

describe("resolveSettings", () => {
  it("プロファイルなしではリポジトリの既定をそのまま返す", () => {
    const repo = makeRepo();
    expect(resolveSettings(repo, null)).toEqual({
      composePath: "docker-compose.yml",
      webService: "web",
      internalPort: 3000,
      fileRewrites: null,
      overlayFiles: [],
      resetVolumes: false,
    });
  });

  it("プロファイルの非nullフィールドだけ既定を上書きする", () => {
    const repo = makeRepo({ fileRewrites: '[{"file":"a"}]' });
    const profile = makeProfile({
      composePath: "docker-compose.yml\ndocker-compose.search.yml",
      internalPort: 8080,
      resetVolumes: true,
    });
    expect(resolveSettings(repo, profile)).toEqual({
      composePath: "docker-compose.yml\ndocker-compose.search.yml",
      webService: "web",
      internalPort: 8080,
      fileRewrites: '[{"file":"a"}]',
      overlayFiles: [],
      resetVolumes: true,
    });
  });

  it("プロファイルのresetVolumes=falseは既定trueを上書きする", () => {
    const repo = makeRepo({ resetVolumes: true });
    const profile = makeProfile({ resetVolumes: false });
    expect(resolveSettings(repo, profile).resetVolumes).toBe(false);
  });

  it("プロファイルのオーバーレイは既定に追加される(issue #56)", () => {
    const repo = makeRepo({
      overlayFiles: JSON.stringify([{ path: "a.yml", content: "A" }]),
    });
    const profile = makeProfile({
      overlayFiles: JSON.stringify([{ path: "b.yml", content: "B" }]),
    });
    expect(resolveSettings(repo, profile).overlayFiles).toEqual([
      { path: "a.yml", content: "A" },
      { path: "b.yml", content: "B" },
    ]);
  });

  it("プロファイルのオーバーレイのdeleteエントリは既定のファイルを除外する(issue #56)", () => {
    const repo = makeRepo({
      overlayFiles: JSON.stringify([
        { path: "a.yml", content: "A" },
        { path: "b.yml", content: "B" },
      ]),
    });
    const profile = makeProfile({
      overlayFiles: JSON.stringify([{ path: "a.yml", delete: true }]),
    });
    expect(resolveSettings(repo, profile).overlayFiles).toEqual([{ path: "b.yml", content: "B" }]);
  });
});

describe("mergeOverlayFiles", () => {
  const defaults = [
    { path: "a.yml", content: "A" },
    { path: "b.yml", content: "B" },
  ];

  it("新しいpathのエントリを末尾に追加する", () => {
    expect(mergeOverlayFiles(defaults, [{ path: "c.yml", content: "C" }])).toEqual([
      { path: "a.yml", content: "A" },
      { path: "b.yml", content: "B" },
      { path: "c.yml", content: "C" },
    ]);
  });

  it("同じpathのエントリは位置を維持したまま内容を上書きする", () => {
    expect(mergeOverlayFiles(defaults, [{ path: "a.yml", content: "A2" }])).toEqual([
      { path: "a.yml", content: "A2" },
      { path: "b.yml", content: "B" },
    ]);
  });

  it("deleteエントリは既定のファイルを取り除く", () => {
    expect(mergeOverlayFiles(defaults, [{ path: "b.yml", delete: true }])).toEqual([
      { path: "a.yml", content: "A" },
    ]);
  });

  it("既定に無いpathのdeleteエントリは何もしない", () => {
    expect(mergeOverlayFiles(defaults, [{ path: "x.yml", delete: true }])).toEqual(defaults);
  });

  it("contentが無い追加エントリは空文字として扱う", () => {
    expect(mergeOverlayFiles([], [{ path: "empty.txt" }])).toEqual([
      { path: "empty.txt", content: "" },
    ]);
  });

  it("エントリは順に適用される(削除後の追加は復活する)", () => {
    expect(
      mergeOverlayFiles(defaults, [
        { path: "a.yml", delete: true },
        { path: "a.yml", content: "A3" },
      ]),
    ).toEqual([
      { path: "b.yml", content: "B" },
      { path: "a.yml", content: "A3" },
    ]);
  });
});
