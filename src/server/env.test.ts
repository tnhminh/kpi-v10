import { describe, expect, it } from "vitest";
import { isServerEnvReady, parseServerEnv } from "./env";

const valid = {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3712",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/kpi",
  AUTH_SECRET: "01234567890123456789012345678901",
  LOG_LEVEL: "info",
} as NodeJS.ProcessEnv;

describe("server environment", () => {
  it("accepts a complete environment", () => {
    expect(isServerEnvReady(valid)).toBe(true);
    expect(parseServerEnv(valid).NODE_ENV).toBe("test");
  });

  it("rejects short authentication secrets", () => {
    expect(isServerEnvReady({ ...valid, AUTH_SECRET: "too-short" })).toBe(false);
  });

  it("rejects missing database configuration", () => {
    const broken = { ...valid };
    delete broken.DATABASE_URL;
    expect(isServerEnvReady(broken)).toBe(false);
  });

  it("requires a dedicated metrics bearer token in production", () => {
    expect(isServerEnvReady({ ...valid, NODE_ENV: "production" })).toBe(false);
    expect(isServerEnvReady({
      ...valid,
      NODE_ENV: "production",
      METRICS_TOKEN: "metrics-token-value-that-is-at-least-32-characters",
    })).toBe(true);
  });
});
