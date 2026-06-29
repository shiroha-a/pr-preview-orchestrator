import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Prisma } from "../generated/prisma/client";

import { prisma } from "../db/client";
import type { PrismaClient } from "../generated/prisma/client";
import { hashPassword } from "../auth/password";
import { getCachedUserCount, refreshAuthCache } from "../auth/middleware";

export function createUsersRoutes(p: PrismaClient = prisma) {
  const usersRoutes = new Hono();

  /** List all users (passwordHash excluded). */
  usersRoutes.get("/", async (c) => {
    const users = await p.user.findMany({
      select: { id: true, username: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
    });
    return c.json({ users });
  });

  /**
   * 新規ユーザーを作成する。
   *
   * ユーザー数が 0 件のとき（認証無効状態）は作成を拒否する。
   * これにより .env で認証が無効な状態を意図した場合、第三者が
   * 匿名で管理アカウントを作れないようにする。
   */
  usersRoutes.post("/", async (c) => {
    if (getCachedUserCount() === 0) {
      throw new HTTPException(403, {
        message: "cannot create user while authentication is disabled",
      });
    }

    const body = await c.req.json<{ username?: string; password?: string }>();
    const username = body.username?.trim();
    const password = body.password;

    if (!username || !password) {
      throw new HTTPException(400, { message: "username and password are required" });
    }

    try {
      const passwordHash = await hashPassword(password);
      const user = await p.user.create({
        data: { username, passwordHash },
        select: { id: true, username: true, createdAt: true, updatedAt: true },
      });

      await refreshAuthCache();
      return c.json({ user }, 201);
    } catch (e) {
      // UNIQUE 制約違反（並行作成）→ 409
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new HTTPException(409, { message: "username already exists" });
      }
      throw e;
    }
  });

  /**
   * ユーザーを削除する。
   *
   * - 自分自身は削除不可（403）
   * - 最後の1人は削除不可（400）
   *
   * count の確認と delete をトランザクションで包み、
   * 並行削除による TOCTOU（最後の1人突破）を防ぐ。
   */
  usersRoutes.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const authUsername = c.get("authUsername");

    try {
      await p.$transaction(async (tx) => {
        const target = await tx.user.findUnique({ where: { id } });
        if (!target) {
          throw new HTTPException(404, { message: "user not found" });
        }

        if (authUsername && target.username === authUsername) {
          throw new HTTPException(403, { message: "cannot delete yourself" });
        }

        const count = await tx.user.count();
        if (count <= 1) {
          throw new HTTPException(400, { message: "cannot delete the last user" });
        }

        await tx.user.delete({ where: { id } });
      });

      await refreshAuthCache();
      return c.json({ ok: true });
    } catch (err) {
      // tx 内で投げた HTTPException はそのまま再送する
      if (err instanceof HTTPException) throw err;
      throw err;
    }
  });

  return usersRoutes;
}
