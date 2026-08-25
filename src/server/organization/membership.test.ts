import { describe, expect, it } from "vitest";
import { assertNoPrimaryMembershipOverlap, dateRangesOverlap } from "./membership";

describe("effective team membership ranges", () => {
  it("treats touching inclusive date ranges as overlapping", () => {
    expect(dateRangesOverlap(
      { effectiveFrom: "2026-08-01", effectiveTo: "2026-08-31" },
      { effectiveFrom: "2026-08-31", effectiveTo: "2026-09-30" },
    )).toBe(true);
  });

  it("allows a transfer beginning the day after the prior membership ends", () => {
    expect(dateRangesOverlap(
      { effectiveFrom: "2026-08-01", effectiveTo: "2026-08-31" },
      { effectiveFrom: "2026-09-01", effectiveTo: null },
    )).toBe(false);
  });

  it("rejects a second open-ended primary membership", () => {
    expect(() => assertNoPrimaryMembershipOverlap(
      { effectiveFrom: "2026-09-01", effectiveTo: null },
      [{ effectiveFrom: "2026-08-01", effectiveTo: null }],
    )).toThrow(/overlaps/);
  });
});
