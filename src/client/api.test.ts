import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ClientApiError } from "./api";

function success<T>(data: T, status = 200) {
  return new Response(JSON.stringify({ data, requestId: "req-test" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KPI client transport", () => {
  it("loads template versions from the organization-scoped route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success([]));
    vi.stubGlobal("fetch", fetchMock);

    await api.kpi.versions("org-1", "template-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/organizations/org-1/kpi/templates/template-1/versions",
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("patches criterion configuration without client-side authority fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success({ id: "criterion-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.kpi.updateCriterion("org-1", "criterion-1", { maxScore: 2.5, method: "ASSISTED" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ maxScore: 2.5, method: "ASSISTED" });
  });

  it("persists scoring rules and lifecycle actions to their dedicated mutation routes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(success({ id: "version-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.kpi.setCriterionRules("org-1", "criterion-1", [{
      type: "THRESHOLD",
      bands: [{ operator: ">=", value: 80, score: 2 }],
      fallback: null,
    }]);
    await api.kpi.lifecycle("org-1", "version-1", "SUBMIT");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/organizations/org-1/kpi/criteria/criterion-1/rules");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      rules: [{ type: "THRESHOLD", bands: [{ operator: ">=", value: 80, score: 2 }], fallback: null }],
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/organizations/org-1/kpi/versions/version-1/lifecycle");
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({ action: "SUBMIT" });
  });

  it("uses protected evaluation routes without accepting client authority or score fields", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(success({ status: "COLLECTING" }))
      .mockResolvedValueOnce(success({ results: [], progress: { eligibleMembers: 1, evaluatedMembers: 1, completed: true } }))
      .mockResolvedValueOnce(success([]));
    vi.stubGlobal("fetch", fetchMock);

    await api.evaluation.periods("org-1");
    await api.evaluation.replaceAssignments("org-1", "period-1", [{ teamId: "team-1", kpiVersionId: "version-1" }]);
    await api.evaluation.startCollection("org-1", "period-1");
    await api.evaluation.run("org-1", "period-1", [{
      memberId: "member-1",
      criteria: [{
        criterionId: "criterion-1",
        inputFacts: { committed: 10, completedOnTime: 9 },
        metric: { value: 90 },
        confidence: "HIGH",
        evidence: [{ type: "JIRA", title: "Jira evidence", sourceRef: "ABC-1" }],
      }],
    }]);
    await api.evaluation.evaluations("org-1", "period-1");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/organizations/org-1/evaluation/periods");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/organizations/org-1/evaluation/periods/period-1/assignments");
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({ assignments: [{ teamId: "team-1", kpiVersionId: "version-1" }] });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/organizations/org-1/evaluation/periods/period-1/lifecycle");
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({ action: "START_COLLECTION" });
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/api/organizations/org-1/evaluation/periods/period-1/evaluate");
    expect((fetchMock.mock.calls[3]?.[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body))).toEqual({
      members: [{
        memberId: "member-1",
        criteria: [{
          criterionId: "criterion-1",
          inputFacts: { committed: 10, completedOnTime: 9 },
          metric: { value: 90 },
          confidence: "HIGH",
          evidence: [{ type: "JIRA", title: "Jira evidence", sourceRef: "ABC-1" }],
        }],
      }],
    });
    expect(fetchMock.mock.calls[4]?.[0]).toBe("/api/organizations/org-1/evaluation/periods/period-1/evaluations");
  });

  it("uses dedicated persisted review, quality-resolution, finalize and lock routes without authority fields", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(success({ evaluationId: "evaluation-1", layer: "LEADER", score: 8.5, status: "LEADER_REVIEW", periodStatus: "LEADER_REVIEW" }))
      .mockResolvedValueOnce(success({ evaluationId: "evaluation-1", layer: "DEPARTMENT_HEAD", score: 8.7, status: "HEAD_REVIEW", periodStatus: "HEAD_REVIEW" }))
      .mockResolvedValueOnce(success({ id: "issue-1", resolvedAt: "2026-08-25T00:00:00.000Z", resolutionDisposition: "WAIVED", resolutionReason: "Verified source gap.", resolvedBy: "user-1" }))
      .mockResolvedValueOnce(success({ evaluationId: "evaluation-1", status: "FINALIZED", finalScore: 8.7, finalRank: "A", finalCoefficient: 1.2, periodStatus: "FINALIZED" }))
      .mockResolvedValueOnce(success({ evaluationId: "evaluation-1", status: "LOCKED", snapshotId: "snapshot-1", checksum: "a".repeat(64), lockedAt: "2026-08-25T00:00:00.000Z", periodStatus: "LOCKED" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.evaluation.reviewQueue("org-1", "period-1", "LEADER");
    await api.evaluation.completeLeaderReview("org-1", "evaluation-1", [{ criterionEvaluationId: "criterion-evaluation-1", score: 1.5, reason: "Verified manual evidence." }]);
    await api.evaluation.completeHeadReview("org-1", "evaluation-1", []);
    await api.evaluation.resolveQualityIssue("org-1", "issue-1", "WAIVED", "Verified source gap.");
    await api.evaluation.finalize("org-1", "evaluation-1");
    await api.evaluation.lock("org-1", "evaluation-1");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/organizations/org-1/evaluation/periods/period-1/review-queue?layer=LEADER");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/organizations/org-1/evaluation/evaluations/evaluation-1/leader-review");
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({ adjustments: [{ criterionEvaluationId: "criterion-evaluation-1", score: 1.5, reason: "Verified manual evidence." }] });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/organizations/org-1/evaluation/evaluations/evaluation-1/head-review");
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({ adjustments: [] });
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/api/organizations/org-1/evaluation/quality-issues/issue-1/resolve");
    expect((fetchMock.mock.calls[3]?.[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body))).toEqual({ disposition: "WAIVED", reason: "Verified source gap." });
    expect(fetchMock.mock.calls[4]?.[0]).toBe("/api/organizations/org-1/evaluation/evaluations/evaluation-1/finalize");
    expect(JSON.parse(String((fetchMock.mock.calls[4]?.[1] as RequestInit).body))).toEqual({});
    expect(fetchMock.mock.calls[5]?.[0]).toBe("/api/organizations/org-1/evaluation/evaluations/evaluation-1/lock");
    expect(JSON.parse(String((fetchMock.mock.calls[5]?.[1] as RequestInit).body))).toEqual({});
  });

  it("uses protected Jira integration routes and passes only credential references", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(success({ id: "connection-1", workspaceUrl: "https://example.atlassian.net", active: true, lastSyncAt: null, syncConfig: { jql: "project = BE", fields: [], factMappings: {} }, secretConfigured: true, mappingCount: 0, factCount: 0, latestRun: null }))
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(success({ id: "run-1", connectionId: "connection-1", status: "SUCCEEDED", initiatedBy: "user-1", startedAt: "2026-08-25T00:00:00.000Z", completedAt: "2026-08-25T00:00:01.000Z", issuesSeen: 1, issuesMapped: 1, issuesUnmapped: 0, pagesFetched: 1, errorCode: null, errorMessage: null, metadata: {} }))
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(success([]));
    vi.stubGlobal("fetch", fetchMock);

    await api.jira.connections("org-1");
    await api.jira.createConnection("org-1", {
      workspaceUrl: "https://example.atlassian.net",
      secretRef: "env:JIRA_BACKEND_CREDENTIALS",
      syncConfig: { jql: "project = BE", fields: [], factMappings: {} },
    });
    await api.jira.mappings("org-1", "connection-1");
    await api.jira.replaceMappings("org-1", "connection-1", [{ memberId: "member-1", jiraAccountId: "account-1", jiraDisplayName: "User One" }]);
    await api.jira.sync("org-1", "connection-1");
    await api.jira.runs("org-1", "connection-1");
    await api.jira.facts("org-1", "connection-1");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/organizations/org-1/jira/connections");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/organizations/org-1/jira/connections");
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("POST");
    const createBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    expect(createBody).toEqual({
      workspaceUrl: "https://example.atlassian.net",
      secretRef: "env:JIRA_BACKEND_CREDENTIALS",
      syncConfig: { jql: "project = BE", fields: [], factMappings: {} },
    });
    expect(createBody).not.toHaveProperty("apiToken");
    expect(createBody).not.toHaveProperty("password");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/organizations/org-1/jira/connections/connection-1/mappings");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/api/organizations/org-1/jira/connections/connection-1/mappings");
    expect((fetchMock.mock.calls[3]?.[1] as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body))).toEqual({ mappings: [{ memberId: "member-1", jiraAccountId: "account-1", jiraDisplayName: "User One" }] });
    expect(fetchMock.mock.calls[4]?.[0]).toBe("/api/organizations/org-1/jira/connections/connection-1/sync");
    expect((fetchMock.mock.calls[4]?.[1] as RequestInit).method).toBe("POST");
    expect(fetchMock.mock.calls[5]?.[0]).toBe("/api/organizations/org-1/jira/connections/connection-1/runs");
    expect(fetchMock.mock.calls[6]?.[0]).toBe("/api/organizations/org-1/jira/connections/connection-1/facts");
  });

  it("loads tenant-scoped audit history and authoritative historical analytics", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(success({ scope: "ORGANIZATION", summary: { score: 8.5, validCount: 1, totalCount: 2, coverageLabel: "1 / 2 valid evaluations" }, latest: null, rankDistribution: [], series: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await api.audit.list("org-1", 150);
    await api.analytics.history("org-1");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/organizations/org-1/audit?limit=150");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/organizations/org-1/analytics/history");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBeUndefined();
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBeUndefined();
  });

  it("loads rank schemes and persists the selected scheme on evaluation-period creation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(success({ id: "period-1", key: "2026-10", startsOn: "2026-10-01", endsOn: "2026-10-31", status: "UPCOMING", rankSchemeId: "scheme-1", lockedAt: null, createdAt: "2026-08-25T00:00:00.000Z" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.kpi.rankSchemes("org-1");
    await api.evaluation.createPeriod("org-1", { key: "2026-10", startsOn: "2026-10-01", endsOn: "2026-10-31", rankSchemeId: "scheme-1" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/organizations/org-1/kpi/rank-schemes");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/organizations/org-1/evaluation/periods");
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      key: "2026-10",
      startsOn: "2026-10-01",
      endsOn: "2026-10-31",
      rankSchemeId: "scheme-1",
    });
  });

  it("changes the authenticated password without accepting identity fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success({ changed: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.auth.changePassword("temporary-password", "new-secure-password");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/password");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ currentPassword: "temporary-password", newPassword: "new-secure-password" });
  });

  it("provisions organization users with a temporary password through the admin route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success({ userId: "user-1", passwordChangeRequired: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.administration.provisionUser("org-1", {
      email: "member@example.com",
      displayName: "Member One",
      role: "MEMBER",
      temporaryPassword: "temporary-pass-123",
      memberId: "member-1",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/organizations/org-1/administration/users");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ email: "member@example.com", displayName: "Member One", role: "MEMBER", temporaryPassword: "temporary-pass-123", memberId: "member-1" });
  });

  it("uses protected administration routes for Department Head scope without client authority fields", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(success({ id: "assignment-1" }))
      .mockResolvedValueOnce(success({ id: "assignment-1", effectiveTo: "2026-08-25" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.administration.users("org-1");
    await api.administration.departmentHeadAssignments("org-1");
    await api.administration.createDepartmentHeadAssignment("org-1", {
      departmentId: "department-1",
      userId: "user-1",
      effectiveFrom: "2026-08-25",
      effectiveTo: null,
    });
    await api.administration.closeDepartmentHeadAssignment("org-1", "assignment-1", "2026-08-25");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/organizations/org-1/administration/users");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/organizations/org-1/administration/department-head-assignments");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/organizations/org-1/administration/department-head-assignments");
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({ departmentId: "department-1", userId: "user-1", effectiveFrom: "2026-08-25", effectiveTo: null });
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/api/organizations/org-1/administration/department-head-assignments/assignment-1");
    expect((fetchMock.mock.calls[3]?.[1] as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body))).toEqual({ effectiveTo: "2026-08-25" });
  });

  it("surfaces structured API errors with request correlation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "KPI_CONFIGURATION_CONFLICT", message: "Configuration is frozen." },
      requestId: "req-conflict",
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    try {
      await api.kpi.version("org-1", "version-1");
      throw new Error("Expected the API request to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ClientApiError);
      expect(error).toMatchObject({
        status: 409,
        code: "KPI_CONFIGURATION_CONFLICT",
        requestId: "req-conflict",
        message: "Configuration is frozen.",
      });
    }
  });
});
