import { describe, expect, it } from "vitest";

import { parseBuiltImages, unexpectedLoadedImages } from "../../src/preview/images";

describe("parseBuiltImages", () => {
  it("returns default compose tags for built services without an image name", () => {
    const config = JSON.stringify({
      services: {
        web: { build: { context: "." } },
        db: { image: "postgres:16" },
      },
    });
    expect(parseBuiltImages(config, "preview-acme-app-pr1")).toEqual(["preview-acme-app-pr1-web"]);
  });

  it("prefers the explicit image name of a built service", () => {
    const config = JSON.stringify({
      services: {
        web: { build: { context: "." }, image: "custom/web:latest" },
      },
    });
    expect(parseBuiltImages(config, "p")).toEqual(["custom/web:latest"]);
  });

  it("excludes pull-only services entirely", () => {
    const config = JSON.stringify({
      services: {
        db: { image: "postgres:16" },
        cache: { image: "redis:7" },
      },
    });
    expect(parseBuiltImages(config, "p")).toEqual([]);
  });

  it("handles empty or missing services", () => {
    expect(parseBuiltImages(JSON.stringify({}), "p")).toEqual([]);
    expect(parseBuiltImages(JSON.stringify({ services: {} }), "p")).toEqual([]);
  });
});

describe("unexpectedLoadedImages", () => {
  it("accepts only the expected tags", () => {
    const output = "Loaded image: preview-acme-app-pr1-web\nLoaded image: custom/web:latest";
    expect(
      unexpectedLoadedImages(output, ["preview-acme-app-pr1-web", "custom/web:latest"]),
    ).toEqual([]);
  });

  it("flags tags outside the expected list", () => {
    // 侵害されたエージェントが任意タグ(例: postgres:16)を差し替える攻撃の検出(issue #80レビュー2)。
    const output = "Loaded image: preview-acme-app-pr1-web\nLoaded image: postgres:16";
    expect(unexpectedLoadedImages(output, ["preview-acme-app-pr1-web"])).toEqual(["postgres:16"]);
  });

  it("flags untagged image loads", () => {
    const output = "Loaded image ID: sha256:deadbeef";
    expect(unexpectedLoadedImages(output, ["preview-acme-app-pr1-web"])).toEqual([
      "Loaded image ID: sha256:deadbeef",
    ]);
  });

  it("ignores unrelated output lines", () => {
    expect(unexpectedLoadedImages("some progress line\n\n", ["a"])).toEqual([]);
  });
});
