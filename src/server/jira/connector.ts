import type { JiraRemoteIssue } from "./normalizer";

export class JiraConnectorError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean) { super(message); }
}

export interface JiraSecretResolver {
  resolve(ref: string): Promise<string>;
}

export class EnvironmentJiraSecretResolver implements JiraSecretResolver {
  async resolve(ref: string): Promise<string> {
    if (!ref.startsWith("env:")) throw new JiraConnectorError("UNSUPPORTED_SECRET_REFERENCE", "This runtime currently supports env: Jira secret references only.", false);
    const key = ref.slice(4);
    if (!/^JIRA_[A-Z0-9_]{1,120}$/.test(key)) throw new JiraConnectorError("INVALID_SECRET_REFERENCE", "Jira environment secret references must target a JIRA_* variable.", false);
    const value = process.env[key];
    if (!value) throw new JiraConnectorError("JIRA_SECRET_UNAVAILABLE", "The configured Jira credential reference is unavailable in this runtime.", false);
    return value;
  }
}

export interface JiraConnectorPage { issues: JiraRemoteIssue[]; nextPageToken: string | null; }
export interface JiraConnector {
  fetchIssues(input: { workspaceUrl: string; secretRef: string; jql: string; fields: string[]; nextPageToken?: string | null }): Promise<JiraConnectorPage>;
}

type JiraCloudCredentials = { email: string; apiToken: string };
function parseCredentials(raw: string): JiraCloudCredentials {
  try {
    const value = JSON.parse(raw) as Partial<JiraCloudCredentials>;
    if (typeof value.email !== "string" || !value.email.trim() || typeof value.apiToken !== "string" || !value.apiToken) throw new Error("invalid");
    return { email: value.email.trim(), apiToken: value.apiToken };
  } catch {
    throw new JiraConnectorError("INVALID_JIRA_SECRET", "Jira credential secret must be JSON containing email and apiToken.", false);
  }
}

function asObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function nestedString(value: unknown, key: string): string | null { const object = asObject(value); return typeof object[key] === "string" ? object[key] as string : null; }

export class AtlassianJiraCloudConnector implements JiraConnector {
  constructor(private readonly secrets: JiraSecretResolver = new EnvironmentJiraSecretResolver()) {}

  async fetchIssues(input: { workspaceUrl: string; secretRef: string; jql: string; fields: string[]; nextPageToken?: string | null }): Promise<JiraConnectorPage> {
    const credentials = parseCredentials(await this.secrets.resolve(input.secretRef));
    const base = new URL(input.workspaceUrl);
    if (base.protocol !== "https:") throw new JiraConnectorError("INVALID_JIRA_URL", "Jira Cloud workspace URL must use HTTPS.", false);
    const endpoint = new URL("/rest/api/3/search/jql", base);
    const auth = Buffer.from(`${credentials.email}:${credentials.apiToken}`, "utf8").toString("base64");
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Basic ${auth}` },
        body: JSON.stringify({ jql: input.jql, fields: input.fields, maxResults: 100, ...(input.nextPageToken ? { nextPageToken: input.nextPageToken } : {}) }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new JiraConnectorError("JIRA_NETWORK_ERROR", "Jira could not be reached.", true);
    }
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new JiraConnectorError(`JIRA_HTTP_${response.status}`, `Jira search request failed with HTTP ${response.status}.`, retryable);
    }
    const payload = asObject(await response.json());
    const issues = Array.isArray(payload.issues) ? payload.issues : [];
    return {
      nextPageToken: typeof payload.nextPageToken === "string" && payload.nextPageToken ? payload.nextPageToken : null,
      issues: issues.flatMap((raw) => {
        const object = asObject(raw); const fields = asObject(object.fields); const key = typeof object.key === "string" ? object.key : null;
        if (!key) return [];
        return [{
          issueKey: key,
          summary: typeof fields.summary === "string" ? fields.summary : key,
          updatedAt: typeof fields.updated === "string" ? fields.updated : null,
          assigneeAccountId: nestedString(fields.assignee, "accountId"),
          issueType: nestedString(fields.issuetype, "name"),
          status: nestedString(fields.status, "name"),
          fields,
        } satisfies JiraRemoteIssue];
      }),
    };
  }
}
