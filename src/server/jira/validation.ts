import { z } from "zod";

const jiraFactRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("FIELD"), field: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal("CONSTANT"), value: z.union([z.number().finite(), z.string().max(1000), z.boolean(), z.null()]) }),
  z.object({ type: z.literal("EXISTS"), field: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal("DATE_LTE"), leftField: z.string().trim().min(1).max(200), rightField: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal("LABEL_PRESENT"), field: z.string().trim().min(1).max(200).default("labels"), label: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal("STATUS_IN"), field: z.string().trim().min(1).max(200).default("status.name"), values: z.array(z.string().trim().min(1).max(200)).min(1).max(100) }),
]);

export const jiraSyncConfigSchema = z.object({
  jql: z.string().trim().min(1).max(4000).default("ORDER BY updated ASC"),
  fields: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  factMappings: z.record(z.string().trim().min(1).max(120), jiraFactRuleSchema).default({}),
});

export const createJiraConnectionSchema = z.object({
  workspaceUrl: z.string().url().max(1000).refine((value) => new URL(value).protocol === "https:", "Jira workspace URL must use HTTPS."),
  secretRef: z.string().trim().min(1).max(500).regex(/^[a-z][a-z0-9-]*:[A-Za-z0-9_./-]+$/, "Secret reference must use scheme:name format."),
  syncConfig: jiraSyncConfigSchema.default({ jql: "ORDER BY updated ASC", fields: [], factMappings: {} }),
});

export const replaceJiraMappingsSchema = z.object({
  mappings: z.array(z.object({
    memberId: z.string().uuid(),
    jiraAccountId: z.string().trim().min(1).max(500),
    jiraDisplayName: z.string().trim().max(500).nullable().optional(),
  })).max(500),
}).superRefine((value, ctx) => {
  const members = new Set<string>();
  const accounts = new Set<string>();
  value.mappings.forEach((mapping, index) => {
    if (members.has(mapping.memberId)) ctx.addIssue({ code: "custom", path: ["mappings", index, "memberId"], message: "Member may be mapped only once per connection." });
    if (accounts.has(mapping.jiraAccountId)) ctx.addIssue({ code: "custom", path: ["mappings", index, "jiraAccountId"], message: "Jira account may be mapped only once per connection." });
    members.add(mapping.memberId);
    accounts.add(mapping.jiraAccountId);
  });
});

export type JiraSyncConfig = z.infer<typeof jiraSyncConfigSchema>;
export type JiraFactRule = z.infer<typeof jiraFactRuleSchema>;
