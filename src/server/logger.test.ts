import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("structured logger", () => {
  it("redacts secret-key fields and credential-bearing strings before JSON emission", () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const write = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    logger.info("request complete Bearer visible-token", {
      timestamp: "forged-timestamp",
      level: "debug",
      message: "forged-message",
      service: "forged-service",
      password: "temporary-password",
      databaseUrl: "postgresql://user:password@localhost:5432/kpi",
      nested: {
        authorization: "Bearer nested-token",
        error: "connect postgresql://user:password@db.internal/kpi token=plain-token",
      },
      circular,
    });

    expect(write).toHaveBeenCalledTimes(1);
    const event = JSON.parse(String(write.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(event.timestamp).not.toBe("forged-timestamp");
    expect(event.level).toBe("info");
    expect(event.message).toBe("request complete Bearer [REDACTED]");
    expect(event.service).toBe("kpi-performance-studio");
    expect(event.password).toBe("[REDACTED]");
    expect(event.databaseUrl).toBe("[REDACTED]");
    expect(event.nested).toEqual({
      authorization: "[REDACTED]",
      error: "connect postgresql://[REDACTED]@db.internal/kpi token=[REDACTED]",
    });
    expect(event.circular).toEqual({ self: "[Circular]" });
  });

  it("serializes Error fields without throwing or emitting raw credentials", () => {
    vi.stubEnv("LOG_LEVEL", "error");
    const write = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logger.error("database failure", {
      error: new Error("failed postgresql://user:password@db.internal/kpi"),
    });

    const event = JSON.parse(String(write.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(event.error).toEqual({
      name: "Error",
      message: "failed postgresql://[REDACTED]@db.internal/kpi",
    });
  });
});
