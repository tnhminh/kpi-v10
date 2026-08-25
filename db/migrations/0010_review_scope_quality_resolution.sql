-- T07 hardening: explicit Department Head resource scope and auditable quality resolution.

CREATE TABLE IF NOT EXISTS department_head_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT department_head_assignments_valid_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS department_head_assignments_department_user_from_uq
  ON department_head_assignments(department_id, user_id, effective_from);
CREATE INDEX IF NOT EXISTS department_head_assignments_user_period_idx
  ON department_head_assignments(user_id, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS department_head_assignments_department_idx
  ON department_head_assignments(department_id);

ALTER TABLE data_quality_issues
  ADD COLUMN IF NOT EXISTS resolution_disposition text,
  ADD COLUMN IF NOT EXISTS resolution_reason text,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE data_quality_issues
  DROP CONSTRAINT IF EXISTS data_quality_resolution_complete;
ALTER TABLE data_quality_issues
  ADD CONSTRAINT data_quality_resolution_complete CHECK (
    (resolved_at IS NULL AND resolution_disposition IS NULL AND resolution_reason IS NULL AND resolved_by IS NULL)
    OR
    (resolved_at IS NOT NULL
      AND resolution_disposition IN ('RESOLVED', 'WAIVED')
      AND length(trim(resolution_reason)) > 0
      AND resolved_by IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION guard_data_quality_resolution_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.resolved_at IS NOT NULL THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Resolved data-quality issues are immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.resolved_at IS NOT NULL THEN
    IF NEW.resolution_disposition NOT IN ('RESOLVED', 'WAIVED')
       OR NEW.resolution_reason IS NULL
       OR length(trim(NEW.resolution_reason)) = 0
       OR NEW.resolved_by IS NULL THEN
      RAISE EXCEPTION 'Data-quality resolution requires disposition, reason, actor, and timestamp';
    END IF;
  ELSIF NEW.resolution_disposition IS NOT NULL OR NEW.resolution_reason IS NOT NULL OR NEW.resolved_by IS NOT NULL THEN
    RAISE EXCEPTION 'Data-quality resolution metadata requires resolved_at';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS data_quality_resolution_audit_guard ON data_quality_issues;
CREATE TRIGGER data_quality_resolution_audit_guard
BEFORE UPDATE ON data_quality_issues
FOR EACH ROW EXECUTE FUNCTION guard_data_quality_resolution_audit();
