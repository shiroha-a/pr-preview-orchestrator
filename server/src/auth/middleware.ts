import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

import { prisma } from "../db/client";
import type { PrismaClient } from "../generated/prisma/client";
import { verifyPassword } from "./password";

/** リクエスト毎のCOUNTを避けるため、起動時や更新時にキャッシュする。 */
let cachedUserCount: number | null = null;

/** 起動時に一度だけ count をキャッシュする。 */
export async function initAuthCache(): Promise<void> {
  cachedUserCount = await prisma.user.count();
}

/** 作成・削除後にキャッシュを更新する。 */
export async function refreshAuthCache(p: PrismaClient = prisma): Promise<void> {
  cachedUserCount = await p.user.count();
}

/** 他モジュールから参照用。 */
export function getCachedUserCount(): number {
  return cachedUserCount ?? 0;
}

/** テスト等からキャッシュ値を直接書き換えるための setter。 */
export function setCachedUserCount(value: number | null): void {
  cachedUserCount = value;
}

/**
 * ユーザー不在時も bcrypt.compare を走らせるためのダミーハッシュ。
 * ユーザー名列挙のタイミング攻撃を防ぐ。
 */
const DUMMY_HASH = "$2b$12$abcdefghijklmnopqrstuvwxycV/PgbONQlK6HsN6qPoQfXzAzMn3Gq";

/**
 * DB に保存された bcrypt ハッシュ照合型 Basic Auth ミドルウェア。
 *
 * cachedUserCount がまだ null（未初期化）の場合は、ここで遅延初期化して
 * fail-open（認証スキップ）を防ぐ。テスト等で initAuthCache() を忘れても
 * 初回リクエスト時に DB 確認されるため安全性が保たれる。
 */
export function dbBasicAuth(p: PrismaClient = prisma) {
  return async (c: Context, next: Next) => {
    // null の場合は遅延初期化。0件でも必ず DB に問い合わせる。
    if (cachedUserCount === null) {
      cachedUserCount = await p.user.count();
    }
    if (cachedUserCount === 0) {
      // ユーザーがいない＝認証無効（アプリの初期セットアップ時のみ）
      await next();
      return;
    }

    const auth = c.req.header("Authorization");
    if (!auth || !auth.startsWith("Basic ")) {
      c.header("WWW-Authenticate", 'Basic realm="Admin"');
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
    const colonIndex = decoded.indexOf(":");
    if (colonIndex === -1) {
      c.header("WWW-Authenticate", 'Basic realm="Admin"');
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    const username = decoded.slice(0, colonIndex);
    const password = decoded.slice(colonIndex + 1);

    const user = await p.user.findUnique({ where: { username } });

    // ユーザー不在時も一定時間の比較を行い、タイミング攻撃を防ぐ
    const hashToCompare = user ? user.passwordHash : DUMMY_HASH;
    const valid = await verifyPassword(password, hashToCompare);

    if (!user || !valid) {
      c.header("WWW-Authenticate", 'Basic realm="Admin"');
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    c.set("authUsername", user.username);
    await next();
  };
}
