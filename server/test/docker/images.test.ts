import { describe, expect, it } from "vitest";

import {
  imageRemovalRefs,
  parseImageInspectLines,
  selectOrphanImages,
  type DockerImageInfo,
} from "../../src/docker/images";

function img(id: string, project: string | null, repoTags: string[] = []): DockerImageInfo {
  return { id, project, repoTags };
}

describe("parseImageInspectLines", () => {
  it("parses id, compose project label and tags", () => {
    const lines = [
      "sha256:aaa\tpreview-acme-app-pr1\tfoo:latest foo:v2",
      // ラベル自体が無いイメージ(素のpull)は空文字になる。
      "sha256:bbb\t\tbusybox:latest",
      // Labelsはあるが対象キーが無いと "<no value>" になる。
      "sha256:ccc\t<no value>\tghcr.io/x/y:main",
      // dangling(タグ無し)。
      "sha256:ddd\tai\t",
    ];
    expect(parseImageInspectLines(lines)).toEqual([
      { id: "sha256:aaa", project: "preview-acme-app-pr1", repoTags: ["foo:latest", "foo:v2"] },
      { id: "sha256:bbb", project: null, repoTags: ["busybox:latest"] },
      { id: "sha256:ccc", project: null, repoTags: ["ghcr.io/x/y:main"] },
      { id: "sha256:ddd", project: "ai", repoTags: [] },
    ]);
  });

  it("skips error lines and malformed lines", () => {
    const lines = [
      "Error response from daemon: No such image: deadbeef",
      "not\ta-sha-line",
      "sha256:aaa\tpreview-a-b-pr1\t",
    ];
    const images = parseImageInspectLines(lines);
    expect(images).toHaveLength(1);
    expect(images[0].id).toBe("sha256:aaa");
  });
});

describe("selectOrphanImages", () => {
  const images = [
    img("sha256:a", "preview-acme-app-pr1", ["preview-acme-app-pr1-web:latest"]),
    img("sha256:b", "preview-acme-app-pr2", ["preview-acme-app-pr2-web:latest"]),
    img("sha256:c", "preview-acme-app-pr3"),
    img("sha256:d", "mk", ["mk-app:latest"]),
    img("sha256:e", null, ["postgres:17"]),
  ];

  it("selects only preview projects without an active preview", () => {
    const orphans = selectOrphanImages(images, ["preview-acme-app-pr1"]);
    expect(orphans.map((i) => i.id)).toEqual(["sha256:b", "sha256:c"]);
  });

  it("never selects other compose projects or unlabeled images", () => {
    const orphans = selectOrphanImages(images, []);
    expect(orphans.map((i) => i.id)).toEqual(["sha256:a", "sha256:b", "sha256:c"]);
  });
});

describe("imageRemovalRefs", () => {
  it("prefers tags and falls back to the id for dangling images", () => {
    expect(imageRemovalRefs(img("sha256:a", "p", ["x:1", "x:2"]))).toEqual(["x:1", "x:2"]);
    expect(imageRemovalRefs(img("sha256:a", "p"))).toEqual(["sha256:a"]);
  });
});
