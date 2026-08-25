CREATE TYPE app_role AS ENUM ('MEMBER','TEAM_LEADER','DEPARTMENT_HEAD','ADMINISTRATOR');
CREATE TYPE lifecycle_status AS ENUM ('DRAFT','PUBLISHED','IN_USE','RETIRED');
CREATE TYPE evaluation_method AS ENUM ('AUTO','ASSISTED','MANUAL');
CREATE TYPE scoring_rule_type AS ENUM ('THRESHOLD','RANGE','FORMULA','HYBRID');
CREATE TYPE period_status AS ENUM ('UPCOMING','COLLECTING','SYSTEM_EVALUATED','LEADER_REVIEW','HEAD_REVIEW','FINALIZED','LOCKED');
CREATE TYPE evaluation_status AS ENUM ('PENDING','SYSTEM_EVALUATED','LEADER_REVIEW','HEAD_REVIEW','FINALIZED','LOCKED');
CREATE TYPE confidence_level AS ENUM ('HIGH','MEDIUM','LOW','REVIEW_REQUIRED');
CREATE TYPE review_layer AS ENUM ('LEADER','DEPARTMENT_HEAD');
CREATE TYPE evidence_type AS ENUM ('JIRA','MANUAL','CUSTOM');
CREATE TYPE quality_severity AS ENUM ('INFO','WARNING','CRITICAL');

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, code text NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT departments_org_code_uq UNIQUE (organization_id, code)
);
CREATE INDEX departments_org_idx ON departments(organization_id);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, display_name text NOT NULL,
  password_hash text, role app_role NOT NULL, active boolean NOT NULL DEFAULT true, last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE INDEX sessions_user_idx ON sessions(user_id); CREATE INDEX sessions_expires_idx ON sessions(expires_at);
CREATE TABLE members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL, employee_id text NOT NULL, name text NOT NULL, email text NOT NULL,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT members_org_employee_uq UNIQUE (organization_id, employee_id), CONSTRAINT members_org_email_uq UNIQUE (organization_id, email)
);
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), department_id uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  name text NOT NULL, description text, leader_member_id uuid REFERENCES members(id) ON DELETE SET NULL, effective_from date NOT NULL,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teams_department_name_uq UNIQUE (department_id, name)
);
CREATE INDEX teams_department_idx ON teams(department_id);
CREATE TABLE team_leadership_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  leader_member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT, effective_from date NOT NULL, effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT team_leadership_valid_range CHECK(effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX team_leadership_team_period_idx ON team_leadership_assignments(team_id,effective_from,effective_to);
CREATE TABLE team_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT, effective_from date NOT NULL, effective_to date,
  "primary" boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_memberships_valid_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX team_memberships_member_period_idx ON team_memberships(member_id,effective_from,effective_to);
CREATE INDEX team_memberships_team_idx ON team_memberships(team_id);
CREATE TABLE kpi_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, kpi_group text, description text, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kpi_templates_org_name_uq UNIQUE (organization_id,name)
);
CREATE TABLE kpi_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_id uuid NOT NULL REFERENCES kpi_templates(id) ON DELETE CASCADE,
  version integer NOT NULL, status lifecycle_status NOT NULL DEFAULT 'DRAFT', total_max_score numeric(6,2) NOT NULL DEFAULT 10,
  submitted_at timestamptz, approved_at timestamptz, published_at timestamptz, retired_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kpi_versions_template_version_uq UNIQUE(template_id,version),
  CONSTRAINT kpi_versions_total_score_bounds CHECK(total_max_score >= 0 AND total_max_score <= 10)
);
CREATE TABLE metric_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL, name text NOT NULL, description text, formula_kind text NOT NULL, formula text,
  required_fields jsonb NOT NULL DEFAULT '[]', supported_issue_types jsonb NOT NULL DEFAULT '[]', data_quality_requirements jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT metric_definitions_org_key_uq UNIQUE(organization_id,key)
);
CREATE TABLE criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kpi_version_id uuid NOT NULL REFERENCES kpi_versions(id) ON DELETE CASCADE,
  name text NOT NULL, description text, position integer NOT NULL, max_score numeric(6,2) NOT NULL, method evaluation_method NOT NULL,
  evidence_policy jsonb NOT NULL DEFAULT '{"sources":[]}', review_required boolean NOT NULL DEFAULT true, required_evidence boolean NOT NULL DEFAULT false,
  adjustment_policy jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT criteria_version_position_uq UNIQUE(kpi_version_id,position), CONSTRAINT criteria_max_score_bounds CHECK(max_score >= 0 AND max_score <= 10)
);
CREATE TABLE metric_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), criterion_id uuid NOT NULL UNIQUE REFERENCES criteria(id) ON DELETE CASCADE,
  metric_definition_id uuid NOT NULL REFERENCES metric_definitions(id) ON DELETE RESTRICT, parameters jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE scoring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), criterion_id uuid NOT NULL REFERENCES criteria(id) ON DELETE CASCADE,
  type scoring_rule_type NOT NULL, position integer NOT NULL DEFAULT 0, config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scoring_rules_criterion_position_uq UNIQUE(criterion_id,position)
);
CREATE TABLE rank_schemes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rank_schemes_org_name_uq UNIQUE(organization_id,name)
);
CREATE TABLE rank_bands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rank_scheme_id uuid NOT NULL REFERENCES rank_schemes(id) ON DELETE CASCADE,
  rank text NOT NULL, min_score numeric(6,2), max_score numeric(6,2), min_inclusive boolean NOT NULL DEFAULT true,
  max_inclusive boolean NOT NULL DEFAULT false, coefficient numeric(6,3) NOT NULL, position integer NOT NULL,
  CONSTRAINT rank_bands_scheme_position_uq UNIQUE(rank_scheme_id,position),
  CONSTRAINT rank_bands_valid_range CHECK((min_score IS NULL OR min_score >= 0) AND (max_score IS NULL OR max_score <= 10) AND (min_score IS NULL OR max_score IS NULL OR min_score <= max_score))
);
CREATE TABLE evaluation_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL, status period_status NOT NULL DEFAULT 'UPCOMING',
  rank_scheme_id uuid REFERENCES rank_schemes(id) ON DELETE RESTRICT, locked_at timestamptz, locked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evaluation_periods_org_key_uq UNIQUE(organization_id,key), CONSTRAINT evaluation_periods_valid_range CHECK(ends_on >= starts_on)
);
CREATE TABLE period_kpi_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_id uuid NOT NULL REFERENCES evaluation_periods(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT, kpi_version_id uuid NOT NULL REFERENCES kpi_versions(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(), assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT period_kpi_assignments_period_team_uq UNIQUE(period_id,team_id)
);
CREATE TABLE member_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_id uuid NOT NULL REFERENCES evaluation_periods(id) ON DELETE RESTRICT,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT, resolved_team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  kpi_version_id uuid NOT NULL REFERENCES kpi_versions(id) ON DELETE RESTRICT, status evaluation_status NOT NULL DEFAULT 'PENDING',
  confidence confidence_level NOT NULL DEFAULT 'REVIEW_REQUIRED', system_score numeric(6,2), leader_score numeric(6,2), head_score numeric(6,2), final_score numeric(6,2),
  final_rank text, final_coefficient numeric(6,3), finalized_at timestamptz, finalized_by uuid REFERENCES users(id) ON DELETE SET NULL, locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_evaluations_member_period_uq UNIQUE(member_id,period_id),
  CONSTRAINT member_evaluations_score_bounds CHECK((system_score IS NULL OR system_score BETWEEN 0 AND 10) AND (leader_score IS NULL OR leader_score BETWEEN 0 AND 10) AND (head_score IS NULL OR head_score BETWEEN 0 AND 10) AND (final_score IS NULL OR final_score BETWEEN 0 AND 10))
);
CREATE INDEX member_evaluations_period_status_idx ON member_evaluations(period_id,status);
CREATE TABLE criterion_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_evaluation_id uuid NOT NULL REFERENCES member_evaluations(id) ON DELETE CASCADE,
  criterion_id uuid NOT NULL REFERENCES criteria(id) ON DELETE RESTRICT, metric_value jsonb, system_score numeric(6,2), leader_score numeric(6,2), head_score numeric(6,2), final_score numeric(6,2),
  confidence confidence_level NOT NULL DEFAULT 'REVIEW_REQUIRED', explanation_trace jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT criterion_evaluations_member_criterion_uq UNIQUE(member_evaluation_id,criterion_id)
);
CREATE TABLE evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), criterion_evaluation_id uuid NOT NULL REFERENCES criterion_evaluations(id) ON DELETE CASCADE,
  type evidence_type NOT NULL, source_ref text, title text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_criterion_eval_idx ON evidence(criterion_evaluation_id);
CREATE TABLE jira_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_url text NOT NULL, secret_ref text NOT NULL, active boolean NOT NULL DEFAULT true, last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT jira_connections_org_url_uq UNIQUE(organization_id,workspace_url)
);
CREATE TABLE jira_member_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connection_id uuid NOT NULL REFERENCES jira_connections(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE, jira_account_id text NOT NULL, jira_display_name text, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jira_member_mappings_connection_member_uq UNIQUE(connection_id,member_id), CONSTRAINT jira_member_mappings_connection_account_uq UNIQUE(connection_id,jira_account_id)
);
CREATE TABLE jira_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connection_id uuid NOT NULL REFERENCES jira_connections(id) ON DELETE CASCADE,
  issue_key text NOT NULL, summary text NOT NULL, current_payload jsonb NOT NULL DEFAULT '{}', jira_updated_at timestamptz, synced_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jira_issues_connection_key_uq UNIQUE(connection_id,issue_key)
);
CREATE TABLE jira_fact_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), jira_issue_id uuid NOT NULL REFERENCES jira_issues(id) ON DELETE RESTRICT,
  member_evaluation_id uuid NOT NULL REFERENCES member_evaluations(id) ON DELETE RESTRICT, facts jsonb NOT NULL, attribution jsonb NOT NULL DEFAULT '{}', captured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jira_fact_snapshots_issue_evaluation_uq UNIQUE(jira_issue_id,member_evaluation_id)
);
CREATE TABLE adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), criterion_evaluation_id uuid NOT NULL REFERENCES criterion_evaluations(id) ON DELETE RESTRICT,
  layer review_layer NOT NULL, previous_score numeric(6,2), new_score numeric(6,2) NOT NULL, reason text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adjustments_nonempty_reason CHECK(length(trim(reason)) > 0)
);
CREATE TABLE historical_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_evaluation_id uuid NOT NULL UNIQUE REFERENCES member_evaluations(id) ON DELETE RESTRICT,
  snapshot_version integer NOT NULL DEFAULT 1, payload jsonb NOT NULL, locked_at timestamptz NOT NULL DEFAULT now(),
  locked_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, checksum text NOT NULL
);
CREATE TABLE data_quality_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_evaluation_id uuid REFERENCES member_evaluations(id) ON DELETE CASCADE,
  criterion_evaluation_id uuid REFERENCES criterion_evaluations(id) ON DELETE CASCADE, code text NOT NULL, missing_field text, affected_metric text,
  severity quality_severity NOT NULL, message text NOT NULL, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), occurred_at timestamptz NOT NULL DEFAULT now(), actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  request_id text, action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, before jsonb, after jsonb, reason text, metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_events_entity_idx ON audit_events(entity_type,entity_id); CREATE INDEX audit_events_time_idx ON audit_events(occurred_at);
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, type text NOT NULL, title text NOT NULL,
  body text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_read_idx ON notifications(user_id,read_at);
