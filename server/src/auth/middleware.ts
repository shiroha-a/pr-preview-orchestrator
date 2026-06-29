import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

import { prisma } from "../db/client";
import { verifyPassword } from "./password";

/**
 * Custom Basic Auth middleware that validates credentials against the User
 * table in the database (bcrypt hashed passwords).
 *
 * Only applied when at least one user exists in the database.
 */
export function dbBasicAuth() {
  return async (c: Context, next: Next) => {
    const userCount = await prisma.user.count();
    if (userCount === 0) {
      // No users in DB yet → auth disabled (seed will create the first one)
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
    if (!user) {
      c.header("WWW-Authenticate", 'Basic realm="Admin"');
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      c.header("WWW-Authenticate", 'Basic realm="Admin"');
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    // Store the authenticated username for downstream handlers
    c.set("authUsername", user.username);
    await next();
  };
}
