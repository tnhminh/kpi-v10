import { describe, expect, it } from "vitest";
import { normalizeJiraIssue, requiredJiraFields, type JiraRemoteIssue } from "./normalizer";
import type { JiraSyncConfig } from "./validation";

const issue: JiraRemoteIssue = {
  issueKey: "BE-1", summary: "Ship", updatedAt: "2026-08-25T01:00:00Z", assigneeAccountId: "acct-1", issueType: "Task", status: "Done",
  fields: { resolutiondate: "2026-08-20T00:00:00Z", duedate: "2026-08-21T00:00:00Z", labels: ["proactive"], status: { name: "Done" }, customfield_1: 8 },
};
const config: JiraSyncConfig = { jql: "project = BE", fields: [], factMappings: {
  committed: { type: "CONSTANT", value: 1 },
  completedOnTime: { type: "DATE_LTE", leftField: "resolutiondate", rightField: "duedate" },
  detections: { type: "LABEL_PRESENT", field: "labels", label: "proactive" },
  storyPoints: { type: "FIELD", field: "customfield_1" },
} };

describe("Jira fact normalization", () => {
  it("applies declarative mappings without dynamic code execution", () => {
    const result = normalizeJiraIssue(issue, config);
    expect(result.facts).toMatchObject({ issueKey: "BE-1", committed: 1, completedOnTime: 1, detections: 1, storyPoints: 8 });
    expect(result.attribution).toMatchObject({ source: "JIRA" });
  });
  it("derives the remote Jira fields required by mappings", () => {
    expect(requiredJiraFields(config)).toEqual(expect.arrayContaining(["summary", "assignee", "resolutiondate", "duedate", "labels", "customfield_1"]));
  });
});
