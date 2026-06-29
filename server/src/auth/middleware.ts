import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

import { prisma } from "../db/client";
import { verifyPassword } from "./password";

/** Cached user count to avoid a COUNT query on every request. */
export let cachedUserCount: number | null = null;

/** Initialise the cached user count at boot time. */
export async function initAuthCache(): Promise<void> {
  cachedUserCount = await prisma.user.count();
}

/** Refresh the cached count after mutating operations (create / delete). */
export async function refreshAuthCache(): Promise<void> {
  cachedUserCount = await prisma.user.count();
}

/** Expose the cached count for other modules (e.g. tests, config endpoint). */
export function getCachedUserCount(): number {
  return cachedUserCount ?? 0;
}

/** A dummy bcrypt hash used for constant-time comparison when user does not exist. */
const DUMMY_HASH =
  "$2b$12$abcdefghijklmnopqrstuvwxycV/PgbONQlK6HsN6qPoQfXzAzMn3Gq";

/**
 * Custom Basic Auth middleware that validates credentials against the User
 * table in the database (bcrypt hashed passwords).
 *
 * Only applied when at least one user exists in the database.
 */
export function dbBasicAuth() {
  return async (c: Context, next: Next) => {
    if ((cachedUserCount ?? 0) === 0) {
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

    const user = await prisma.user.findUnique({ where: { username } });

    // Always run bcrypt.compare, even when the user does not exist, to
    // prevent timing attacks that enumerate valid usernames.
    const hashToCompare = user ? user.passwordHash : DUMMY_HASH;
    const valid = await verifyPassword(password, hashToCompare);

    if (!user || !valid) {
      c.header("WWW-Authenticate", 'Basic realm="Admin"');
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    // Store the authenticated username for downstream handlers
    c.set("authUsername", user.username);
    await next();
  };
}
