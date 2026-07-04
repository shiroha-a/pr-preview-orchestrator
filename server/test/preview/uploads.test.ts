import { readFile, stat } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  ageUploadSessionForTest,
  appendUploadChunk,
  createUploadSession,
  discardUploadSession,
  finishUploadSession,
  getUploadSession,
} from "../../src/preview/uploads";

function input(overrides: Partial<Parameters<typeof createUploadSession>[0]> = {}) {
  return {
    previewId: "preview1",
    volume: "project_data",
    totalChunks: 2,
    totalSize: 10,
    ...overrides,
  };
}

describe("createUploadSession", () => {
  it("creates a session retrievable by id", async () => {
    const session = await createUploadSession(input());
    expect(getUploadSession(session.id)).toBe(session);
    expect(session.received).toBe(0);
    expect(session.bytes).toBe(0);
    await discardUploadSession(session.id);
  });
});

describe("appendUploadChunk", () => {
  it("appends chunks in order and tracks progress", async () => {
    const session = await createUploadSession(input());
    await appendUploadChunk(session.id, 0, Buffer.from("hello"));
    await appendUploadChunk(session.id, 1, Buffer.from("world"));
    expect(session.received).toBe(2);
    expect(session.bytes).toBe(10);
    expect((await readFile(session.path)).toString()).toBe("helloworld");
    await discardUploadSession(session.id);
  });

  it("rejects out-of-order chunks", async () => {
    const session = await createUploadSession(input());
    await expect(appendUploadChunk(session.id, 1, Buffer.from("x"))).rejects.toThrow(/順序が不正/);
    await discardUploadSession(session.id);
  });

  it("rejects empty chunks and unknown sessions", async () => {
    const session = await createUploadSession(input());
    await expect(appendUploadChunk(session.id, 0, Buffer.alloc(0))).rejects.toThrow(/空のチャンク/);
    await expect(appendUploadChunk("nope", 0, Buffer.from("x"))).rejects.toThrow(
      /アップロードセッションがありません/,
    );
    await discardUploadSession(session.id);
  });

  it("rejects more chunks than declared", async () => {
    const session = await createUploadSession(input({ totalChunks: 1, totalSize: 1 }));
    await appendUploadChunk(session.id, 0, Buffer.from("x"));
    await expect(appendUploadChunk(session.id, 1, Buffer.from("y"))).rejects.toThrow(
      /チャンク数を超えて|順序が不正/,
    );
    await discardUploadSession(session.id);
  });
});

describe("finishUploadSession", () => {
  it("returns the session and removes it from the store", async () => {
    const session = await createUploadSession(input({ totalChunks: 1, totalSize: 5 }));
    await appendUploadChunk(session.id, 0, Buffer.from("hello"));
    const finished = finishUploadSession(session.id);
    expect(finished.path).toBe(session.path);
    expect(getUploadSession(session.id)).toBeNull();
    await discardUploadSession(session.id);
  });

  it("rejects when chunks are missing", async () => {
    const session = await createUploadSession(input());
    await appendUploadChunk(session.id, 0, Buffer.from("hello"));
    expect(() => finishUploadSession(session.id)).toThrow(/未受信のチャンク/);
    await discardUploadSession(session.id);
  });

  it("rejects when the total size does not match", async () => {
    const session = await createUploadSession(input({ totalChunks: 1, totalSize: 99 }));
    await appendUploadChunk(session.id, 0, Buffer.from("hello"));
    expect(() => finishUploadSession(session.id)).toThrow(/サイズが一致しません/);
    await discardUploadSession(session.id);
  });
});

describe("discardUploadSession", () => {
  it("removes the session and its staging file", async () => {
    const session = await createUploadSession(input());
    await appendUploadChunk(session.id, 0, Buffer.from("hello"));
    await discardUploadSession(session.id);
    expect(getUploadSession(session.id)).toBeNull();
    await expect(stat(session.path)).rejects.toThrow();
  });
});

describe("TTL sweep", () => {
  it("expires stale sessions when a new session is created", async () => {
    const stale = await createUploadSession(input());
    ageUploadSessionForTest(stale.id, 2 * 60 * 60 * 1000);
    const fresh = await createUploadSession(input());
    expect(getUploadSession(stale.id)).toBeNull();
    expect(getUploadSession(fresh.id)).not.toBeNull();
    await discardUploadSession(fresh.id);
  });
});
