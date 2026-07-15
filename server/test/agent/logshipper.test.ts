import { afterEach, describe, expect, it, vi } from "vitest";

import { LogShipper } from "../../src/agent/main";

const cfg = { baseUrl: "http://orchestrator.test", token: "pra_test" };

interface SentBatch {
  lines: string[];
}

/** Stub fetch capturing each batch; optionally gate responses on a trigger. */
function stubFetch(opts: { status?: number; gated?: boolean } = {}) {
  const batches: SentBatch[] = [];
  const releases: Array<() => void> = [];
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    batches.push(JSON.parse(String(init?.body)) as SentBatch);
    if (opts.gated) {
      await new Promise<void>((resolve) => releases.push(resolve));
    }
    return new Response(JSON.stringify({ ok: true }), { status: opts.status ?? 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { batches, releases, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LogShipper", () => {
  it("flush()は進行中の送信も含めて完了を待つ(順序保証)", async () => {
    // complete報告が最終ログを追い越さないためのチェーン直列化(issue #80レビュー指摘4)。
    const { batches, releases } = stubFetch({ gated: true });
    const shipper = new LogShipper(cfg, "job1", () => {});

    shipper.push("first");
    const flush1 = shipper.flush(); // 送信開始(gateで保留)
    // 1本目がfetchに到達した(バッファをsplice済みの)状態を待ってから2本目を積む。
    await vi.waitFor(() => expect(batches).toHaveLength(1));
    shipper.push("second");
    const flush2 = shipper.flush();

    let flush2Done = false;
    void flush2.then(() => {
      flush2Done = true;
    });
    await Promise.resolve();
    // 1本目の送信が完了するまでflush2は解決せず、2本目の送信も始まらない。
    expect(flush2Done).toBe(false);
    expect(batches).toHaveLength(1);

    releases[0]();
    await flush1;
    // 2本目の送信(チェーン後続)がgateに到達するのを待ってから解放する。
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]();
    await flush2;

    expect(batches.map((b) => b.lines)).toEqual([["first"], ["second"]]);
  });

  it("410を受けたらgoneになりonGoneを発火、以降は送信しない", async () => {
    const { batches } = stubFetch({ status: 410 });
    const onGone = vi.fn();
    const shipper = new LogShipper(cfg, "job1", onGone);

    shipper.push("line");
    await shipper.flush();
    expect(shipper.gone).toBe(true);
    expect(onGone).toHaveBeenCalledTimes(1);

    shipper.push("after gone");
    await shipper.flush();
    expect(batches).toHaveLength(1);
  });

  it("送信失敗はビルドを止めない(ログ欠落として許容)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const shipper = new LogShipper(cfg, "job1", () => {});
    shipper.push("line");
    await expect(shipper.flush()).resolves.toBeUndefined();
    expect(shipper.gone).toBe(false);
  });
});
