import { describe, expect, it } from "vitest";

import { parsePublishedPorts } from "../../src/docker/ports";

describe("parsePublishedPorts", () => {
  it("reads IPv4 and IPv6 published ports from a single container line", () => {
    const ports = parsePublishedPorts(["0.0.0.0:8800->8800/tcp, [::]:8800->8800/tcp"]);
    expect([...ports]).toEqual([8800]);
  });

  it("reads loopback-bound publications", () => {
    expect([...parsePublishedPorts(["127.0.0.1:16379->6379/tcp"])]).toEqual([16379]);
  });

  it("expands published port ranges", () => {
    const ports = parsePublishedPorts(["0.0.0.0:13000-13003->3000-3003/tcp"]);
    expect([...ports]).toEqual([13000, 13001, 13002, 13003]);
  });

  it("ignores exposed-but-not-published ports and empty lines", () => {
    expect(parsePublishedPorts(["5432/tcp", "", "   "]).size).toBe(0);
  });

  it("collects ports across multiple containers", () => {
    const ports = parsePublishedPorts([
      "0.0.0.0:13000->3000/tcp, [::]:13000->3000/tcp",
      "6379/tcp",
      "127.0.0.1:55432->5432/tcp",
    ]);
    expect(ports.has(13000)).toBe(true);
    expect(ports.has(55432)).toBe(true);
    expect(ports.has(6379)).toBe(false);
  });

  it("also matches the older ':::port' IPv6 rendering", () => {
    expect([...parsePublishedPorts([":::8080->80/tcp"])]).toEqual([8080]);
  });

  it("skips malformed ranges instead of looping over them", () => {
    // 逆順・範囲外は無視する(壊れた出力での暴走を防ぐ)。
    expect(parsePublishedPorts(["0.0.0.0:13005-13000->3000/tcp"]).size).toBe(0);
    expect(parsePublishedPorts(["0.0.0.0:0-99999->3000/tcp"]).size).toBe(0);
  });

  it("handles UDP publications", () => {
    expect([...parsePublishedPorts(["0.0.0.0:5353->53/udp"])]).toEqual([5353]);
  });
});
