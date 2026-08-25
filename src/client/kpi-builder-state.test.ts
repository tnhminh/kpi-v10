import { describe, expect, it } from "vitest";
import type { ScoringRuleDto } from "./api";
import { mergeThresholdRule, nextCriterionMaxScore } from "./kpi-builder-state";

const formulaRule: ScoringRuleDto = { id: "formula-1", position: 0, type: "FORMULA", expression: "metric * 0.1" };
const thresholdRule: ScoringRuleDto = {
  id: "threshold-1",
  position: 1,
  type: "THRESHOLD",
  bands: [{ operator: ">=", value: 90, score: 2.5 }],
  fallback: null,
};

 describe("KPI builder client state", () => {
  it("replaces only the threshold rule and preserves other scoring rule types", () => {
    const merged = mergeThresholdRule([formulaRule, thresholdRule], {
      type: "THRESHOLD",
      bands: [{ operator: ">=", value: 95, score: 3 }],
      fallback: 0,
    });

    expect(merged).toEqual([
      { type: "FORMULA", expression: "metric * 0.1" },
      { type: "THRESHOLD", bands: [{ operator: ">=", value: 95, score: 3 }], fallback: 0 },
    ]);
  });

  it("appends a threshold rule when the criterion does not have one", () => {
    const merged = mergeThresholdRule([formulaRule], {
      type: "THRESHOLD",
      bands: [{ operator: ">=", value: 80, score: 1 }],
      fallback: null,
    });

    expect(merged.map((rule) => rule.type)).toEqual(["FORMULA", "THRESHOLD"]);
  });

  it("never proposes a new criterion score that would exceed the KPI total of 10", () => {
    expect(nextCriterionMaxScore(8)).toBe(1);
    expect(nextCriterionMaxScore(9.6)).toBe(0.4);
    expect(nextCriterionMaxScore(10)).toBeNull();
    expect(nextCriterionMaxScore(11)).toBeNull();
  });
});
