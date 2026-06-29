import { prisma } from "../db/client";
import { env } from "../env";
import { hashPassword } from "../auth/password";

/**
 * Seed the initial admin user from environment variables when the database
 * contains no users yet. Skipped entirely once any user exists.
 */
export async function seedAdminUser(): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0) {
    return;
  }

  const adminUser = env.ADMIN_USER?.trim();
  const adminPassword = env.ADMIN_PASSWORD?.trim();

  if (!adminUser || !adminPassword) {
    return;
  }

  const passwordHash = await hashPassword(adminPassword);
  await prisma.user.create({
    data: {
      username: adminUser,
      passwordHash,
    },
  });

  console.log(`[seed] Created initial admin user: ${adminUser}`);
}
