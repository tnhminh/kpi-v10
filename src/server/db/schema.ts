import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const appRole = pgEnum("app_role", ["MEMBER", "TEAM_LEADER", "DEPARTMENT_HEAD", "ADMINISTRATOR"]);
export const lifecycleStatus = pgEnum("lifecycle_status", ["DRAFT", "PUBLISHED", "IN_USE", "RETIRED"]);
export const evaluationMethod = pgEnum("evaluation_method", ["AUTO", "ASSISTED", "MANUAL"]);
export const scoringRuleType = pgEnum("scoring_rule_type", ["THRESHOLD", "RANGE", "FORMULA", "HYBRID"]);
export const periodStatus = pgEnum("period_status", ["UPCOMING", "COLLECTING", "SYSTEM_EVALUATED", "LEADER_REVIEW", "HEAD_REVIEW", "FINALIZED", "LOCKED"]);
export const evaluationStatus = pgEnum("evaluation_status", ["PENDING", "SYSTEM_EVALUATED", "LEADER_REVIEW", "HEAD_REVIEW", "FINALIZED", "LOCKED"]);
export const confidenceLevel = pgEnum("confidence_level", ["HIGH", "MEDIUM", "LOW", "REVIEW_REQUIRED"]);
export const reviewLayer = pgEnum("review_layer", ["LEADER", "DEPARTMENT_HEAD"]);
export const evidenceType = pgEnum("evidence_type", ["JIRA", "MANUAL", "CUSTOM"]);
export const qualitySeverity = pgEnum("quality_severity", ["INFO", "WARNING", "CRITICAL"]);
export const jiraSyncStatus = pgEnum("jira_sync_status", ["RUNNING", "SUCCEEDED", "FAILED"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ...timestamps,
});

export const departments = pgTable("departments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  active: boolean("active").default(true).notNull(),
  ...timestamps,
}, (t) => [
  uniqueIndex("departments_org_code_uq").on(t.organizationId, t.code),
  index("departments_org_idx").on(t.organizationId),
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash"),
  passwordChangeRequired: boolean("password_change_required").default(false).notNull(),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  role: appRole("role").notNull(),
  active: boolean("active").default(true).notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});

export const userOrganizationAccess = pgTable("user_organization_access", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  role: appRole("role").notNull(),
  active: boolean("active").default(true).notNull(),
  ...timestamps,
}, (t) => [
  uniqueIndex("user_organization_access_user_org_uq").on(t.userId, t.organizationId),
  index("user_organization_access_org_idx").on(t.organizationId),
]);

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)]);

export const authLoginAttempts = pgTable("auth_login_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  keyHash: text("key_hash").notNull().unique(),
  failedCount: integer("failed_count").default(0).notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).defaultNow().notNull(),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("auth_login_attempts_blocked_idx").on(t.blockedUntil),
  check("auth_login_attempts_failed_count_nonnegative", sql`${t.failedCount} >= 0`),
]);

export const members = pgTable("members", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  employeeId: text("employee_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  active: boolean("active").default(true).notNull(),
  ...timestamps,
}, (t) => [
  uniqueIndex("members_org_employee_uq").on(t.organizationId, t.employeeId),
  uniqueIndex("members_org_email_uq").on(t.organizationId, t.email),
]);

export const teams = pgTable("teams", {
  id: uuid("id").defaultRandom().primaryKey(),
  departmentId: uuid("department_id").notNull().references(() => departments.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  description: text("description"),
  leaderMemberId: uuid("leader_member_id").references(() => members.id, { onDelete: "set null" }),
  effectiveFrom: date("effective_from").notNull(),
  active: boolean("active").default(true).notNull(),
  ...timestamps,
}, (t) => [uniqueIndex("teams_department_name_uq").on(t.departmentId, t.name), index("teams_department_idx").on(t.departmentId)]);

export const departmentHeadAssignments = pgTable("department_head_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  departmentId: uuid("department_id").notNull().references(() => departments.id, { onDelete: "restrict" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("department_head_assignments_department_user_from_uq").on(t.departmentId, t.userId, t.effectiveFrom),
  index("department_head_assignments_user_period_idx").on(t.userId, t.effectiveFrom, t.effectiveTo),
  index("department_head_assignments_department_idx").on(t.departmentId),
  check("department_head_assignments_valid_range", sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`),
]);

export const teamLeadershipAssignments = pgTable("team_leadership_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
  leaderMemberId: uuid("leader_member_id").notNull().references(() => members.id, { onDelete: "restrict" }),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("team_leadership_team_period_idx").on(t.teamId, t.effectiveFrom, t.effectiveTo),
  check("team_leadership_valid_range", sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`),
]);

export const teamMemberships = pgTable("team_memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "restrict" }),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  primary: boolean("primary").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("team_memberships_member_period_idx").on(t.memberId, t.effectiveFrom, t.effectiveTo),
  index("team_memberships_team_idx").on(t.teamId),
  check("team_memberships_valid_range", sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`),
]);

export const kpiTemplates = pgTable("kpi_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kpiGroup: text("kpi_group"),
  description: text("description"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
}, (t) => [uniqueIndex("kpi_templates_org_name_uq").on(t.organizationId, t.name)]);

export const kpiVersions = pgTable("kpi_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  templateId: uuid("template_id").notNull().references(() => kpiTemplates.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  status: lifecycleStatus("status").default("DRAFT").notNull(),
  totalMaxScore: numeric("total_max_score", { precision: 6, scale: 2 }).default("10").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
}, (t) => [
  uniqueIndex("kpi_versions_template_version_uq").on(t.templateId, t.version),
  check("kpi_versions_total_score_bounds", sql`${t.totalMaxScore} >= 0 and ${t.totalMaxScore} <= 10`),
  check("kpi_versions_positive_version", sql`${t.version} > 0`),
]);

export const metricDefinitions = pgTable("metric_definitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  formulaKind: text("formula_kind").notNull(),
  formula: text("formula"),
  requiredFields: jsonb("required_fields").$type<string[]>().default([]).notNull(),
  supportedIssueTypes: jsonb("supported_issue_types").$type<string[]>().default([]).notNull(),
  dataQualityRequirements: jsonb("data_quality_requirements").$type<Record<string, unknown>>().default({}).notNull(),
  active: boolean("active").default(true).notNull(),
  ...timestamps,
}, (t) => [uniqueIndex("metric_definitions_org_key_uq").on(t.organizationId, t.key)]);

export const criteria = pgTable("criteria", {
  id: uuid("id").defaultRandom().primaryKey(),
  kpiVersionId: uuid("kpi_version_id").notNull().references(() => kpiVersions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  position: integer("position").notNull(),
  maxScore: numeric("max_score", { precision: 6, scale: 2 }).notNull(),
  method: evaluationMethod("method").notNull(),
  evidencePolicy: jsonb("evidence_policy").$type<{ sources: ("JIRA" | "MANUAL" | "CUSTOM")[]; config?: Record<string, unknown> }>().default({ sources: [] }).notNull(),
  reviewRequired: boolean("review_required").default(true).notNull(),
  requiredEvidence: boolean("required_evidence").default(false).notNull(),
  adjustmentPolicy: jsonb("adjustment_policy").$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps,
}, (t) => [
  uniqueIndex("criteria_version_position_uq").on(t.kpiVersionId, t.position),
  check("criteria_max_score_bounds", sql`${t.maxScore} >= 0 and ${t.maxScore} <= 10`),
  check("criteria_nonnegative_position", sql`${t.position} >= 0`),
]);

export const metricConfigurations = pgTable("metric_configurations", {
  id: uuid("id").defaultRandom().primaryKey(),
  criterionId: uuid("criterion_id").notNull().references(() => criteria.id, { onDelete: "cascade" }).unique(),
  metricDefinitionId: uuid("metric_definition_id").notNull().references(() => metricDefinitions.id, { onDelete: "restrict" }),
  parameters: jsonb("parameters").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const scoringRules = pgTable("scoring_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  criterionId: uuid("criterion_id").notNull().references(() => criteria.id, { onDelete: "cascade" }),
  type: scoringRuleType("type").notNull(),
  position: integer("position").default(0).notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("scoring_rules_criterion_position_uq").on(t.criterionId, t.position),
  check("scoring_rules_nonnegative_position", sql`${t.position} >= 0`),
]);

export const rankSchemes = pgTable("rank_schemes", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  active: boolean("active").default(true).notNull(),
  ...timestamps,
}, (t) => [uniqueIndex("rank_schemes_org_name_uq").on(t.organizationId, t.name)]);

export const rankBands = pgTable("rank_bands", {
  id: uuid("id").defaultRandom().primaryKey(),
  rankSchemeId: uuid("rank_scheme_id").notNull().references(() => rankSchemes.id, { onDelete: "cascade" }),
  rank: text("rank").notNull(),
  minScore: numeric("min_score", { precision: 6, scale: 2 }),
  maxScore: numeric("max_score", { precision: 6, scale: 2 }),
  minInclusive: boolean("min_inclusive").default(true).notNull(),
  maxInclusive: boolean("max_inclusive").default(false).notNull(),
  coefficient: numeric("coefficient", { precision: 6, scale: 3 }).notNull(),
  position: integer("position").notNull(),
}, (t) => [
  uniqueIndex("rank_bands_scheme_position_uq").on(t.rankSchemeId, t.position),
  check("rank_bands_valid_range", sql`(${t.minScore} is null or ${t.minScore} >= 0) and (${t.maxScore} is null or ${t.maxScore} <= 10) and (${t.minScore} is null or ${t.maxScore} is null or ${t.minScore} <= ${t.maxScore})`),
]);

export const evaluationPeriods = pgTable("evaluation_periods", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  status: periodStatus("status").default("UPCOMING").notNull(),
  rankSchemeId: uuid("rank_scheme_id").references(() => rankSchemes.id, { onDelete: "restrict" }),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: uuid("locked_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
}, (t) => [
  uniqueIndex("evaluation_periods_org_key_uq").on(t.organizationId, t.key),
  check("evaluation_periods_valid_range", sql`${t.endsOn} >= ${t.startsOn}`),
]);

export const periodKpiAssignments = pgTable("period_kpi_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  periodId: uuid("period_id").notNull().references(() => evaluationPeriods.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
  kpiVersionId: uuid("kpi_version_id").notNull().references(() => kpiVersions.id, { onDelete: "restrict" }),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [uniqueIndex("period_kpi_assignments_period_team_uq").on(t.periodId, t.teamId)]);

export const memberEvaluations = pgTable("member_evaluations", {
  id: uuid("id").defaultRandom().primaryKey(),
  periodId: uuid("period_id").notNull().references(() => evaluationPeriods.id, { onDelete: "restrict" }),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "restrict" }),
  resolvedMembershipId: uuid("resolved_membership_id").references(() => teamMemberships.id, { onDelete: "restrict" }),
  resolvedTeamId: uuid("resolved_team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
  kpiVersionId: uuid("kpi_version_id").notNull().references(() => kpiVersions.id, { onDelete: "restrict" }),
  status: evaluationStatus("status").default("PENDING").notNull(),
  confidence: confidenceLevel("confidence").default("REVIEW_REQUIRED").notNull(),
  systemScore: numeric("system_score", { precision: 6, scale: 2 }),
  leaderScore: numeric("leader_score", { precision: 6, scale: 2 }),
  headScore: numeric("head_score", { precision: 6, scale: 2 }),
  finalScore: numeric("final_score", { precision: 6, scale: 2 }),
  finalRank: text("final_rank"),
  finalCoefficient: numeric("final_coefficient", { precision: 6, scale: 3 }),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  finalizedBy: uuid("finalized_by").references(() => users.id, { onDelete: "set null" }),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("member_evaluations_member_period_uq").on(t.memberId, t.periodId),
  index("member_evaluations_period_status_idx").on(t.periodId, t.status),
  index("member_evaluations_resolved_membership_idx").on(t.resolvedMembershipId),
  check("member_evaluations_score_bounds", sql`(${t.systemScore} is null or (${t.systemScore} >= 0 and ${t.systemScore} <= 10)) and (${t.leaderScore} is null or (${t.leaderScore} >= 0 and ${t.leaderScore} <= 10)) and (${t.headScore} is null or (${t.headScore} >= 0 and ${t.headScore} <= 10)) and (${t.finalScore} is null or (${t.finalScore} >= 0 and ${t.finalScore} <= 10))`),
]);

export const criterionEvaluations = pgTable("criterion_evaluations", {
  id: uuid("id").defaultRandom().primaryKey(),
  memberEvaluationId: uuid("member_evaluation_id").notNull().references(() => memberEvaluations.id, { onDelete: "cascade" }),
  criterionId: uuid("criterion_id").notNull().references(() => criteria.id, { onDelete: "restrict" }),
  metricValue: jsonb("metric_value").$type<Record<string, unknown> | null>(),
  systemScore: numeric("system_score", { precision: 6, scale: 2 }),
  leaderScore: numeric("leader_score", { precision: 6, scale: 2 }),
  headScore: numeric("head_score", { precision: 6, scale: 2 }),
  finalScore: numeric("final_score", { precision: 6, scale: 2 }),
  confidence: confidenceLevel("confidence").default("REVIEW_REQUIRED").notNull(),
  explanationTrace: jsonb("explanation_trace").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("criterion_evaluations_member_criterion_uq").on(t.memberEvaluationId, t.criterionId)]);

export const evidence = pgTable("evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  criterionEvaluationId: uuid("criterion_evaluation_id").notNull().references(() => criterionEvaluations.id, { onDelete: "cascade" }),
  type: evidenceType("type").notNull(),
  sourceRef: text("source_ref"),
  title: text("title").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("evidence_criterion_eval_idx").on(t.criterionEvaluationId)]);

export const jiraConnections = pgTable("jira_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceUrl: text("workspace_url").notNull(),
  secretRef: text("secret_ref").notNull(),
  syncConfig: jsonb("sync_config").$type<{ jql: string; fields: string[]; factMappings: Record<string, Record<string, unknown>> }>().default({ jql: "ORDER BY updated ASC", fields: [], factMappings: {} }).notNull(),
  active: boolean("active").default(true).notNull(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [uniqueIndex("jira_connections_org_url_uq").on(t.organizationId, t.workspaceUrl)]);

export const jiraSyncRuns = pgTable("jira_sync_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  connectionId: uuid("connection_id").notNull().references(() => jiraConnections.id, { onDelete: "cascade" }),
  status: jiraSyncStatus("status").default("RUNNING").notNull(),
  initiatedBy: uuid("initiated_by").references(() => users.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  issuesSeen: integer("issues_seen").default(0).notNull(),
  issuesMapped: integer("issues_mapped").default(0).notNull(),
  issuesUnmapped: integer("issues_unmapped").default(0).notNull(),
  pagesFetched: integer("pages_fetched").default(0).notNull(),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
}, (t) => [
  index("jira_sync_runs_connection_started_idx").on(t.connectionId, t.startedAt),
  check("jira_sync_runs_counts_nonnegative", sql`${t.issuesSeen} >= 0 and ${t.issuesMapped} >= 0 and ${t.issuesUnmapped} >= 0 and ${t.pagesFetched} >= 0`),
]);

export const jiraMemberMappings = pgTable("jira_member_mappings", {
  id: uuid("id").defaultRandom().primaryKey(),
  connectionId: uuid("connection_id").notNull().references(() => jiraConnections.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  jiraAccountId: text("jira_account_id").notNull(),
  jiraDisplayName: text("jira_display_name"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("jira_member_mappings_connection_member_uq").on(t.connectionId, t.memberId),
  uniqueIndex("jira_member_mappings_connection_account_uq").on(t.connectionId, t.jiraAccountId),
]);

export const jiraIssues = pgTable("jira_issues", {
  id: uuid("id").defaultRandom().primaryKey(),
  connectionId: uuid("connection_id").notNull().references(() => jiraConnections.id, { onDelete: "cascade" }),
  issueKey: text("issue_key").notNull(),
  summary: text("summary").notNull(),
  currentPayload: jsonb("current_payload").$type<Record<string, unknown>>().default({}).notNull(),
  jiraUpdatedAt: timestamp("jira_updated_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("jira_issues_connection_key_uq").on(t.connectionId, t.issueKey)]);

export const jiraIssueFacts = pgTable("jira_issue_facts", {
  id: uuid("id").defaultRandom().primaryKey(),
  jiraIssueId: uuid("jira_issue_id").notNull().references(() => jiraIssues.id, { onDelete: "cascade" }).unique(),
  memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
  facts: jsonb("facts").$type<Record<string, unknown>>().default({}).notNull(),
  attribution: jsonb("attribution").$type<Record<string, unknown>>().default({}).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("jira_issue_facts_member_idx").on(t.memberId), index("jira_issue_facts_observed_idx").on(t.observedAt)]);

export const jiraFactSnapshots = pgTable("jira_fact_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  jiraIssueId: uuid("jira_issue_id").notNull().references(() => jiraIssues.id, { onDelete: "restrict" }),
  memberEvaluationId: uuid("member_evaluation_id").notNull().references(() => memberEvaluations.id, { onDelete: "restrict" }),
  facts: jsonb("facts").$type<Record<string, unknown>>().notNull(),
  attribution: jsonb("attribution").$type<Record<string, unknown>>().default({}).notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("jira_fact_snapshots_issue_evaluation_uq").on(t.jiraIssueId, t.memberEvaluationId)]);

export const adjustments = pgTable("adjustments", {
  id: uuid("id").defaultRandom().primaryKey(),
  criterionEvaluationId: uuid("criterion_evaluation_id").notNull().references(() => criterionEvaluations.id, { onDelete: "restrict" }),
  layer: reviewLayer("layer").notNull(),
  previousScore: numeric("previous_score", { precision: 6, scale: 2 }),
  newScore: numeric("new_score", { precision: 6, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [check("adjustments_nonempty_reason", sql`length(trim(${t.reason})) > 0`)]);

export const historicalSnapshots = pgTable("historical_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  memberEvaluationId: uuid("member_evaluation_id").notNull().references(() => memberEvaluations.id, { onDelete: "restrict" }).unique(),
  snapshotVersion: integer("snapshot_version").default(1).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }).defaultNow().notNull(),
  lockedBy: uuid("locked_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  checksum: text("checksum").notNull(),
});

export const dataQualityIssues = pgTable("data_quality_issues", {
  id: uuid("id").defaultRandom().primaryKey(),
  memberEvaluationId: uuid("member_evaluation_id").references(() => memberEvaluations.id, { onDelete: "cascade" }),
  criterionEvaluationId: uuid("criterion_evaluation_id").references(() => criterionEvaluations.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  missingField: text("missing_field"),
  affectedMetric: text("affected_metric"),
  severity: qualitySeverity("severity").notNull(),
  message: text("message").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionDisposition: text("resolution_disposition").$type<"RESOLVED" | "WAIVED" | null>(),
  resolutionReason: text("resolution_reason"),
  resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
  requestId: text("request_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  before: jsonb("before").$type<Record<string, unknown> | null>(),
  after: jsonb("after").$type<Record<string, unknown> | null>(),
  reason: text("reason"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
}, (t) => [
  index("audit_events_org_time_idx").on(t.organizationId, t.occurredAt),
  index("audit_events_entity_idx").on(t.entityType, t.entityId),
  index("audit_events_time_idx").on(t.occurredAt),
]);

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("notifications_user_read_idx").on(t.userId, t.readAt)]);
