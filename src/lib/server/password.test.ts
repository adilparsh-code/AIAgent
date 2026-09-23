import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing (scrypt)", () => {
  it("round-trips a password through hash and verify", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("hunter2hunter2");
    expect(await verifyPassword("hunter2hunter3", hash)).toBe(false);
  });

  it("never persists plaintext and uses a unique salt per hash", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toContain("same-password");
    expect(a).not.toBe(b); // different salts
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("returns false (not throw) for malformed or unknown hash formats", async () => {
    await expect(verifyPassword("x", "")).resolves.toBe(false);
    await expect(verifyPassword("x", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("x", "bcrypt$16384$8$1$aa$bb")).resolves.toBe(false);
    await expect(verifyPassword("x", "scrypt$1$1$1$zz$zz")).resolves.toBe(false); // degenerate params refused
    await expect(verifyPassword("x", "scrypt$16384$8$1$$")).resolves.toBe(false);
  });
});
