import { randomUUID } from "node:crypto";
import { appendFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Chunked upload sessions for volume archive imports (issue #61).
 *
 * The orchestrator is served through Cloudflare, whose request body size limit
 * makes single-request uploads of large archives impossible. Clients split the
 * file into chunks and send them sequentially; each chunk is appended to a
 * staging file in the OS temp directory. Sessions live in process memory only:
 * a server restart simply invalidates in-flight uploads, which the client
 * surfaces as "start over".
 */
export interface UploadSession {
  id: string;
  /** Preview environment the target volume belongs to. */
  previewId: string;
  /** Full docker volume name the archive will be imported into. */
  volume: string;
  totalChunks: number;
  /** Expected total size in bytes, declared by the client up front. */
  totalSize: number;
  /** Number of chunks received so far (chunks must arrive in order). */
  received: number;
  /** Bytes received so far. */
  bytes: number;
  /** Staging file the chunks are appended to. */
  path: string;
  createdAt: number;
}

const sessions = new Map<string, UploadSession>();

// 中断されたアップロードの一時ファイルを溜め込まないための遅延掃除のTTL。
const SESSION_TTL_MS = 60 * 60 * 1000;

function stagingDir(): string {
  return join(tmpdir(), "pr-preview-volume-uploads");
}

/** Drop sessions past their TTL and delete their staging files. */
function sweepExpired(now = Date.now()): void {
  for (const session of sessions.values()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(session.id);
      void rm(session.path, { force: true });
    }
  }
}

/** Create a chunked upload session and its (empty) staging file location. */
export async function createUploadSession(input: {
  previewId: string;
  volume: string;
  totalChunks: number;
  totalSize: number;
}): Promise<UploadSession> {
  sweepExpired();
  const id = randomUUID();
  await mkdir(stagingDir(), { recursive: true });
  const session: UploadSession = {
    id,
    previewId: input.previewId,
    volume: input.volume,
    totalChunks: input.totalChunks,
    totalSize: input.totalSize,
    received: 0,
    bytes: 0,
    path: join(stagingDir(), `${id}.tar.gz`),
    createdAt: Date.now(),
  };
  sessions.set(id, session);
  return session;
}

/** Look up a session by id (null when unknown or already finished/expired). */
export function getUploadSession(id: string): UploadSession | null {
  return sessions.get(id) ?? null;
}

const SESSION_GONE_ERROR =
  "アップロードセッションがありません(期限切れ・サーバー再起動の可能性)。最初からやり直してください。";

/** Append one chunk. Chunks must be sent in order starting from index 0. */
export async function appendUploadChunk(
  id: string,
  index: number,
  data: Buffer,
): Promise<UploadSession> {
  const session = sessions.get(id);
  if (!session) throw new Error(SESSION_GONE_ERROR);
  if (index !== session.received) {
    throw new Error(`チャンクの順序が不正です(expected ${session.received}, got ${index})`);
  }
  if (session.received >= session.totalChunks) {
    throw new Error("宣言されたチャンク数を超えています");
  }
  if (data.length === 0) throw new Error("空のチャンクは受け付けません");
  await appendFile(session.path, data);
  session.received += 1;
  session.bytes += data.length;
  return session;
}

/**
 * Validate a completed upload and hand it over to the caller. The session is
 * removed from the store; the staging file becomes the caller's responsibility
 * (the import job deletes it when done).
 */
export function finishUploadSession(id: string): UploadSession {
  const session = sessions.get(id);
  if (!session) throw new Error(SESSION_GONE_ERROR);
  if (session.received !== session.totalChunks) {
    throw new Error(`未受信のチャンクがあります(${session.received}/${session.totalChunks})`);
  }
  if (session.bytes !== session.totalSize) {
    throw new Error(
      `サイズが一致しません(received ${session.bytes}, expected ${session.totalSize})`,
    );
  }
  sessions.delete(id);
  return session;
}

/** Abort a session and delete its staging file (no-op when unknown). */
export async function discardUploadSession(id: string): Promise<void> {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  await rm(session.path, { force: true });
}

/** Test hook: force-expire a session so the TTL sweep can be exercised. */
export function ageUploadSessionForTest(id: string, ageMs: number): void {
  const session = sessions.get(id);
  if (session) session.createdAt -= ageMs;
}
