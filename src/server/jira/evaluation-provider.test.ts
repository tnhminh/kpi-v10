import { describe, expect, it } from "vitest";
import { JiraMetricInputProvider, type JiraEvaluationFact } from "./evaluation-provider";
import type { MetricInputContext } from "@/server/evaluation/pipeline";

const baseContext: MetricInputContext = {
  organizationId: "org-1",
  memberId: "member-1",
  period: { id: "period-1", key: "2026-09", startsOn: "2026-09-01", endsOn: "2026-09-30" },
  criterion: { id: "criterion-1", name: "Delivery", method: "AUTO", requiredEvidence: true, evidenceSources: ["JIRA"] },
  metricDefinition: {
    id: "metric-1",
    key: "on_time_completion_rate",
    name: "On-time Completion Rate",
    formulaKind: "RATIO",
    formula: null,
    requiredFields: ["committed", "completedOnTime"],
    supportedIssueTypes: [],
    dataQualityRequirements: { requireCompleteFields: true },
  },
  parameters: {},
};

function fact(issueKey: string, facts: Record<string, unknown>, created = "2026-09-10T09:00:00.000Z"): JiraEvaluationFact {
  return {
    jiraIssueId: `jira-${issueKey}`,
    issueKey,
    summary: issueKey,
    workspaceUrl: "https://demo.atlassian.net",
    facts: { issueType: "Story", updatedAt: created, ...facts },
    attribution: { source: "JIRA" },
    sourceUpdatedAt: created,
    issueCreatedAt: created,
  };
}

describe("Jira metric input provider", () => {
  it("aggregates on-time completion from period-scoped Jira facts and exposes evidence", async () => {
    const provider = new JiraMetricInputProvider([
      fact("KPI-1", { committed: 1, completedOnTime: 1 }),
      fact("KPI-2", { committed: 1, completedOnTime: 0 }),
      fact("KPI-3", { committed: 1, completedOnTime: 1 }, "2026-10-03T09:00:00.000Z"),
    ]);
    const bundle = await provider.collect(baseContext);
    expect(bundle.metric.value).toBe(50);
    expect(bundle.inputFacts).toMatchObject({ committed: 2, completedOnTime: 1, completionObservations: 2 });
    expect(bundle.evidence.map((item) => item.title)).toEqual(["KPI-1 · KPI-1", "KPI-2 · KPI-2"]);
    expect(provider.contributingIssueIds()).toHaveLength(2);
  });

  it("turns incomplete required Jira observations into critical quality instead of zero", async () => {
    const provider = new JiraMetricInputProvider([
      fact("KPI-1", { committed: 1, completedOnTime: 1 }),
      fact("KPI-2", { committed: 1, completedOnTime: null }),
    ]);
    const bundle = await provider.collect(baseContext);
    expect(bundle.metric.value).toBe(100);
    expect(bundle.confidence).toBe("REVIEW_REQUIRED");
    expect(bundle.qualityIssues).toContainEqual(expect.objectContaining({ code: "JIRA_REQUIRED_FACTS_INCOMPLETE", severity: "CRITICAL" }));
  });

  it("computes median incident resolution time", async () => {
    const rows = [45, 120, 90].map((minutes, index) => fact(`INC-${index}`, { issueType: "Incident", resolutionMinutes: minutes }));
    const provider = new JiraMetricInputProvider(rows);
    const bundle = await provider.collect({
      ...baseContext,
      metricDefinition: { ...baseContext.metricDefinition, key: "resolution_time_minutes", name: "Resolution Time", formulaKind: "DURATION", requiredFields: ["resolutionMinutes"] },
    });
    expect(bundle.metric.value).toBe(90);
    expect(bundle.inputFacts).toMatchObject({ incidentCount: 3, resolutionObservations: 3 });
  });

  it("uses frozen snapshots without applying current period filtering again", async () => {
    const provider = new JiraMetricInputProvider([
      fact("KPI-OLD", { committed: 1, completedOnTime: 1 }, "2026-10-03T09:00:00.000Z"),
    ], true);
    const bundle = await provider.collect(baseContext);
    expect(bundle.metric.value).toBe(100);
    expect(provider.contributingIssueIds()).toEqual(["jira-KPI-OLD"]);
  });
});
