import { describe, expect, it } from "vitest";
import { resolveRank, validateRankScheme } from "./rank";
import type { RankBand } from "./types";

const scheme: RankBand[] = [
  { rank: "E", coefficient: 0.6, minScore: 0, maxScore: 7.5, minInclusive: true, maxInclusive: false },
  { rank: "D", coefficient: 0.8, minScore: 7.5, maxScore: 8, minInclusive: true, maxInclusive: false },
  { rank: "C", coefficient: 1, minScore: 8, maxScore: 9, minInclusive: true, maxInclusive: false },
  { rank: "B", coefficient: 1.1, minScore: 9, maxScore: 9.4, minInclusive: true, maxInclusive: false },
  { rank: "B+", coefficient: 1.2, minScore: 9.4, maxScore: 9.7, minInclusive: true, maxInclusive: false },
  { rank: "A", coefficient: 1.3, minScore: 9.7, maxScore: 10, minInclusive: true, maxInclusive: false },
  { rank: "A+", coefficient: 1.4, minScore: 10, maxScore: 10, minInclusive: true, maxInclusive: true },
];

describe("rank scheme", () => {
  it("accepts contiguous non-overlapping bands", () => {
    expect(() => validateRankScheme(scheme)).not.toThrow();
  });

  it("resolves boundaries exactly once", () => {
    expect(resolveRank(9, scheme)).toEqual({ rank: "B", coefficient: 1.1 });
    expect(resolveRank(10, scheme)).toEqual({ rank: "A+", coefficient: 1.4 });
  });

  it("rejects an overlap at a shared inclusive boundary", () => {
    const broken = scheme.map((band) => ({ ...band }));
    broken[0].maxInclusive = true;
    expect(() => validateRankScheme(broken)).toThrow(/overlap/i);
  });

  it("rejects a point gap when neither shared boundary is inclusive", () => {
    const broken = scheme.map((band) => ({ ...band }));
    broken[1].minInclusive = false;
    expect(() => validateRankScheme(broken)).toThrow(/gap/i);
  });
});
