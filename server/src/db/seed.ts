import { prisma } from "../db/client";
import { env } from "../env";
import { hashPassword } from "../auth/password";
import { refreshAuthCache } from "../auth/middleware";

/**
 * Sync the admin user from environment variables with the database.
 *
 * - When both ADMIN_USER and ADMIN_PASSWORD are set:
 *   Upsert the user (create or update password) so that the env config is
 *   always authoritative.
 * - When both are empty/unset:
 *   Remove ALL users from DB so that basic-auth becomes disabled.
 *
 * This ensures that toggling .env values is reflected on restart.
 */
export async function syncAdminUser(): Promise<void> {
  const adminUser = env.ADMIN_USER?.trim();
  const adminPassword = env.ADMIN_PASSWORD?.trim();

  if (!adminUser || !adminPassword) {
    // Env credentials are cleared → remove all users to disable auth
    const count = await prisma.user.count();
    if (count > 0) {
      await prisma.user.deleteMany();
      console.log(`[auth] Cleared ${count} user(s) because ADMIN_USER / ADMIN_PASSWORD are empty`);
    }
    await refreshAuthCache();
    return;
  }

  // Upsert the env-specified admin user so the env is authoritative
  const passwordHash = await hashPassword(adminPassword);
  const existing = await prisma.user.findUnique({ where: { username: adminUser } });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash },
    });
    console.log(`[auth] Updated password for env admin user: ${adminUser}`);
  } else {
    await prisma.user.create({
      data: { username: adminUser, passwordHash },
    });
    console.log(`[auth] Created env admin user: ${adminUser}`);
  }

  await refreshAuthCache();
}
