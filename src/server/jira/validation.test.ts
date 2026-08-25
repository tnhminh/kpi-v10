import { describe, expect, it } from "vitest";
import { createJiraConnectionSchema, replaceJiraMappingsSchema } from "./validation";

describe("Jira integration validation", () => {
  it("accepts declarative fact mappings and secret references without secret material", () => {
    const parsed = createJiraConnectionSchema.parse({ workspaceUrl: "https://example.atlassian.net", secretRef: "env:JIRA_BACKEND_CREDENTIALS", syncConfig: { jql: "project = BE", factMappings: { completedOnTime: { type: "DATE_LTE", leftField: "resolutiondate", rightField: "duedate" } } } });
    expect(parsed.secretRef).toBe("env:JIRA_BACKEND_CREDENTIALS");
  });
  it("rejects non-HTTPS workspaces and duplicate member/account mappings", () => {
    expect(createJiraConnectionSchema.safeParse({ workspaceUrl: "http://example.atlassian.net", secretRef: "env:JIRA_X" }).success).toBe(false);
    expect(replaceJiraMappingsSchema.safeParse({ mappings: [{ memberId: "11111111-1111-4111-8111-111111111111", jiraAccountId: "a" }, { memberId: "11111111-1111-4111-8111-111111111111", jiraAccountId: "b" }] }).success).toBe(false);
  });
});
