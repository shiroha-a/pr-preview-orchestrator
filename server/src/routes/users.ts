import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { prisma } from "../db/client";
import { hashPassword } from "../auth/password";
import { getCachedUserCount, refreshAuthCache } from "../auth/middleware";

export const usersRoutes = new Hono();

/** List all users (passwordHash excluded). */
usersRoutes.get("/", async (c) => {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "asc" },
  });
  return c.json({ users });
});

/** Create a new user.
 *
 * Rejected when no admin user exists yet (auth disabled), to prevent
 * unauthenticated account creation. */
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

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    throw new HTTPException(409, { message: "username already exists" });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { username, passwordHash },
    select: { id: true, username: true, createdAt: true, updatedAt: true },
  });

  await refreshAuthCache();
  return c.json({ user }, 201);
});

/** Delete a user. Prevents self-deletion and deleting the last user. */
usersRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const authUsername = c.get("authUsername") as string | undefined;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    throw new HTTPException(404, { message: "user not found" });
  }

  if (authUsername && target.username === authUsername) {
    throw new HTTPException(403, { message: "cannot delete yourself" });
  }

  const count = await prisma.user.count();
  if (count <= 1) {
    throw new HTTPException(400, { message: "cannot delete the last user" });
  }

  await prisma.user.delete({ where: { id } });
  await refreshAuthCache();
  return c.json({ ok: true });
});
