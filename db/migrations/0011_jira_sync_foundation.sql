-- T08-A: Jira connector/sync foundation. Mutable current Jira state is separated
-- from immutable evaluation fact snapshots.

CREATE TYPE jira_sync_status AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

ALTER TABLE jira_connections
  ADD COLUMN sync_config jsonb NOT NULL DEFAULT '{"jql":"ORDER BY updated ASC","fields":[],"factMappings":{}}'::jsonb;

CREATE TABLE jira_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES jira_connections(id) ON DELETE CASCADE,
  status jira_sync_status NOT NULL DEFAULT 'RUNNING',
  initiated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  issues_seen integer NOT NULL DEFAULT 0 CHECK (issues_seen >= 0),
  issues_mapped integer NOT NULL DEFAULT 0 CHECK (issues_mapped >= 0),
  issues_unmapped integer NOT NULL DEFAULT 0 CHECK (issues_unmapped >= 0),
  pages_fetched integer NOT NULL DEFAULT 0 CHECK (pages_fetched >= 0),
  error_code text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT jira_sync_runs_completion_consistency CHECK (
    (status = 'RUNNING' AND completed_at IS NULL AND error_code IS NULL AND error_message IS NULL)
    OR
    (status = 'SUCCEEDED' AND completed_at IS NOT NULL AND error_code IS NULL AND error_message IS NULL)
    OR
    (status = 'FAILED' AND completed_at IS NOT NULL AND error_code IS NOT NULL AND error_message IS NOT NULL)
  )
);
CREATE INDEX jira_sync_runs_connection_started_idx ON jira_sync_runs(connection_id, started_at DESC);
CREATE UNIQUE INDEX jira_sync_runs_one_running_per_connection_uq
  ON jira_sync_runs(connection_id) WHERE status = 'RUNNING';

CREATE TABLE jira_issue_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jira_issue_id uuid NOT NULL UNIQUE REFERENCES jira_issues(id) ON DELETE CASCADE,
  member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now(),
  source_updated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jira_issue_facts_member_idx ON jira_issue_facts(member_id);
CREATE INDEX jira_issue_facts_observed_idx ON jira_issue_facts(observed_at DESC);

CREATE OR REPLACE FUNCTION enforce_jira_member_mapping_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE connection_org uuid; member_org uuid;
BEGIN
  SELECT organization_id INTO connection_org FROM jira_connections WHERE id = NEW.connection_id;
  SELECT organization_id INTO member_org FROM members WHERE id = NEW.member_id;
  IF connection_org IS NULL OR member_org IS NULL OR connection_org <> member_org THEN
    RAISE EXCEPTION 'Jira member mapping cannot cross organization boundaries';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS jira_member_mapping_scope_guard ON jira_member_mappings;
CREATE TRIGGER jira_member_mapping_scope_guard
BEFORE INSERT OR UPDATE ON jira_member_mappings
FOR EACH ROW EXECUTE FUNCTION enforce_jira_member_mapping_scope();

CREATE OR REPLACE FUNCTION enforce_jira_issue_fact_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE connection_org uuid; member_org uuid;
BEGIN
  IF NEW.member_id IS NULL THEN RETURN NEW; END IF;
  SELECT jc.organization_id INTO connection_org
  FROM jira_issues ji JOIN jira_connections jc ON jc.id = ji.connection_id
  WHERE ji.id = NEW.jira_issue_id;
  SELECT organization_id INTO member_org FROM members WHERE id = NEW.member_id;
  IF connection_org IS NULL OR member_org IS NULL OR connection_org <> member_org THEN
    RAISE EXCEPTION 'Jira issue fact attribution cannot cross organization boundaries';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS jira_issue_fact_scope_guard ON jira_issue_facts;
CREATE TRIGGER jira_issue_fact_scope_guard
BEFORE INSERT OR UPDATE ON jira_issue_facts
FOR EACH ROW EXECUTE FUNCTION enforce_jira_issue_fact_scope();

CREATE OR REPLACE FUNCTION guard_jira_fact_snapshot_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE issue_org uuid; evaluation_org uuid;
BEGIN
  SELECT jc.organization_id INTO issue_org
  FROM jira_issues ji JOIN jira_connections jc ON jc.id = ji.connection_id
  WHERE ji.id = NEW.jira_issue_id;
  SELECT ep.organization_id INTO evaluation_org
  FROM member_evaluations me JOIN evaluation_periods ep ON ep.id = me.period_id
  WHERE me.id = NEW.member_evaluation_id;
  IF issue_org IS NULL OR evaluation_org IS NULL OR issue_org <> evaluation_org THEN
    RAISE EXCEPTION 'Jira fact snapshot cannot cross organization boundaries';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS jira_fact_snapshot_scope_guard ON jira_fact_snapshots;
CREATE TRIGGER jira_fact_snapshot_scope_guard
BEFORE INSERT ON jira_fact_snapshots
FOR EACH ROW EXECUTE FUNCTION guard_jira_fact_snapshot_insert();

CREATE OR REPLACE FUNCTION prevent_jira_fact_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Jira evaluation fact snapshots are immutable';
END;
$$;
DROP TRIGGER IF EXISTS jira_fact_snapshot_immutable_guard ON jira_fact_snapshots;
CREATE TRIGGER jira_fact_snapshot_immutable_guard
BEFORE UPDATE OR DELETE ON jira_fact_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_jira_fact_snapshot_mutation();
