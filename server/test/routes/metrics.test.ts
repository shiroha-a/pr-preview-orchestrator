import { describe, expect, it, vi } from "vitest";

import { resolveDiskUsage } from "../../src/routes/metrics";

const USAGE = { total: 100, used: 40, free: 60 };

describe("resolveDiskUsage", () => {
  it("reports the configured path when it can be measured", async () => {
    const measure = vi.fn(async () => USAGE);

    expect(await resolveDiskUsage("/var/lib/docker", measure)).toEqual({
      ...USAGE,
      path: "/var/lib/docker",
    });
    expect(measure).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenCalledWith("/var/lib/docker");
  });

  // The configured path is unavailable under rootless docker or when the bind
  // mount is missing (issue #90); the label must then say "/" and not the
  // configured path (issue #97).
  it("falls back to / and reports it as the measured path", async () => {
    const measure = vi.fn(async (p: string) => (p === "/" ? USAGE : null));

    expect(await resolveDiskUsage("/var/lib/docker", measure)).toEqual({ ...USAGE, path: "/" });
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it("reports no path when nothing can be measured", async () => {
    const measure = vi.fn(async () => null);

    expect(await resolveDiskUsage("/var/lib/docker", measure)).toEqual({
      total: 0,
      used: 0,
      free: 0,
      path: null,
    });
  });

  it("does not measure / twice when it is already the configured path", async () => {
    const measure = vi.fn(async () => null);

    expect(await resolveDiskUsage("/", measure)).toEqual({
      total: 0,
      used: 0,
      free: 0,
      path: null,
    });
    expect(measure).toHaveBeenCalledTimes(1);
  });
});
