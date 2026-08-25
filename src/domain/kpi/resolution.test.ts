import { describe, expect, it } from "vitest";
import { resolveEvaluationConfiguration, resolvePrimaryMembership } from "./resolution";
import type { EffectiveMembership, KpiAssignment } from "./types";

const memberships: EffectiveMembership[] = [
  { id: "aug-api", memberId: "m1", teamId: "api", effectiveFrom: "2026-01-01", effectiveTo: "2026-08-31", primary: true },
  { id: "sep-payment", memberId: "m1", teamId: "payment", effectiveFrom: "2026-09-01", effectiveTo: null, primary: true },
];
const assignments: KpiAssignment[] = [
  { periodId: "2026-08", teamId: "api", kpiVersionId: "api-v1" },
  { periodId: "2026-09", teamId: "payment", kpiVersionId: "payment-v2" },
];

describe("period-aware resolution", () => {
  it("resolves the historical team before a transfer", () => {
    expect(resolveEvaluationConfiguration({ memberId: "m1", periodId: "2026-08", periodStartDate: "2026-08-01", memberships, assignments })).toEqual({ membershipId: "aug-api", teamId: "api", kpiVersionId: "api-v1" });
  });

  it("resolves the new team after the transfer", () => {
    expect(resolveEvaluationConfiguration({ memberId: "m1", periodId: "2026-09", periodStartDate: "2026-09-01", memberships, assignments })).toEqual({ membershipId: "sep-payment", teamId: "payment", kpiVersionId: "payment-v2" });
  });

  it("rejects multiple simultaneous primary memberships", () => {
    const broken = [...memberships, { id: "dup", memberId: "m1", teamId: "ads", effectiveFrom: "2026-09-01", effectiveTo: null, primary: true }];
    expect(() => resolvePrimaryMembership("m1", "2026-09-10", broken)).toThrow(/Multiple primary/);
  });

  it("rejects normalized-but-impossible calendar dates", () => {
    expect(() => resolvePrimaryMembership("m1", "2026-02-31", memberships)).toThrow(/real calendar date/);
  });

  it("rejects corrupt membership ranges", () => {
    const broken = [{ id: "bad", memberId: "m1", teamId: "api", effectiveFrom: "2026-09-10", effectiveTo: "2026-09-01", primary: true }];
    expect(() => resolvePrimaryMembership("m1", "2026-09-10", broken)).toThrow(/invalid effective range/);
  });
});
