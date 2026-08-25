import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  adjustments,
  auditEvents,
  criteria,
  evaluationPeriods,
  historicalSnapshots,
  jiraFactSnapshots,
  kpiVersions,
  memberEvaluations,
  teamLeadershipAssignments,
  teamMemberships,
  authLoginAttempts,
  userOrganizationAccess,
} from "./schema";

const migration = fs.readFileSync(path.resolve(process.cwd(), "db/migrations/0001_initial.sql"), "utf8");
const authMigration = fs.readFileSync(path.resolve(process.cwd(), "db/migrations/0002_auth_hardening.sql"), "utf8");
const organizationAccessMigration = fs.readFileSync(path.resolve(process.cwd(), "db/migrations/0003_organization_access.sql"), "utf8");
const kpiConfigurationMigration = fs.readFileSync(path.resolve(process.cwd(), "db/migrations/0004_kpi_configuration_hardening.sql"), "utf8");
const kpiImmutabilityMigration = fs.readFileSync(path.resolve(process.cwd(), "db/migrations/0005_kpi_configuration_immutability.sql"), "utf8");
const evaluationIntegrityMigration = fs.readFileSync(path.resolve(process.cwd(), "db/migrations/0007_evaluation_historical_integrity.sql"), "utf8");
const evaluationFreezeMigration = fs.readFileSync(path.resolve(process.cwd(), "db/migrations/0008_evaluation_resolution_freeze.sql"), "utf8");
const reviewIntegrityMigration = fs.readFileSync(path.resolve(process.cwd(), "db/migrations/0009_review_finalization_lock.sql"), "utf8");
const reviewScopeMigration = fs.readFileSync(path.resolve(process.cwd(), "db/migrations/0010_review_scope_quality_resolution.sql"), "utf8");
const reviewLockMigration = fs.readFileSync(path.resolve(process.cwd(), "db/migrations/0009_review_finalization_lock.sql"), "utf8");
const jiraSyncMigration = fs.readFileSync(path.resolve(process.cwd(), "db/migrations/0011_jira_sync_foundation.sql"), "utf8");
const auditHistoryMigration = fs.readFileSync(path.resolve(process.cwd(), "db/migrations/0012_audit_history_authority.sql"), "utf8");
const auditActorRetentionMigration = fs.readFileSync(path.resolve(process.cwd(), "db/migrations/0013_audit_actor_retention.sql"), "utf8");
const userOnboardingMigration = fs.readFileSync(path.resolve(process.cwd(), "db/migrations/0014_user_onboarding.sql"), "utf8");

describe("production database model", () => {
  it("exports the historical-integrity tables", () => {
    expect([teamMemberships, teamLeadershipAssignments, kpiVersions, evaluationPeriods, memberEvaluations, jiraFactSnapshots, adjustments, historicalSnapshots, auditEvents, criteria]).toHaveLength(10);
  });

  it("migration contains critical versioning and snapshot tables", () => {
    for (const table of [
      "team_memberships",
      "team_leadership_assignments",
      "kpi_versions",
      "member_evaluations",
      "criterion_evaluations",
      "jira_fact_snapshots",
      "historical_snapshots",
      "audit_events",
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
    }
  });

  it("does not convert missing scores to zero defaults", () => {
    expect(migration).not.toMatch(/system_score[^,\n]*DEFAULT\s+0/i);
    expect(migration).not.toMatch(/final_score[^,\n]*DEFAULT\s+0/i);
  });

  it("adds shared authentication throttling and case-insensitive email uniqueness", () => {
    expect(authLoginAttempts).toBeDefined();
    expect(authMigration).toContain("CREATE TABLE auth_login_attempts");
    expect(authMigration).toContain("users_email_lower_uq");
  });

  it("requires explicit user-to-organization access before tenant data is exposed", () => {
    expect(userOrganizationAccess).toBeDefined();
    expect(organizationAccessMigration).toContain("CREATE TABLE user_organization_access");
    expect(organizationAccessMigration).toContain("UNIQUE (user_id, organization_id)");
    expect(organizationAccessMigration).toContain("role app_role NOT NULL");
    expect(organizationAccessMigration).toContain("members_org_email_lower_uq");
    expect(organizationAccessMigration).toContain("teams_department_name_lower_uq");
    expect(organizationAccessMigration).toContain("kpi_templates_org_name_lower_uq");
  });

  it("hardens KPI configuration ordering and case-insensitive identifiers", () => {
    expect(kpiConfigurationMigration).toContain("kpi_versions_positive_version");
    expect(kpiConfigurationMigration).toContain("criteria_nonnegative_position");
    expect(kpiConfigurationMigration).toContain("scoring_rules_nonnegative_position");
    expect(kpiConfigurationMigration).toContain("criteria_version_name_lower_uq");
    expect(kpiConfigurationMigration).toContain("metric_definitions_org_key_lower_uq");
  });

  it("enforces submitted KPI immutability at the PostgreSQL mutation boundary", () => {
    expect(kpiImmutabilityMigration).toContain("assert_kpi_version_configuration_mutable");
    expect(kpiImmutabilityMigration).toContain("criteria_configuration_immutable");
    expect(kpiImmutabilityMigration).toContain("metric_configurations_configuration_immutable");
    expect(kpiImmutabilityMigration).toContain("scoring_rules_configuration_immutable");
    expect(kpiImmutabilityMigration).toContain("kpi_versions_lifecycle_monotonic");
    expect(kpiImmutabilityMigration).toContain("configuration is immutable after submission");
    expect(kpiImmutabilityMigration).toContain("only permit this case for DELETE");
    expect(kpiImmutabilityMigration).toContain("approval requires a submitted DRAFT and an approver");
  });

  it("freezes period assignments at collection start and preserves referenced metric semantics", () => {
    expect(evaluationIntegrityMigration).toContain("period_state <> 'UPCOMING'::period_status");
    expect(evaluationIntegrityMigration).toContain("frozen once collection starts");
    expect(evaluationIntegrityMigration).toContain("metric_definitions_historical_immutable");
    expect(evaluationIntegrityMigration).toContain("kv.submitted_at IS NOT NULL");
    expect(evaluationIntegrityMigration).toContain("Metric definition semantics are immutable once referenced by a submitted KPI version");
    expect(evaluationFreezeMigration).toContain("BEFORE INSERT OR UPDATE OR DELETE ON period_kpi_assignments");
    expect(evaluationFreezeMigration).toContain("old_period_state <> 'UPCOMING'::period_status");
    expect(evaluationFreezeMigration).toContain("Member evaluation requires the exact resolved membership");
  });

  it("enforces audited review layers and finalized/locked immutability", () => {
    expect(reviewLockMigration).toContain("Invalid member evaluation lifecycle transition");
    expect(reviewLockMigration).toContain("Leader score changes require a matching append-only adjustment record");
    expect(reviewLockMigration).toContain("Department Head score changes require a matching append-only adjustment record");
    expect(reviewLockMigration).toContain("Critical data-quality issues must be resolved before finalization");
    expect(reviewLockMigration).toContain("LOCKED transition requires a historical snapshot");
    expect(reviewLockMigration).toContain("Review adjustments are append-only");
    expect(reviewLockMigration).toContain("Historical snapshots are immutable");
    expect(reviewLockMigration).toContain("Evaluation period lifecycle cannot move backwards");
  });

  it("enforces review final-state immutability, Department Head scope, and auditable quality resolution", () => {
    expect(reviewIntegrityMigration).toContain("Finalized or locked member evaluations are immutable");
    expect(reviewIntegrityMigration).toContain("Review adjustments are append-only");
    expect(reviewIntegrityMigration).toContain("Historical snapshots are immutable");
    expect(reviewScopeMigration).toContain("CREATE TABLE IF NOT EXISTS department_head_assignments");
    expect(reviewScopeMigration).toContain("resolution_disposition IN ('RESOLVED', 'WAIVED')");
    expect(reviewScopeMigration).toContain("Resolved data-quality issues are immutable");
  });

  it("separates mutable Jira sync state from immutable evaluation fact snapshots", () => {
    expect(jiraSyncMigration).toContain("CREATE TABLE jira_sync_runs");
    expect(jiraSyncMigration).toContain("CREATE TABLE jira_issue_facts");
    expect(jiraSyncMigration).toContain("jira_sync_runs_one_running_per_connection_uq");
    expect(jiraSyncMigration).toContain("Jira member mapping cannot cross organization boundaries");
    expect(jiraSyncMigration).toContain("Jira issue fact attribution cannot cross organization boundaries");
    expect(jiraSyncMigration).toContain("Jira evaluation fact snapshots are immutable");
  });

  it("makes audit events tenant-scoped and append-only without guessing legacy ownership", () => {
    expect(auditHistoryMigration).toContain("ADD COLUMN IF NOT EXISTS organization_id uuid");
    expect(auditHistoryMigration).toContain("legacy rows without organization_id");
    expect(auditHistoryMigration).toContain("ALTER COLUMN organization_id SET NOT NULL");
    expect(auditHistoryMigration).toContain("audit_events_org_time_idx");
    expect(auditHistoryMigration).toContain("prevent_audit_event_mutation");
    expect(auditHistoryMigration).toContain("audit_events is append-only");
    expect(auditHistoryMigration).toContain("BEFORE UPDATE OR DELETE ON audit_events");
  });

  it("retains audited actors by blocking hard-delete rather than mutating audit rows", () => {
    expect(auditActorRetentionMigration).toContain("audited actors are historical references");
    expect(auditActorRetentionMigration).toContain("DROP CONSTRAINT");
    expect(auditActorRetentionMigration).toContain("audit_events_actor_user_id_fkey");
    expect(auditActorRetentionMigration).toContain("ON DELETE RESTRICT");
  });

  it("supports forced password rotation and one-to-one member identity links", () => {
    expect(userOnboardingMigration).toContain("password_change_required");
    expect(userOnboardingMigration).toContain("password_changed_at");
    expect(userOnboardingMigration).toContain("members_user_id_uq");
    expect(userOnboardingMigration).toContain("WHERE user_id IS NOT NULL");
  });
});
