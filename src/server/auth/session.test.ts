import { describe, expect, it } from "vitest";
import {
  clearSessionCookie,
  generateSessionToken,
  hashSessionToken,
  loginThrottleKey,
  normalizeEmail,
  parseSessionToken,
  serializeSessionCookie,
  SESSION_COOKIE_NAME,
} from "./session";

const secret = "12345678901234567890123456789012";

describe("session security", () => {
  it("generates high-entropy tokens and stores only keyed hashes", () => {
    const one = generateSessionToken();
    const two = generateSessionToken();
    expect(one).not.toBe(two);
    expect(one.length).toBeGreaterThanOrEqual(43);
    const hash = hashSessionToken(one, secret);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(one);
  });

  it("normalizes throttle identities without persisting the email", () => {
    expect(normalizeEmail("  USER@Example.COM ")).toBe("user@example.com");
    expect(loginThrottleKey("USER@example.com", secret)).toBe(loginThrottleKey("user@example.com", secret));
    expect(loginThrottleKey("user@example.com", secret)).not.toContain("user@example.com");
  });

  it("parses only the configured session cookie", () => {
    expect(parseSessionToken(`x=1; ${SESSION_COOKIE_NAME}=abc123; y=2`)).toBe("abc123");
    expect(parseSessionToken("x=1")).toBeNull();
  });

  it("uses HttpOnly, Strict SameSite and Secure in production cookies", () => {
    const expires = new Date(Date.now() + 60_000);
    const cookie = serializeSessionCookie("token", expires, true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(clearSessionCookie(true)).toContain("Max-Age=0");
  });
});
