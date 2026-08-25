-- Make period KPI assignments immutable for every mutation shape once collection starts.
-- INSERT checks NEW, DELETE checks OLD, and UPDATE freezes both the source and target periods
-- so a row cannot be moved out of an already-started period.
CREATE OR REPLACE FUNCTION enforce_period_kpi_assignment_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_period_id uuid;
  target_team_id uuid;
  target_version_id uuid;
  old_period_state period_status;
  period_org uuid;
  team_org uuid;
  version_org uuid;
  version_status lifecycle_status;
  period_state period_status;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO old_period_state FROM evaluation_periods WHERE id = OLD.period_id;
    IF old_period_state IS NULL THEN
      RAISE EXCEPTION 'Period KPI assignment references an unresolved source period';
    END IF;
    IF old_period_state <> 'UPCOMING'::period_status THEN
      RAISE EXCEPTION 'Period KPI assignments are frozen once collection starts';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  target_period_id := NEW.period_id;
  target_team_id := NEW.team_id;
  target_version_id := NEW.kpi_version_id;

  SELECT organization_id, status INTO period_org, period_state
  FROM evaluation_periods WHERE id = target_period_id;

  SELECT d.organization_id INTO team_org
  FROM teams t JOIN departments d ON d.id = t.department_id
  WHERE t.id = target_team_id;

  SELECT kt.organization_id, kv.status INTO version_org, version_status
  FROM kpi_versions kv JOIN kpi_templates kt ON kt.id = kv.template_id
  WHERE kv.id = target_version_id;

  IF period_org IS NULL OR team_org IS NULL OR version_org IS NULL THEN
    RAISE EXCEPTION 'Period KPI assignment references an unresolved scope';
  END IF;
  IF period_org <> team_org OR period_org <> version_org THEN
    RAISE EXCEPTION 'Period KPI assignment cannot cross organization boundaries';
  END IF;
  IF version_status NOT IN ('PUBLISHED', 'IN_USE') THEN
    RAISE EXCEPTION 'Period KPI assignment requires a published or in-use KPI version';
  END IF;
  IF period_state <> 'UPCOMING'::period_status THEN
    RAISE EXCEPTION 'Period KPI assignments are frozen once collection starts';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS period_kpi_assignment_scope_guard ON period_kpi_assignments;
CREATE TRIGGER period_kpi_assignment_scope_guard
BEFORE INSERT OR UPDATE OR DELETE ON period_kpi_assignments
FOR EACH ROW EXECUTE FUNCTION enforce_period_kpi_assignment_scope();

-- A persisted evaluation must retain the exact effective membership that justified
-- its team resolution. Existing legacy rows may remain nullable, but every new or
-- touched evaluation is required to carry the resolved membership id.
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
  IF NEW.resolved_membership_id IS NULL THEN
    RAISE EXCEPTION 'Member evaluation requires the exact resolved membership';
  END IF;

  SELECT member_id, team_id INTO membership_member, membership_team
  FROM team_memberships WHERE id = NEW.resolved_membership_id;
  IF membership_member IS NULL OR membership_member <> NEW.member_id OR membership_team <> NEW.resolved_team_id THEN
    RAISE EXCEPTION 'Resolved membership must match the evaluated member and team';
  END IF;
  RETURN NEW;
END;
$$;
