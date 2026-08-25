import { describe, expect, it } from "vitest";
import { getRequestId, requestIdHeaders } from "./request-context";

describe("request context", () => {
  it("preserves a valid incoming request id", () => {
    expect(getRequestId(new Headers({ "x-request-id": "trace-123" }))).toBe("trace-123");
  });

  it("generates an id when none is present", () => {
    expect(getRequestId(new Headers())).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("returns a response header mapping", () => {
    expect(requestIdHeaders("abc")).toEqual({ "x-request-id": "abc" });
  });
});
