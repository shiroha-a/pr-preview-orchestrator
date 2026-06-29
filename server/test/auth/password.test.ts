import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../../src/auth/password";

describe("hashPassword", () => {
  it("bcryptハッシュ文字列を返す", async () => {
    const hash = await hashPassword("secret");
    expect(hash).toMatch(/^\$2[aby]\$\d+\$/);
  });

  it("同じパスワードでも異なるハッシュ", async () => {
    const h1 = await hashPassword("secret");
    const h2 = await hashPassword("secret");
    expect(h1).not.toBe(h2);
  });
});

describe("verifyPassword", () => {
  it("正しいパスワードでtrue", async () => {
    const hash = await hashPassword("mypass");
    expect(await verifyPassword("mypass", hash)).toBe(true);
  });

  it("誤ったパスワードでfalse", async () => {
    const hash = await hashPassword("mypass");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("空文字パスワードも検証できる", async () => {
    const hash = await hashPassword("");
    expect(await verifyPassword("", hash)).toBe(true);
    expect(await verifyPassword("x", hash)).toBe(false);
  });
});
