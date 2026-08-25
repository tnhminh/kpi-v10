import { describe, expect, it } from "vitest";
import { DUMMY_PASSWORD_HASH, hashPassword, validateNewPassword, verifyPassword } from "./password";

describe("password security", () => {
  it("hashes with scrypt and verifies using constant-length derived keys", async () => {
    const hash = await hashPassword("Correct-Horse-42!");
    expect(hash.startsWith("scrypt$131072$8$1$")).toBe(true);
    expect(hash).not.toContain("Correct-Horse-42!");
    await expect(verifyPassword("Correct-Horse-42!", hash)).resolves.toBe(true);
    await expect(verifyPassword("Wrong-Horse-42!", hash)).resolves.toBe(false);
  });

  it("rejects malformed hashes without throwing", async () => {
    await expect(verifyPassword("anything", "not-a-valid-hash")).resolves.toBe(false);
  });

  it("enforces the new-password length policy", () => {
    expect(() => validateNewPassword("too-short")).toThrow(/at least 12/);
  });

  it("keeps a valid dummy hash for non-enumerating login checks", async () => {
    await expect(verifyPassword("kpi-invalid-login-placeholder", DUMMY_PASSWORD_HASH)).resolves.toBe(true);
  });
});
