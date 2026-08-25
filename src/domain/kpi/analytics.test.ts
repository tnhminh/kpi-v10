import { describe, expect, it } from "vitest";
import { aggregateHistoricalFinalScores } from "./analytics";
import type { RankBand } from "./types";

const bands: RankBand[] = [
  { rank: "E", coefficient: 0.6, minScore: 0, maxScore: 7.5, minInclusive: true, maxInclusive: false },
  { rank: "D", coefficient: 0.8, minScore: 7.5, maxScore: 8, minInclusive: true, maxInclusive: false },
  { rank: "C", coefficient: 1, minScore: 8, maxScore: 9, minInclusive: true, maxInclusive: false },
  { rank: "B", coefficient: 1.1, minScore: 9, maxScore: 9.4, minInclusive: true, maxInclusive: false },
  { rank: "B+", coefficient: 1.2, minScore: 9.4, maxScore: 9.7, minInclusive: true, maxInclusive: false },
  { rank: "A", coefficient: 1.3, minScore: 9.7, maxScore: 10, minInclusive: true, maxInclusive: false },
  { rank: "A+", coefficient: 1.4, minScore: 10, maxScore: 10, minInclusive: true, maxInclusive: true },
];

describe("historical analytics", () => {
  it("excludes N/A periods instead of converting them to zero", () => {
    const aggregate = aggregateHistoricalFinalScores([null, null, 9], bands);
    expect(aggregate.score).toBe(9);
    expect(aggregate.coverageLabel).toBe("1 / 3 valid periods");
    expect(aggregate.rank).toEqual({ rank: "B", coefficient: 1.1 });
  });

  it("resolves rank and coefficient after averaging valid finals", () => {
    const aggregate = aggregateHistoricalFinalScores([8.5, 9, 9.5], bands);
    expect(aggregate.score).toBe(9);
    expect(aggregate.rank).toEqual({ rank: "B", coefficient: 1.1 });
  });

  it("returns no aggregate when no valid period exists", () => {
    expect(aggregateHistoricalFinalScores([null, null], bands)).toEqual({ score: null, validCount: 0, totalCount: 2, coverageLabel: "0 / 2 valid periods", rank: null });
  });

  it("rejects corrupt non-finite history instead of treating it as N/A", () => {
    expect(() => aggregateHistoricalFinalScores([8.5, Number.NaN], bands)).toThrow(/finite/);
    expect(() => aggregateHistoricalFinalScores([8.5, Number.POSITIVE_INFINITY], bands)).toThrow(/finite/);
  });
});
