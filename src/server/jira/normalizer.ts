import type { JiraFactRule, JiraSyncConfig } from "./validation";

export interface JiraRemoteIssue {
  issueKey: string;
  summary: string;
  updatedAt: string | null;
  assigneeAccountId: string | null;
  issueType: string | null;
  status: string | null;
  fields: Record<string, unknown>;
}

function readPath(input: Record<string, unknown>, path: string): unknown {
  let current: unknown = input;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current ?? null;
}

function finiteDate(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function factValue(rule: JiraFactRule, fields: Record<string, unknown>): number | string | boolean | null {
  switch (rule.type) {
    case "CONSTANT": return rule.value;
    case "EXISTS": return readPath(fields, rule.field) === null ? 0 : 1;
    case "DATE_LTE": {
      const left = finiteDate(readPath(fields, rule.leftField));
      const right = finiteDate(readPath(fields, rule.rightField));
      return left === null || right === null ? null : left <= right ? 1 : 0;
    }
    case "LABEL_PRESENT": {
      const value = readPath(fields, rule.field);
      return Array.isArray(value) ? (value.some((item) => String(item).toLowerCase() === rule.label.toLowerCase()) ? 1 : 0) : null;
    }
    case "STATUS_IN": {
      const value = readPath(fields, rule.field);
      if (typeof value !== "string") return null;
      return rule.values.some((item) => item.toLowerCase() === value.toLowerCase()) ? 1 : 0;
    }
    case "FIELD": {
      const value = readPath(fields, rule.field);
      if (value === null || typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
      return null;
    }
  }
}

function ruleAttribution(rule: JiraFactRule): Record<string, unknown> {
  switch (rule.type) {
    case "CONSTANT": return { transform: rule.type };
    case "DATE_LTE": return { transform: rule.type, fields: [rule.leftField, rule.rightField] };
    case "STATUS_IN": return { transform: rule.type, field: rule.field, values: rule.values };
    case "LABEL_PRESENT": return { transform: rule.type, field: rule.field, label: rule.label };
    default: return { transform: rule.type, field: rule.field };
  }
}

export function normalizeJiraIssue(issue: JiraRemoteIssue, config: JiraSyncConfig) {
  const facts: Record<string, unknown> = {
    issueKey: issue.issueKey,
    issueType: issue.issueType,
    status: issue.status,
    updatedAt: issue.updatedAt,
    assigneeAccountId: issue.assigneeAccountId,
  };
  const attribution: Record<string, unknown> = {
    issueKey: issue.issueKey,
    source: "JIRA",
    mappings: {},
  };
  for (const [key, rule] of Object.entries(config.factMappings)) {
    facts[key] = factValue(rule, issue.fields);
    (attribution.mappings as Record<string, unknown>)[key] = ruleAttribution(rule);
  }
  return { facts, attribution };
}

export function requiredJiraFields(config: JiraSyncConfig): string[] {
  const fields = new Set(["summary", "assignee", "issuetype", "status", "updated", ...config.fields]);
  const addPath = (path: string) => fields.add(path.split(".")[0]!);
  for (const rule of Object.values(config.factMappings)) {
    if (rule.type === "DATE_LTE") { addPath(rule.leftField); addPath(rule.rightField); }
    else if (rule.type !== "CONSTANT") addPath(rule.field);
  }
  return [...fields];
}
