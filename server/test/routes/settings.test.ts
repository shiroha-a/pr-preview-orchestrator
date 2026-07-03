import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { Hono } from "hono";

// routes/repositories.ts はグローバルの prisma を使う。テストDBへの向き先は
// vitest.config.ts の env.DATABASE_URL で全テストファイル共通に固定されている
// (isolate:false のためどのファイルが最初にimportしても同じDBを指す)。
import { repositoriesRoutes } from "../../src/routes/repositories";
import { createTestPrisma, prepareSharedTestDb, truncateAll } from "../helpers";

const prisma = createTestPrisma();

beforeAll(() => {
  prepareSharedTestDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

function createApp() {
  return new Hono().route("/api/repositories", repositoriesRoutes);
}

function createRepo() {
  return prisma.repository.create({ data: { owner: "acme", name: "app" } });
}

function baseSettings() {
  return {
    composePath: "docker-compose.yml",
    webService: "web",
    internalPort: 3000,
    fileRewrites: [],
    overlayFiles: [],
    resetVolumes: false,
  };
}

function putSettings(app: Hono, body: unknown) {
  return app.request("/api/repositories/acme/app/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/repositories/:owner/:name/settings (profiles)", () => {
  it("プロファイルを新規作成して返す", async () => {
    await createRepo();
    const app = createApp();

    const res = await putSettings(app, {
      ...baseSettings(),
      profiles: [{ name: "検索あり", composePath: "a.yml\nb.yml" }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      repository: { profiles: Array<{ id: string; name: string; composePath: string | null }> };
    };
    expect(body.repository.profiles).toHaveLength(1);
    expect(body.repository.profiles[0].name).toBe("検索あり");
    expect(body.repository.profiles[0].composePath).toBe("a.yml\nb.yml");
    expect(body.repository.profiles[0].id).toBeTruthy();
  });

  it("名前が空白のみのプロファイルは400で保存されない(issue #54)", async () => {
    const repo = await createRepo();
    await prisma.settingsProfile.create({
      data: { repositoryId: repo.id, name: "既存" },
    });
    const app = createApp();

    const res = await putSettings(app, {
      ...baseSettings(),
      profiles: [{ name: "  " }],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("プロファイル名");

    // バリデーション失敗時は既存プロファイルも消えない。
    const remaining = await prisma.settingsProfile.findMany({
      where: { repositoryId: repo.id },
    });
    expect(remaining.map((p) => p.name)).toEqual(["既存"]);
  });

  it("deleteエントリを含むオーバーレイを保存できる(issue #56)", async () => {
    await createRepo();
    const app = createApp();

    const res = await putSettings(app, {
      ...baseSettings(),
      overlayFiles: [{ path: "default.yml", content: "D" }],
      profiles: [
        {
          name: "追加削除",
          overlayFiles: [
            { path: "add.yml", content: "X" },
            { path: "default.yml", delete: true },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      repository: { profiles: Array<{ overlayFiles: string | null }> };
    };
    expect(JSON.parse(body.repository.profiles[0].overlayFiles ?? "[]")).toEqual([
      { path: "add.yml", content: "X" },
      { path: "default.yml", delete: true },
    ]);
  });

  it("名前が重複するプロファイルは400", async () => {
    await createRepo();
    const app = createApp();

    const res = await putSettings(app, {
      ...baseSettings(),
      profiles: [{ name: "a" }, { name: " a " }],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("重複");
  });

  it("payloadに含まれない既存プロファイルは削除される(全量同期)", async () => {
    const repo = await createRepo();
    const keep = await prisma.settingsProfile.create({
      data: { repositoryId: repo.id, name: "残す" },
    });
    await prisma.settingsProfile.create({
      data: { repositoryId: repo.id, name: "消える" },
    });
    const app = createApp();

    const res = await putSettings(app, {
      ...baseSettings(),
      profiles: [{ id: keep.id, name: "残す(改名)" }],
    });
    expect(res.status).toBe(200);

    const remaining = await prisma.settingsProfile.findMany({
      where: { repositoryId: repo.id },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(keep.id);
    expect(remaining[0].name).toBe("残す(改名)");
  });
});
