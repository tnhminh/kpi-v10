CREATE OR REPLACE FUNCTION assert_kpi_version_configuration_mutable(target_version_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  current_status lifecycle_status;
  current_submitted_at timestamptz;
BEGIN
  SELECT status, submitted_at
    INTO current_status, current_submitted_at
    FROM kpi_versions
   WHERE id = target_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'KPI version does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF current_status <> 'DRAFT'::lifecycle_status OR current_submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'KPI version configuration is immutable after submission'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION guard_kpi_criteria_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_version_id uuid;
BEGIN
  target_version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.kpi_version_id ELSE NEW.kpi_version_id END;
  PERFORM assert_kpi_version_configuration_mutable(target_version_id);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION guard_kpi_criterion_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_criterion_id uuid;
  target_version_id uuid;
BEGIN
  target_criterion_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.criterion_id ELSE NEW.criterion_id END;
  SELECT kpi_version_id INTO target_version_id FROM criteria WHERE id = target_criterion_id;
  IF target_version_id IS NULL THEN
    -- A guarded criterion DELETE may cascade here after the parent row is no longer visible.
    -- The parent criteria trigger already authorized that delete, so only permit this case for DELETE.
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'KPI criterion does not exist'
      USING ERRCODE = '23503';
  END IF;
  PERFORM assert_kpi_version_configuration_mutable(target_version_id);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION guard_kpi_version_lifecycle_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT'::lifecycle_status OR OLD.submitted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Submitted or published KPI versions cannot be deleted'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'KPI submission timestamp is immutable once set'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.approved_at IS NOT NULL AND NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    RAISE EXCEPTION 'KPI approval timestamp is immutable once set'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'KPI publication timestamp is immutable once set'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
    RAISE EXCEPTION 'KPI retirement timestamp is immutable once set'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.submitted_at IS NULL AND NEW.submitted_at IS NOT NULL AND NEW.status <> 'DRAFT'::lifecycle_status THEN
    RAISE EXCEPTION 'KPI versions must be submitted while in DRAFT status'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.approved_at IS NULL AND NEW.approved_at IS NOT NULL THEN
    IF NEW.status <> 'DRAFT'::lifecycle_status OR NEW.submitted_at IS NULL OR NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'KPI approval requires a submitted DRAFT and an approver'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'DRAFT'::lifecycle_status THEN
      IF NEW.status <> 'PUBLISHED'::lifecycle_status OR NEW.submitted_at IS NULL OR NEW.approved_at IS NULL OR NEW.published_at IS NULL THEN
        RAISE EXCEPTION 'DRAFT KPI versions may transition only to a submitted/approved PUBLISHED state'
          USING ERRCODE = '23514';
      END IF;
    ELSIF OLD.status = 'PUBLISHED'::lifecycle_status THEN
      IF NEW.status NOT IN ('IN_USE'::lifecycle_status, 'RETIRED'::lifecycle_status) THEN
        RAISE EXCEPTION 'PUBLISHED KPI versions may transition only to IN_USE or RETIRED'
          USING ERRCODE = '23514';
      END IF;
    ELSIF OLD.status = 'IN_USE'::lifecycle_status THEN
      IF NEW.status <> 'RETIRED'::lifecycle_status THEN
        RAISE EXCEPTION 'IN_USE KPI versions may transition only to RETIRED'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'RETIRED KPI versions cannot transition to another lifecycle state'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD.status <> 'RETIRED'::lifecycle_status AND NEW.status = 'RETIRED'::lifecycle_status AND NEW.retired_at IS NULL THEN
    RAISE EXCEPTION 'Retiring a KPI version requires retired_at'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER criteria_configuration_immutable
BEFORE INSERT OR UPDATE OR DELETE ON criteria
FOR EACH ROW EXECUTE FUNCTION guard_kpi_criteria_mutation();

CREATE TRIGGER metric_configurations_configuration_immutable
BEFORE INSERT OR UPDATE OR DELETE ON metric_configurations
FOR EACH ROW EXECUTE FUNCTION guard_kpi_criterion_child_mutation();

CREATE TRIGGER scoring_rules_configuration_immutable
BEFORE INSERT OR UPDATE OR DELETE ON scoring_rules
FOR EACH ROW EXECUTE FUNCTION guard_kpi_criterion_child_mutation();

CREATE TRIGGER kpi_versions_lifecycle_monotonic
BEFORE UPDATE OR DELETE ON kpi_versions
FOR EACH ROW EXECUTE FUNCTION guard_kpi_version_lifecycle_mutation();
