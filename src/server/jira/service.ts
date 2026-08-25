import { ApiError } from "@/server/http";
import { AtlassianJiraCloudConnector, JiraConnectorError, type JiraConnector } from "./connector";
import { normalizeJiraIssue, requiredJiraFields } from "./normalizer";
import { activeJiraAccountMapping, completeJiraSyncRun, createJiraSyncRun, getJiraConnection, markJiraConnectionSynced, persistJiraIssues } from "./repository";
import { jiraSyncConfigSchema } from "./validation";

export async function runJiraSync(input: { organizationId: string; connectionId: string; actorUserId: string }, connector: JiraConnector = new AtlassianJiraCloudConnector()) {
  const connection = await getJiraConnection(input.organizationId, input.connectionId);
  if (!connection.active) throw new ApiError(409, "JIRA_CONNECTION_INACTIVE", "Inactive Jira connections cannot sync.");
  const config = jiraSyncConfigSchema.parse(connection.syncConfig);
  const run = await createJiraSyncRun(connection.id, input.actorUserId);
  const accountMapping = await activeJiraAccountMapping(connection.id);
  const counters = { issuesSeen: 0, issuesMapped: 0, issuesUnmapped: 0, pagesFetched: 0 };
  let nextPageToken: string | null = null;
  try {
    do {
      if (counters.pagesFetched >= 100) throw new JiraConnectorError("JIRA_PAGE_LIMIT", "Jira sync exceeded the 100-page safety limit.", false);
      const page = await connector.fetchIssues({ workspaceUrl: connection.workspaceUrl, secretRef: connection.secretRef, jql: config.jql, fields: requiredJiraFields(config), nextPageToken });
      counters.pagesFetched += 1;
      counters.issuesSeen += page.issues.length;
      const normalized = page.issues.map((issue) => {
        const { facts, attribution } = normalizeJiraIssue(issue, config);
        const memberId = issue.assigneeAccountId ? accountMapping.get(issue.assigneeAccountId) ?? null : null;
        return { ...issue, facts, attribution: { ...attribution, mappedMemberId: memberId }, memberId };
      });
      const persisted = await persistJiraIssues(connection.id, normalized);
      counters.issuesMapped += persisted.mapped;
      counters.issuesUnmapped += persisted.unmapped;
      nextPageToken = page.nextPageToken;
    } while (nextPageToken);
    await markJiraConnectionSynced(connection.id);
    return completeJiraSyncRun(run.id, { status: "SUCCEEDED", ...counters, metadata: { retryable: false } });
  } catch (error) {
    const connectorError = error instanceof JiraConnectorError ? error : new JiraConnectorError("JIRA_SYNC_FAILED", "Jira sync failed unexpectedly.", true);
    await completeJiraSyncRun(run.id, { status: "FAILED", ...counters, errorCode: connectorError.code, errorMessage: connectorError.message, metadata: { retryable: connectorError.retryable } });
    throw new ApiError(connectorError.retryable ? 503 : 422, connectorError.code, connectorError.message);
  }
}
