import { describe, expect, it } from "vitest";
import { assertConfiguredKpiTotal, assertLifecycleAction, assertRuleValidForCriterion, assertVersionConfigurationMutable, assertVersionReadyForSubmission } from "./configuration";

const criterion = {
  id: "delivery",
  position: 0,
  maxScore: 10,
  method: "AUTO" as const,
  requiredEvidence: true,
  evidenceSources: ["JIRA"] as const,
  hasMetricConfiguration: true,
  rules: [{ type: "THRESHOLD" as const, bands: [{ operator: ">=" as const, value: 90, score: 10 }] }],
};

describe("KPI configuration lifecycle", () => {
  it("freezes a submitted draft", () => {
    expect(() => assertVersionConfigurationMutable({ status: "DRAFT", submittedAt: new Date() })).toThrow(/frozen/i);
  });

  it("requires criteria to total exactly 10", () => {
    expect(() => assertVersionReadyForSubmission({
      status: "DRAFT",
      submittedAt: null,
      approvedAt: null,
      criteria: [{ ...criterion, maxScore: 9, rules: [{ type: "THRESHOLD" as const, bands: [{ operator: ">=" as const, value: 90, score: 9 }] }] }],
    })).toThrow(/exactly 10/i);
  });

  it("requires metric and rules for automated criteria", () => {
    expect(() => assertVersionReadyForSubmission({ status: "DRAFT", submittedAt: null, approvedAt: null, criteria: [{ ...criterion, hasMetricConfiguration: false }] })).toThrow(/metric configuration/i);
    expect(() => assertVersionReadyForSubmission({ status: "DRAFT", submittedAt: null, approvedAt: null, criteria: [{ ...criterion, rules: [] }] })).toThrow(/scoring rule/i);
  });

  it("requires configured evidence when evidence is mandatory", () => {
    expect(() => assertVersionReadyForSubmission({ status: "DRAFT", submittedAt: null, approvedAt: null, criteria: [{ ...criterion, evidenceSources: [] }] })).toThrow(/evidence source/i);
  });

  it("rejects rule scores above criterion max and invalid formula syntax", () => {
    expect(() => assertRuleValidForCriterion({ type: "RANGE", ranges: [{ min: 0, max: 10, score: 3 }] }, 2)).toThrow(/criterion max/i);
    expect(() => assertRuleValidForCriterion({ type: "FORMULA", expression: "value +" }, 10)).toThrow(/formula syntax/i);
    expect(() => assertRuleValidForCriterion({ type: "FORMULA", expression: "value / target" }, 10)).not.toThrow();
  });

  it("rejects configured totals above 10 before the database constraint is reached", () => {
    expect(() => assertConfiguredKpiTotal(10)).not.toThrow();
    expect(() => assertConfiguredKpiTotal(10.01)).toThrow(/cannot exceed 10/i);
  });

  it("enforces submit approve publish order", () => {
    const base = { status: "DRAFT" as const, submittedAt: null, approvedAt: null, criteria: [criterion] };
    expect(() => assertLifecycleAction(base, "SUBMIT")).not.toThrow();
    expect(() => assertLifecycleAction(base, "APPROVE")).toThrow(/submitted/i);
    const submitted = { ...base, submittedAt: new Date() };
    expect(() => assertLifecycleAction(submitted, "APPROVE")).not.toThrow();
    expect(() => assertLifecycleAction(submitted, "PUBLISH")).toThrow(/approved/i);
    expect(() => assertLifecycleAction({ ...submitted, approvedAt: new Date() }, "PUBLISH")).not.toThrow();
  });
});
