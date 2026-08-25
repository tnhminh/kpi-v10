ALTER TABLE member_evaluations
  ADD COLUMN IF NOT EXISTS resolved_membership_id uuid REFERENCES team_memberships(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS member_evaluations_resolved_membership_idx
  ON member_evaluations(resolved_membership_id);

CREATE OR REPLACE FUNCTION enforce_period_kpi_assignment_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  period_org uuid;
  team_org uuid;
  version_org uuid;
  version_status lifecycle_status;
  period_state period_status;
BEGIN
  SELECT organization_id, status INTO period_org, period_state
  FROM evaluation_periods WHERE id = NEW.period_id;

  SELECT d.organization_id INTO team_org
  FROM teams t JOIN departments d ON d.id = t.department_id
  WHERE t.id = NEW.team_id;

  SELECT kt.organization_id, kv.status INTO version_org, version_status
  FROM kpi_versions kv JOIN kpi_templates kt ON kt.id = kv.template_id
  WHERE kv.id = NEW.kpi_version_id;

  IF period_org IS NULL OR team_org IS NULL OR version_org IS NULL THEN
    RAISE EXCEPTION 'Period KPI assignment references an unresolved scope';
  END IF;
  IF period_org <> team_org OR period_org <> version_org THEN
    RAISE EXCEPTION 'Period KPI assignment cannot cross organization boundaries';
  END IF;
  IF version_status NOT IN ('PUBLISHED', 'IN_USE') THEN
    RAISE EXCEPTION 'Period KPI assignment requires a published or in-use KPI version';
  END IF;
  IF period_state NOT IN ('UPCOMING', 'COLLECTING') THEN
    RAISE EXCEPTION 'Period KPI assignments are frozen after system evaluation begins';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS period_kpi_assignment_scope_guard ON period_kpi_assignments;
CREATE TRIGGER period_kpi_assignment_scope_guard
BEFORE INSERT OR UPDATE ON period_kpi_assignments
FOR EACH ROW EXECUTE FUNCTION enforce_period_kpi_assignment_scope();

CREATE OR REPLACE FUNCTION enforce_member_evaluation_resolution_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  period_org uuid;
  member_org uuid;
  team_org uuid;
  version_org uuid;
  membership_member uuid;
  membership_team uuid;
BEGIN
  SELECT organization_id INTO period_org FROM evaluation_periods WHERE id = NEW.period_id;
  SELECT organization_id INTO member_org FROM members WHERE id = NEW.member_id;
  SELECT d.organization_id INTO team_org
  FROM teams t JOIN departments d ON d.id = t.department_id
  WHERE t.id = NEW.resolved_team_id;
  SELECT kt.organization_id INTO version_org
  FROM kpi_versions kv JOIN kpi_templates kt ON kt.id = kv.template_id
  WHERE kv.id = NEW.kpi_version_id;

  IF period_org IS NULL OR member_org IS NULL OR team_org IS NULL OR version_org IS NULL THEN
    RAISE EXCEPTION 'Member evaluation references an unresolved scope';
  END IF;
  IF period_org <> member_org OR period_org <> team_org OR period_org <> version_org THEN
    RAISE EXCEPTION 'Member evaluation cannot cross organization boundaries';
  END IF;

  IF NEW.resolved_membership_id IS NOT NULL THEN
    SELECT member_id, team_id INTO membership_member, membership_team
    FROM team_memberships WHERE id = NEW.resolved_membership_id;
    IF membership_member IS NULL OR membership_member <> NEW.member_id OR membership_team <> NEW.resolved_team_id THEN
      RAISE EXCEPTION 'Resolved membership must match the evaluated member and team';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS member_evaluation_resolution_scope_guard ON member_evaluations;
CREATE TRIGGER member_evaluation_resolution_scope_guard
BEFORE INSERT OR UPDATE OF period_id, member_id, resolved_membership_id, resolved_team_id, kpi_version_id
ON member_evaluations
FOR EACH ROW EXECUTE FUNCTION enforce_member_evaluation_resolution_scope();
