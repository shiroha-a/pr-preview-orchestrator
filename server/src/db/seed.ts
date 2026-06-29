import { prisma } from "../db/client";
import { env } from "../env";
import { hashPassword } from "../auth/password";
import { refreshAuthCache } from "../auth/middleware";

/**
 * .env の ADMIN_USER / ADMIN_PASSWORD と DB を同期する。
 *
 * - 両方設定済みの場合:
 *   指定ユーザーを upsert（create または password 更新）し、
 *   .env を常に正として扱う。
 * - 両方空の場合:
 *   DB のすべてのユーザーを削除し Basic 認証を無効化する。
 *
 * これにより .env の値を変更・再起動するだけで認証の on/off を
 * 切り替えられる。
 */
export async function syncAdminUser(): Promise<void> {
  const adminUser = env.ADMIN_USER?.trim();
  const adminPassword = env.ADMIN_PASSWORD;

  if (!adminUser || !adminPassword) {
    // .env の認証情報がクリアされた → DB から全ユーザーを削除して無効化
    const count = await prisma.user.count();
    if (count > 0) {
      await prisma.user.deleteMany();
      console.log(`[auth] Cleared ${count} user(s) because ADMIN_USER / ADMIN_PASSWORD are empty`);
    }
    await refreshAuthCache();
    return;
  }

  // .env 指定の admin ユーザーを upsert（env が常に正）
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
