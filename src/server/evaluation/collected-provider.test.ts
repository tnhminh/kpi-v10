import { describe, expect, it } from "vitest";
import { CollectedInputError, CollectedMetricInputProvider } from "./collected-provider";
import type { MetricInputContext } from "./pipeline";

const baseContext: MetricInputContext = {
  organizationId: "org-1",
  memberId: "member-1",
  period: { id: "period-1", key: "2026-09", startsOn: "2026-09-01", endsOn: "2026-09-30" },
  criterion: {
    id: "criterion-1",
    name: "Delivery",
    method: "AUTO",
    requiredEvidence: false,
    evidenceSources: ["JIRA", "MANUAL"],
  },
  metricDefinition: {
    id: "metric-1",
    key: "completion",
    name: "Completion",
    formulaKind: "RATIO",
    formula: null,
    requiredFields: ["done", "total"],
    dataQualityRequirements: {},
  },
  parameters: {},
};

describe("collected metric input provider", () => {
  it("rejects duplicate criterion payloads", () => {
    expect(() => new CollectedMetricInputProvider([
      { criterionId: "criterion-1" },
      { criterionId: "criterion-1" },
    ])).toThrow(CollectedInputError);
  });

  it("keeps missing required fields as critical data-quality issues", async () => {
    const provider = new CollectedMetricInputProvider([{
      criterionId: "criterion-1",
      inputFacts: { done: 9 },
      metric: { value: 90 },
      confidence: "HIGH",
    }]);

    const result = await provider.collect(baseContext);
    expect(result.metric.value).toBe(90);
    expect(result.qualityIssues).toContainEqual(expect.objectContaining({
      code: "REQUIRED_METRIC_FIELD_MISSING",
      missingField: "total",
      severity: "CRITICAL",
    }));
  });

  it("computes custom-formula metrics using repository-owned formula evaluation", async () => {
    const provider = new CollectedMetricInputProvider([{
      criterionId: "criterion-1",
      inputFacts: { bugs: 2 },
      confidence: "HIGH",
    }]);

    const result = await provider.collect({
      ...baseContext,
      metricDefinition: {
        ...baseContext.metricDefinition,
        key: "quality_index",
        name: "Quality Index",
        formulaKind: "CUSTOM_FORMULA",
        formula: "100 - bugs * 10",
        requiredFields: ["bugs"],
      },
    });

    expect(result.metric.value).toBe(80);
    expect(result.qualityIssues).toEqual([]);
  });

  it("rejects evidence from a source not configured for the criterion", async () => {
    const provider = new CollectedMetricInputProvider([{
      criterionId: "criterion-1",
      inputFacts: { done: 9, total: 10 },
      metric: { value: 90 },
      evidence: [{ type: "CUSTOM", title: "Unconfigured source" }],
    }]);

    await expect(provider.collect(baseContext)).rejects.toThrow(CollectedInputError);
  });

  it("does not fabricate a scoreable metric when no collected value exists", async () => {
    const provider = new CollectedMetricInputProvider([{
      criterionId: "criterion-1",
      inputFacts: { done: 9, total: 10 },
    }]);

    const result = await provider.collect(baseContext);
    expect(result.metric.value).toBeNull();
    expect(result.confidence).toBe("REVIEW_REQUIRED");
    expect(result.qualityIssues).toContainEqual(expect.objectContaining({
      code: "METRIC_VALUE_MISSING",
      severity: "CRITICAL",
    }));
  });
});
