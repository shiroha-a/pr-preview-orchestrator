import { describe, expect, it } from "vitest";

import { parseDockerSize, parseSystemDf } from "../../src/docker/df";

describe("parseDockerSize", () => {
  it("decimal units used by docker system df", () => {
    expect(parseDockerSize("0B")).toBe(0);
    expect(parseDockerSize("930.5kB")).toBe(930500);
    expect(parseDockerSize("3.896MB")).toBe(3896000);
    expect(parseDockerSize("176GB")).toBe(176_000_000_000);
    expect(parseDockerSize("78.14GB")).toBe(78_140_000_000);
  });

  it("binary units are supported as well", () => {
    expect(parseDockerSize("1KiB")).toBe(1024);
    expect(parseDockerSize("1.5MiB")).toBe(Math.round(1.5 * 1024 ** 2));
  });

  it("reads the leading size of a reclaimable value with a percentage", () => {
    expect(parseDockerSize("78.14GB (40%)")).toBe(78_140_000_000);
  });

  it("returns 0 for malformed input", () => {
    expect(parseDockerSize("")).toBe(0);
    expect(parseDockerSize("N/A")).toBe(0);
  });
});

describe("parseSystemDf", () => {
  // docker system df --format "{{json .}}" の実出力サンプル。
  const sample = [
    '{"Active":"19","Reclaimable":"78.14GB (40%)","Size":"193.5GB","TotalCount":"902","Type":"Images"}',
    '{"Active":"9","Reclaimable":"930.5kB (23%)","Size":"3.896MB","TotalCount":"26","Type":"Containers"}',
    '{"Active":"18","Reclaimable":"11.04GB (94%)","Size":"11.65GB","TotalCount":"56","Type":"Local Volumes"}',
    '{"Active":"0","Reclaimable":"10.75GB","Size":"176GB","TotalCount":"4611","Type":"Build Cache"}',
  ];

  it("parses the four rows with stable type keys", () => {
    const rows = parseSystemDf(sample);
    expect(rows).toEqual([
      {
        type: "images",
        totalCount: 902,
        active: 19,
        sizeBytes: 193_500_000_000,
        reclaimableBytes: 78_140_000_000,
      },
      {
        type: "containers",
        totalCount: 26,
        active: 9,
        sizeBytes: 3_896_000,
        reclaimableBytes: 930_500,
      },
      {
        type: "volumes",
        totalCount: 56,
        active: 18,
        sizeBytes: 11_650_000_000,
        reclaimableBytes: 11_040_000_000,
      },
      {
        type: "buildCache",
        totalCount: 4611,
        active: 0,
        sizeBytes: 176_000_000_000,
        reclaimableBytes: 10_750_000_000,
      },
    ]);
  });

  it("skips blank, non-JSON and unknown-type lines", () => {
    const rows = parseSystemDf([
      "",
      "WARNING: something",
      '{"Type":"Unknown","TotalCount":"1","Active":"0","Size":"1GB","Reclaimable":"1GB"}',
      sample[0],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("images");
  });
});
