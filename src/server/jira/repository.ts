import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { appendAuditEvent } from "@/server/audit/repository";
import { getDb } from "@/server/db/client";
import { jiraConnections, jiraIssueFacts, jiraIssues, jiraMemberMappings, jiraSyncRuns, members } from "@/server/db/schema";
import { ApiError } from "@/server/http";
import type { JiraRemoteIssue } from "./normalizer";
import type { JiraSyncConfig } from "./validation";

export async function listJiraConnections(organizationId: string) {
  const rows = await getDb().select().from(jiraConnections).where(eq(jiraConnections.organizationId, organizationId)).orderBy(jiraConnections.createdAt);
  const result = [];
  for (const row of rows) {
    const mappings = await getDb().select({ id: jiraMemberMappings.id }).from(jiraMemberMappings).where(and(eq(jiraMemberMappings.connectionId, row.id), eq(jiraMemberMappings.active, true)));
    const facts = await getDb().select({ id: jiraIssueFacts.id }).from(jiraIssueFacts).innerJoin(jiraIssues, eq(jiraIssueFacts.jiraIssueId, jiraIssues.id)).where(eq(jiraIssues.connectionId, row.id));
    const latest = await getDb().select().from(jiraSyncRuns).where(eq(jiraSyncRuns.connectionId, row.id)).orderBy(desc(jiraSyncRuns.startedAt)).limit(1);
    result.push({ id: row.id, workspaceUrl: row.workspaceUrl, active: row.active, lastSyncAt: row.lastSyncAt, syncConfig: row.syncConfig, secretConfigured: Boolean(row.secretRef), mappingCount: mappings.length, factCount: facts.length, latestRun: latest[0] ?? null });
  }
  return result;
}

export async function createJiraConnection(input: { organizationId: string; actorUserId: string; requestId?: string; workspaceUrl: string; secretRef: string; syncConfig: JiraSyncConfig }) {
  try {
    return await getDb().transaction(async (tx) => {
      const rows = await tx.insert(jiraConnections).values({ organizationId: input.organizationId, workspaceUrl: input.workspaceUrl.replace(/\/$/, ""), secretRef: input.secretRef, syncConfig: input.syncConfig }).returning();
      const row = rows[0];
      if (!row) throw new ApiError(500, "CREATE_FAILED", "Jira connection could not be created.");
      await appendAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        action: "JIRA_CONNECTION_CREATED",
        entityType: "jira_connection",
        entityId: row.id,
        after: { workspaceUrl: row.workspaceUrl, active: row.active, syncConfig: row.syncConfig, secretConfigured: Boolean(row.secretRef) },
      });
      return { id: row.id, workspaceUrl: row.workspaceUrl, active: row.active, lastSyncAt: row.lastSyncAt, syncConfig: row.syncConfig, secretConfigured: true, mappingCount: 0, factCount: 0, latestRun: null };
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as { code?: string }).code === "23505") throw new ApiError(409, "JIRA_CONNECTION_EXISTS", "A Jira connection for this workspace already exists in the organization.");
    throw error;
  }
}

export async function getJiraConnection(organizationId: string, connectionId: string) {
  const rows = await getDb().select().from(jiraConnections).where(and(eq(jiraConnections.id, connectionId), eq(jiraConnections.organizationId, organizationId))).limit(1);
  if (!rows[0]) throw new ApiError(404, "JIRA_CONNECTION_NOT_FOUND", "Jira connection was not found in this organization.");
  return rows[0];
}

export async function listJiraMappings(organizationId: string, connectionId: string) {
  await getJiraConnection(organizationId, connectionId);
  return getDb().select({ id: jiraMemberMappings.id, memberId: jiraMemberMappings.memberId, memberName: members.name, employeeId: members.employeeId, jiraAccountId: jiraMemberMappings.jiraAccountId, jiraDisplayName: jiraMemberMappings.jiraDisplayName, active: jiraMemberMappings.active }).from(jiraMemberMappings).innerJoin(members, eq(jiraMemberMappings.memberId, members.id)).where(eq(jiraMemberMappings.connectionId, connectionId)).orderBy(members.name);
}

export async function replaceJiraMappings(input: { organizationId: string; connectionId: string; actorUserId: string; requestId?: string; mappings: Array<{ memberId: string; jiraAccountId: string; jiraDisplayName?: string | null }> }) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.connectionId}))`);
    const connectionRows = await tx.select({ id: jiraConnections.id }).from(jiraConnections).where(and(eq(jiraConnections.id, input.connectionId), eq(jiraConnections.organizationId, input.organizationId))).limit(1);
    if (!connectionRows[0]) throw new ApiError(404, "JIRA_CONNECTION_NOT_FOUND", "Jira connection was not found in this organization.");
    const beforeRows = await tx.select({ memberId: jiraMemberMappings.memberId, jiraAccountId: jiraMemberMappings.jiraAccountId, jiraDisplayName: jiraMemberMappings.jiraDisplayName, active: jiraMemberMappings.active })
      .from(jiraMemberMappings).where(eq(jiraMemberMappings.connectionId, input.connectionId)).orderBy(jiraMemberMappings.memberId);
    const memberIds = [...new Set(input.mappings.map((item) => item.memberId))];
    if (memberIds.length) {
      const valid = await tx.select({ id: members.id }).from(members).where(and(eq(members.organizationId, input.organizationId), inArray(members.id, memberIds)));
      if (valid.length !== memberIds.length) throw new ApiError(422, "INVALID_JIRA_MEMBER_MAPPING", "Every mapped member must belong to this organization.");
    }
    await tx.delete(jiraMemberMappings).where(eq(jiraMemberMappings.connectionId, input.connectionId));
    if (input.mappings.length) await tx.insert(jiraMemberMappings).values(input.mappings.map((item) => ({ connectionId: input.connectionId, memberId: item.memberId, jiraAccountId: item.jiraAccountId, jiraDisplayName: item.jiraDisplayName ?? null, active: true })));
    const afterRows = await tx.select({ id: jiraMemberMappings.id, memberId: jiraMemberMappings.memberId, memberName: members.name, employeeId: members.employeeId, jiraAccountId: jiraMemberMappings.jiraAccountId, jiraDisplayName: jiraMemberMappings.jiraDisplayName, active: jiraMemberMappings.active })
      .from(jiraMemberMappings)
      .innerJoin(members, eq(jiraMemberMappings.memberId, members.id))
      .where(eq(jiraMemberMappings.connectionId, input.connectionId))
      .orderBy(members.name);
    const logicalBefore = beforeRows.map((row) => ({ memberId: row.memberId, jiraAccountId: row.jiraAccountId, jiraDisplayName: row.jiraDisplayName, active: row.active }))
      .sort((a, b) => a.memberId.localeCompare(b.memberId));
    const logicalAfter = afterRows.map((row) => ({ memberId: row.memberId, jiraAccountId: row.jiraAccountId, jiraDisplayName: row.jiraDisplayName, active: row.active }))
      .sort((a, b) => a.memberId.localeCompare(b.memberId));
    await appendAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: "JIRA_MEMBER_MAPPINGS_REPLACED",
      entityType: "jira_connection",
      entityId: input.connectionId,
      before: { count: logicalBefore.length, mappings: logicalBefore },
      after: { count: logicalAfter.length, mappings: logicalAfter },
      metadata: { logicallyIdempotent: JSON.stringify(logicalBefore) === JSON.stringify(logicalAfter) },
    });
    return afterRows;
  });
}

export async function createJiraSyncRun(connectionId: string, initiatedBy: string) {
  try {
    const rows = await getDb().insert(jiraSyncRuns).values({ connectionId, initiatedBy, status: "RUNNING" }).returning();
    return rows[0]!;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new ApiError(409, "JIRA_SYNC_ALREADY_RUNNING", "A Jira sync is already running for this connection.");
    throw error;
  }
}

export async function completeJiraSyncRun(runId: string, input: { status: "SUCCEEDED" | "FAILED"; issuesSeen: number; issuesMapped: number; issuesUnmapped: number; pagesFetched: number; errorCode?: string | null; errorMessage?: string | null; metadata?: Record<string, unknown> }) {
  const rows = await getDb().update(jiraSyncRuns).set({ status: input.status, completedAt: new Date(), issuesSeen: input.issuesSeen, issuesMapped: input.issuesMapped, issuesUnmapped: input.issuesUnmapped, pagesFetched: input.pagesFetched, errorCode: input.status === "FAILED" ? input.errorCode ?? "JIRA_SYNC_FAILED" : null, errorMessage: input.status === "FAILED" ? input.errorMessage ?? "Jira sync failed." : null, metadata: input.metadata ?? {} }).where(eq(jiraSyncRuns.id, runId)).returning();
  return rows[0]!;
}

export async function listJiraSyncRuns(organizationId: string, connectionId: string) {
  await getJiraConnection(organizationId, connectionId);
  return getDb().select().from(jiraSyncRuns).where(eq(jiraSyncRuns.connectionId, connectionId)).orderBy(desc(jiraSyncRuns.startedAt)).limit(25);
}

export async function listJiraFacts(organizationId: string, connectionId: string) {
  await getJiraConnection(organizationId, connectionId);
  return getDb().select({ id: jiraIssueFacts.id, jiraIssueId: jiraIssueFacts.jiraIssueId, issueKey: jiraIssues.issueKey, summary: jiraIssues.summary, memberId: jiraIssueFacts.memberId, memberName: members.name, facts: jiraIssueFacts.facts, attribution: jiraIssueFacts.attribution, observedAt: jiraIssueFacts.observedAt, sourceUpdatedAt: jiraIssueFacts.sourceUpdatedAt }).from(jiraIssueFacts).innerJoin(jiraIssues, eq(jiraIssueFacts.jiraIssueId, jiraIssues.id)).leftJoin(members, eq(jiraIssueFacts.memberId, members.id)).where(eq(jiraIssues.connectionId, connectionId)).orderBy(desc(jiraIssueFacts.sourceUpdatedAt)).limit(500);
}

export async function activeJiraAccountMapping(connectionId: string): Promise<Map<string, string>> {
  const rows = await getDb().select({ accountId: jiraMemberMappings.jiraAccountId, memberId: jiraMemberMappings.memberId }).from(jiraMemberMappings).where(and(eq(jiraMemberMappings.connectionId, connectionId), eq(jiraMemberMappings.active, true)));
  return new Map(rows.map((row) => [row.accountId, row.memberId]));
}

export async function persistJiraIssues(connectionId: string, issues: Array<JiraRemoteIssue & { facts: Record<string, unknown>; attribution: Record<string, unknown>; memberId: string | null }>) {
  let mapped = 0; let unmapped = 0;
  await getDb().transaction(async (tx) => {
    for (const issue of issues) {
      const sourceUpdatedAt = issue.updatedAt && Number.isFinite(Date.parse(issue.updatedAt)) ? new Date(issue.updatedAt) : null;
      const currentPayload = { fields: issue.fields, assigneeAccountId: issue.assigneeAccountId, issueType: issue.issueType, status: issue.status };
      const issueRows = await tx.insert(jiraIssues).values({ connectionId, issueKey: issue.issueKey, summary: issue.summary, currentPayload, jiraUpdatedAt: sourceUpdatedAt, syncedAt: new Date() }).onConflictDoUpdate({ target: [jiraIssues.connectionId, jiraIssues.issueKey], set: { summary: issue.summary, currentPayload, jiraUpdatedAt: sourceUpdatedAt, syncedAt: new Date() } }).returning({ id: jiraIssues.id });
      const jiraIssueId = issueRows[0]!.id;
      await tx.insert(jiraIssueFacts).values({ jiraIssueId, memberId: issue.memberId, facts: issue.facts, attribution: issue.attribution, observedAt: new Date(), sourceUpdatedAt, updatedAt: new Date() }).onConflictDoUpdate({ target: jiraIssueFacts.jiraIssueId, set: { memberId: issue.memberId, facts: issue.facts, attribution: issue.attribution, observedAt: new Date(), sourceUpdatedAt, updatedAt: new Date() } });
      if (issue.memberId) mapped += 1; else unmapped += 1;
    }
  });
  return { mapped, unmapped };
}

export async function markJiraConnectionSynced(connectionId: string) {
  await getDb().update(jiraConnections).set({ lastSyncAt: new Date(), updatedAt: new Date() }).where(eq(jiraConnections.id, connectionId));
}
