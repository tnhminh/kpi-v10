import { describe, expect, it } from "vitest";
import { aggregateEvaluation, evaluateCriterion, type MetricInputProvider, type PipelineCriterion, UnavailableMetricInputProvider } from "./pipeline";

const period = { id: "period-1", key: "2026-09", startsOn: "2026-09-01", endsOn: "2026-09-30" };
const metricDefinition = { id: "metric-1", key: "completion", name: "Completion", formulaKind: "RATIO", formula: null, requiredFields: ["done", "total"], dataQualityRequirements: {} };
const criterion: PipelineCriterion = {
  id: "criterion-1",
  name: "Delivery",
  maxScore: 3,
  method: "AUTO",
  requiredEvidence: true,
  evidenceSources: ["JIRA"],
  metricConfiguration: { metricDefinitionId: "metric-1", parameters: {} },
  metricDefinition,
  rules: [{ type: "THRESHOLD", bands: [{ operator: ">=", value: 90, score: 3 }, { operator: ">=", value: 80, score: 2.5 }], fallback: null }],
};

function provider(overrides: Partial<Awaited<ReturnType<MetricInputProvider["collect"]>>> = {}): MetricInputProvider {
  return {
    async collect() {
      return {
        inputFacts: { done: 9, total: 10 },
        metric: { value: 90, variables: { done: 9, total: 10 } },
        confidence: "HIGH",
        evidence: [{ type: "JIRA", sourceRef: "ABC-1", title: "ABC-1" }],
        qualityIssues: [],
        ...overrides,
      };
    },
  };
}

describe("evaluation pipeline", () => {
  it("scores AUTO criteria from provider metrics and keeps an explanation/evidence trace", async () => {
    const result = await evaluateCriterion({ organizationId: "org-1", memberId: "member-1", period, criterion, provider: provider() });
    expect(result.result).toEqual({ status: "EVALUATED", value: 3 });
    expect(result.confidence).toBe("HIGH");
    expect(result.evidence[0]?.sourceRef).toBe("ABC-1");
    expect(result.explanationTrace).toMatchObject({ rule: { type: "THRESHOLD" }, score: { status: "EVALUATED", value: 3 } });
  });

  it("never converts missing provider data to zero", async () => {
    const result = await evaluateCriterion({ organizationId: "org-1", memberId: "member-1", period, criterion, provider: new UnavailableMetricInputProvider() });
    expect(result.result.status).toBe("NOT_EVALUATED");
    expect(result.confidence).toBe("REVIEW_REQUIRED");
    expect(result.qualityIssues.map((item) => item.code)).toContain("METRIC_INPUT_UNAVAILABLE");
  });

  it("keeps MANUAL criteria out of system scoring without treating them as data-quality failures", async () => {
    const result = await evaluateCriterion({ organizationId: "org-1", memberId: "member-1", period, criterion: { ...criterion, method: "MANUAL", metricConfiguration: null, metricDefinition: null, rules: [] }, provider: provider() });
    expect(result.result).toEqual({ status: "NOT_EVALUATED", reason: "Manual criterion requires human review." });
    expect(result.qualityIssues).toEqual([]);
  });

  it("uses scoring rules as an ordered fallback chain and records attempts", async () => {
    const result = await evaluateCriterion({
      organizationId: "org-1",
      memberId: "member-1",
      period,
      criterion: { ...criterion, rules: [{ type: "THRESHOLD", bands: [{ operator: ">=", value: 95, score: 3 }], fallback: null }, { type: "RANGE", ranges: [{ min: 80, max: 95, score: 2.5 }] }] },
      provider: provider(),
    });
    expect(result.result).toEqual({ status: "EVALUATED", value: 2.5 });
    expect(result.explanationTrace).toMatchObject({ rule: { type: "RANGE" }, ruleAttempts: [{ type: "THRESHOLD" }, { type: "RANGE" }] });
  });

  it("requires full criterion coverage for the system KPI aggregate", async () => {
    const evaluated = await evaluateCriterion({ organizationId: "org-1", memberId: "member-1", period, criterion, provider: provider() });
    const manual = await evaluateCriterion({ organizationId: "org-1", memberId: "member-1", period, criterion: { ...criterion, id: "criterion-2", maxScore: 7, method: "MANUAL", metricConfiguration: null, metricDefinition: null, rules: [] }, provider: provider() });
    const summary = aggregateEvaluation([evaluated, manual]);
    expect(summary.aggregate.result.status).toBe("NOT_EVALUATED");
    expect(summary.aggregate.coverage).toBeCloseTo(0.3);
    expect(summary.confidence).toBe("REVIEW_REQUIRED");
  });

  it("blocks system scoring when the provider reports a critical data-quality issue", async () => {
    const result = await evaluateCriterion({
      organizationId: "org-1",
      memberId: "member-1",
      period,
      criterion,
      provider: provider({ qualityIssues: [{ code: "MISSING_FIELD", missingField: "done", severity: "CRITICAL", message: "done is required" }] }),
    });
    expect(result.result.status).toBe("NOT_EVALUATED");
    expect(result.confidence).toBe("REVIEW_REQUIRED");
    expect(result.qualityIssues).toContainEqual(expect.objectContaining({ code: "MISSING_FIELD", severity: "CRITICAL" }));
  });

  it("treats missing required evidence as a critical issue instead of scoring through it", async () => {
    const result = await evaluateCriterion({
      organizationId: "org-1",
      memberId: "member-1",
      period,
      criterion,
      provider: provider({ evidence: [] }),
    });
    expect(result.result.status).toBe("NOT_EVALUATED");
    expect(result.qualityIssues).toContainEqual(expect.objectContaining({ code: "REQUIRED_EVIDENCE_MISSING", severity: "CRITICAL" }));
  });
});
