-- Freeze period KPI resolution as soon as collection starts. A direct database write
-- must not be able to make members in the same period resolve different KPI versions.
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
  IF period_state <> 'UPCOMING'::period_status THEN
    RAISE EXCEPTION 'Period KPI assignments are frozen once collection starts';
  END IF;
  RETURN NEW;
END;
$$;

-- Metric definitions are shared records referenced by versioned KPI configuration.
-- Once any referencing KPI version has been submitted, changing semantic/display fields
-- would rewrite historical evaluation meaning. Only operational activation state and
-- updated_at remain mutable; changed semantics require a new metric definition.
CREATE OR REPLACE FUNCTION guard_referenced_metric_definition_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_by_submitted boolean;
BEGIN
  IF ROW(
    NEW.organization_id,
    NEW.key,
    NEW.name,
    NEW.description,
    NEW.formula_kind,
    NEW.formula,
    NEW.required_fields,
    NEW.supported_issue_types,
    NEW.data_quality_requirements
  ) IS NOT DISTINCT FROM ROW(
    OLD.organization_id,
    OLD.key,
    OLD.name,
    OLD.description,
    OLD.formula_kind,
    OLD.formula,
    OLD.required_fields,
    OLD.supported_issue_types,
    OLD.data_quality_requirements
  ) THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM metric_configurations mc
    JOIN criteria c ON c.id = mc.criterion_id
    JOIN kpi_versions kv ON kv.id = c.kpi_version_id
    WHERE mc.metric_definition_id = OLD.id
      AND kv.submitted_at IS NOT NULL
  ) INTO referenced_by_submitted;

  IF referenced_by_submitted THEN
    RAISE EXCEPTION 'Metric definition semantics are immutable once referenced by a submitted KPI version'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS metric_definitions_historical_immutable ON metric_definitions;
CREATE TRIGGER metric_definitions_historical_immutable
BEFORE UPDATE ON metric_definitions
FOR EACH ROW EXECUTE FUNCTION guard_referenced_metric_definition_mutation();
