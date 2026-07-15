import { describe, expect, it } from "vitest";

import { parseBuiltImages } from "../../src/agent/main";

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
