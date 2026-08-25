import { describe, expect, it, vi } from "vitest";
import { AtlassianJiraCloudConnector, JiraConnectorError, type JiraSecretResolver } from "./connector";

const resolver: JiraSecretResolver = { resolve: vi.fn(async () => JSON.stringify({ email: "jira@example.com", apiToken: "token" })) };

describe("AtlassianJiraCloudConnector", () => {
  it("uses Jira Cloud search/jql and never puts credentials in the URL/body", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ issues: [{ key: "BE-1", fields: { summary: "Ship", updated: "2026-08-25T00:00:00Z", assignee: { accountId: "acct-1" }, issuetype: { name: "Task" }, status: { name: "Done" } } }], nextPageToken: "next" }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const connector = new AtlassianJiraCloudConnector(resolver);
    const result = await connector.fetchIssues({ workspaceUrl: "https://example.atlassian.net", secretRef: "env:JIRA_TEST", jql: "project = BE", fields: ["summary", "updated"] });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://example.atlassian.net/rest/api/3/search/jql");
    expect(String(init?.headers && (init.headers as Record<string, string>).Authorization)).toMatch(/^Basic /);
    expect(String(init?.body)).not.toContain("token");
    expect(result.issues[0]).toMatchObject({ issueKey: "BE-1", assigneeAccountId: "acct-1", status: "Done" });
    expect(result.nextPageToken).toBe("next");
  });

  it("classifies 429 as retryable without exposing Jira response bodies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("sensitive upstream body", { status: 429 })));
    const connector = new AtlassianJiraCloudConnector(resolver);
    await expect(connector.fetchIssues({ workspaceUrl: "https://example.atlassian.net", secretRef: "env:JIRA_TEST", jql: "project = BE", fields: [] })).rejects.toMatchObject({ code: "JIRA_HTTP_429", retryable: true } satisfies Partial<JiraConnectorError>);
  });
});
