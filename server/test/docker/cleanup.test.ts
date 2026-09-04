import { describe, expect, it } from "vitest";

import { computeFreedBytes, formatImagePruneSummary } from "../../src/docker/cleanup";

describe("formatImagePruneSummary", () => {
  // Reporting only the trailing `docker image prune` output made a run that
  // deleted many preview images look like it reclaimed 0B (issue #92).
  it("reports the freed size next to the removed count", () => {
    expect(formatImagePruneSummary({ removed: 29, skipped: 0, freedBytes: 12_300_000_000 })).toBe(
      "プレビューイメージ29件を削除 / 解放: 12.3GB",
    );
  });

  it("mentions skipped images only when there are any", () => {
    expect(formatImagePruneSummary({ removed: 5, skipped: 3, freedBytes: 0 })).toBe(
      "プレビューイメージ5件を削除 / 3件は使用中のためスキップ / 解放: 0B",
    );
    expect(formatImagePruneSummary({ removed: 5, skipped: 0, freedBytes: 0 })).toBe(
      "プレビューイメージ5件を削除 / 解放: 0B",
    );
  });

  // A failed `docker system df` must not hide the fact that images were removed.
  it("omits the freed size when the measurement was unavailable", () => {
    expect(formatImagePruneSummary({ removed: 2, skipped: 1, freedBytes: null })).toBe(
      "プレビューイメージ2件を削除 / 1件は使用中のためスキップ",
    );
  });
});

describe("computeFreedBytes", () => {
  it("diffs the two readings", () => {
    expect(computeFreedBytes(20_000_000_000, 8_000_000_000)).toBe(12_000_000_000);
  });

  // A build running alongside the cleanup grows the image store; reporting a
  // negative amount freed would be nonsense.
  it("clamps at 0 when the image store grew during the run", () => {
    expect(computeFreedBytes(8_000_000_000, 9_000_000_000)).toBe(0);
  });

  it("returns null when either reading is unavailable", () => {
    expect(computeFreedBytes(null, 8_000_000_000)).toBeNull();
    expect(computeFreedBytes(20_000_000_000, null)).toBeNull();
    expect(computeFreedBytes(null, null)).toBeNull();
  });
});
