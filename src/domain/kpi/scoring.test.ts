import { describe, expect, it } from "vitest";
import { aggregateKpi, buildScoreExplanation, clampScore, scoreMetric } from "./scoring";

describe("scoring engine", () => {
  it("clamps scores to criterion bounds", () => {
    expect(clampScore(4, 3)).toBe(3);
    expect(clampScore(-1, 3)).toBe(0);
  });

  it("maps a threshold metric deterministically", () => {
    const result = scoreMetric(
      { value: 88 },
      { type: "THRESHOLD", bands: [{ operator: ">=", value: 95, score: 3 }, { operator: ">=", value: 85, score: 2.5 }], fallback: null },
      3,
    );
    expect(result).toEqual({ status: "EVALUATED", value: 2.5 });
  });

  it("keeps missing metric data as NOT_EVALUATED", () => {
    const result = scoreMetric({ value: null }, { type: "THRESHOLD", bands: [{ operator: ">=", value: 80, score: 2 }] }, 3);
    expect(result.status).toBe("NOT_EVALUATED");
  });

  it("supports range rules with explicit boundaries", () => {
    const result = scoreMetric({ value: 90 }, { type: "RANGE", ranges: [{ min: 90, max: 95, minInclusive: true, maxInclusive: false, score: 2.8 }] }, 3);
    expect(result).toEqual({ status: "EVALUATED", value: 2.8 });
  });

  it("supports safe formulas without eval", () => {
    const result = scoreMetric({ value: 80, variables: { completion: 80, quality: 90 } }, { type: "FORMULA", expression: "completion / 100 * 2 + quality / 100" }, 3);
    expect(result).toEqual({ status: "EVALUATED", value: 2.5 });
  });

  it("turns missing formula inputs into NOT_EVALUATED", () => {
    const result = scoreMetric({ value: 80 }, { type: "FORMULA", expression: "value + missing" }, 3);
    expect(result.status).toBe("NOT_EVALUATED");
  });

  it("supports hybrid conditions", () => {
    const result = scoreMetric({ value: 88, variables: { reopen: 5 } }, { type: "HYBRID", branches: [{ all: [{ field: "value", operator: ">=", value: 85 }, { field: "reopen", operator: "<=", value: 8 }], score: 2.7 }] }, 3);
    expect(result).toEqual({ status: "EVALUATED", value: 2.7 });
  });

  it("rejects externally supplied criterion scores outside configured bounds", () => {
    expect(() => aggregateKpi([{ criterionId: "delivery", maxScore: 3, result: { status: "EVALUATED", value: 3.1 } }])).toThrow(/outside/);
  });

  it("does not convert an unevaluated criterion to zero in the KPI", () => {
    const aggregate = aggregateKpi([
      { criterionId: "delivery", maxScore: 5, result: { status: "EVALUATED", value: 4.5 } },
      { criterionId: "quality", maxScore: 5, result: { status: "NOT_EVALUATED", reason: "missing evidence" } },
    ]);
    expect(aggregate.result.status).toBe("NOT_EVALUATED");
    expect(aggregate.coverage).toBe(0.5);
  });

  it("allows explicitly labeled partial aggregation without inventing zero", () => {
    const aggregate = aggregateKpi([
      { criterionId: "delivery", maxScore: 5, result: { status: "EVALUATED", value: 4.5 } },
      { criterionId: "quality", maxScore: 5, result: { status: "NOT_EVALUATED", reason: "missing evidence" } },
    ], false);
    expect(aggregate.result).toEqual({ status: "EVALUATED", value: 4.5 });
    expect(aggregate.evaluatedCriteria).toBe(1);
  });

  it("builds the complete explainability trace", () => {
    const trace = buildScoreExplanation({
      inputFacts: { committed: 50, completed: 46, onTime: 44 },
      metric: { value: 88 },
      metricLabel: "On-time Completion",
      rule: { type: "THRESHOLD", bands: [{ operator: ">=", value: 85, score: 2.5 }] },
      maxScore: 3,
      confidence: "HIGH",
      evidence: ["ABC-123"],
    });
    expect(trace.score).toEqual({ status: "EVALUATED", value: 2.5 });
    expect(trace.evidence).toEqual(["ABC-123"]);
  });
});
