import { describe, expect, it } from "vitest";
import { buildHistoricalAnalytics, type HistoricalEvaluationRow } from "./history";

const row = (patch: Partial<HistoricalEvaluationRow> = {}): HistoricalEvaluationRow => ({
  periodId: "p1", periodKey: "2026-07", startsOn: "2026-07-01", endsOn: "2026-07-31",
  memberId: "m1", memberName: "Member", teamId: "t1", teamName: "Team",
  status: "LOCKED", finalScore: "8.5", finalRank: "C", finalCoefficient: "1.0", ...patch,
});

describe("historical analytics authority", () => {
  it("counts non-final workflow rows as coverage but never as score zero", () => {
    const result = buildHistoricalAnalytics([row(), row({ memberId: "m2", status: "HEAD_REVIEW", finalScore: null })], "ORGANIZATION");
    expect(result.summary.score).toBe(8.5);
    expect(result.summary.coverageLabel).toBe("1 / 2 valid evaluations");
    expect(result.series[0]?.score).toBe(8.5);
  });

  it("uses only FINALIZED/LOCKED final values across periods", () => {
    const result = buildHistoricalAnalytics([
      row(),
      row({ periodId: "p2", periodKey: "2026-08", startsOn: "2026-08-01", endsOn: "2026-08-31", status: "FINALIZED", finalScore: 9.5, finalRank: "B" }),
      row({ periodId: "p3", periodKey: "2026-09", startsOn: "2026-09-01", endsOn: "2026-09-30", status: "SYSTEM_EVALUATED", finalScore: null }),
    ], "SELF");
    expect(result.summary.score).toBe(9);
    expect(result.summary.validCount).toBe(2);
    expect(result.summary.totalCount).toBe(3);
    expect(result.latest?.periodKey).toBe("2026-08");
  });

  it("rejects corrupt finalized data rather than excluding it as N/A", () => {
    expect(() => buildHistoricalAnalytics([row({ finalScore: 99 })], "SELF")).toThrow(/corrupt/);
  });
});
