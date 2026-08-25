import { describe, expect, it } from "vitest";
import { canonicalSnapshotJson, snapshotChecksum } from "./snapshot";

describe("historical snapshot canonicalization", () => {
  it("sorts object keys recursively so equivalent payloads have the same checksum", () => {
    const a = { z: 1, nested: { b: 2, a: [3, { y: true, x: "ok" }] } };
    const b = { nested: { a: [3, { x: "ok", y: true }], b: 2 }, z: 1 };
    expect(canonicalSnapshotJson(a)).toBe(canonicalSnapshotJson(b));
    expect(snapshotChecksum(a)).toBe(snapshotChecksum(b));
    expect(snapshotChecksum(a)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects non-finite numeric values", () => {
    expect(() => snapshotChecksum({ score: Number.NaN })).toThrow(/non-finite/i);
    expect(() => snapshotChecksum({ score: Number.POSITIVE_INFINITY })).toThrow(/non-finite/i);
  });
});
