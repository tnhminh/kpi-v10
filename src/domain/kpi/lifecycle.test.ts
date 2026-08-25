import { describe, expect, it } from "vitest";
import { assertCanFinalize, assertCanLock, assertMutable, recalculationPolicy, validateAdjustment } from "./lifecycle";

describe("evaluation lifecycle", () => {
  it("allows automatic recalculation before human review", () => {
    expect(recalculationPolicy("SYSTEM_EVALUATED")).toEqual({ allowed: true, mode: "AUTO" });
  });

  it("never silently overwrites leader review", () => {
    expect(recalculationPolicy("LEADER_REVIEW").allowed).toBe(false);
    expect(recalculationPolicy("LEADER_REVIEW", true)).toEqual({ allowed: true, mode: "EXPLICIT_REFRESH" });
  });

  it("blocks finalized and locked recalculation", () => {
    expect(recalculationPolicy("FINALIZED").allowed).toBe(false);
    expect(recalculationPolicy("LOCKED").allowed).toBe(false);
  });

  it("requires a reason for meaningful adjustments", () => {
    expect(() => validateAdjustment({ previousScore: 2, newScore: 2.4, maxScore: 3 })).toThrow(/reason/i);
    expect(validateAdjustment({ previousScore: 2, newScore: 2.4, maxScore: 3, reason: "Additional evidence" })).toBe(2.4);
  });

  it("rejects invalid adjustment policy thresholds", () => {
    expect(() => validateAdjustment({ previousScore: 2, newScore: 2.1, maxScore: 3, meaningfulDelta: -1 })).toThrow(/threshold/i);
  });

  it("enforces criterion score bounds", () => {
    expect(() => validateAdjustment({ previousScore: 2, newScore: 3.1, maxScore: 3, reason: "x" })).toThrow(/bounds/i);
  });

  it("requires head review completion before finalization", () => {
    expect(() => assertCanFinalize("LEADER_REVIEW", 0, true)).toThrow(/Department Head/);
    expect(() => assertCanFinalize("HEAD_REVIEW", 1, true)).toThrow(/data-quality/);
    expect(() => assertCanFinalize("HEAD_REVIEW", 0, true)).not.toThrow();
  });

  it("requires finalized state plus snapshot before lock", () => {
    expect(() => assertCanLock("HEAD_REVIEW", true)).toThrow(/finalized/i);
    expect(() => assertCanLock("FINALIZED", false)).toThrow(/snapshot/i);
    expect(() => assertCanLock("FINALIZED", true)).not.toThrow();
  });

  it("treats locked evaluations as immutable", () => {
    expect(() => assertMutable("LOCKED")).toThrow(/immutable/i);
  });
});
