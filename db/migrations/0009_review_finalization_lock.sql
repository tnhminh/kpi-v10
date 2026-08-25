-- T07: human review/finalization/lock persistence integrity.
-- Application services serialize transitions, but PostgreSQL remains the final guard
-- against skipped lifecycle stages, unaudited score changes, and history rewrites.

CREATE OR REPLACE FUNCTION guard_member_evaluation_final_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  criterion_count integer;
  scored_count integer;
  score_sum numeric;
  unresolved_critical integer;
  snapshot_exists boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('FINALIZED', 'LOCKED') THEN
      RAISE EXCEPTION 'Finalized or locked member evaluations are immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'LOCKED' THEN
    RAISE EXCEPTION 'Locked member evaluations are immutable';
  END IF;
  IF OLD.status = 'FINALIZED' AND NEW.status = 'FINALIZED' THEN
    RAISE EXCEPTION 'Finalized member evaluations are immutable until the explicit LOCKED transition';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'PENDING' AND NEW.status = 'SYSTEM_EVALUATED') OR
      (OLD.status = 'SYSTEM_EVALUATED' AND NEW.status = 'LEADER_REVIEW') OR
      (OLD.status = 'LEADER_REVIEW' AND NEW.status = 'HEAD_REVIEW') OR
      (OLD.status = 'HEAD_REVIEW' AND NEW.status = 'FINALIZED') OR
      (OLD.status = 'FINALIZED' AND NEW.status = 'LOCKED')
    ) THEN
      RAISE EXCEPTION 'Invalid member evaluation lifecycle transition: % -> %', OLD.status, NEW.status;
    END IF;
  END IF;

  IF NEW.status = 'LEADER_REVIEW' AND OLD.status = 'SYSTEM_EVALUATED' THEN
    SELECT count(*), count(leader_score), coalesce(sum(leader_score), 0)
      INTO criterion_count, scored_count, score_sum
    FROM criterion_evaluations WHERE member_evaluation_id = OLD.id;
    IF criterion_count = 0 OR scored_count <> criterion_count OR NEW.leader_score IS NULL OR abs(score_sum - NEW.leader_score) > 0.000001 THEN
      RAISE EXCEPTION 'Leader review requires complete criterion leader scores matching the member aggregate';
    END IF;
  END IF;

  IF NEW.status = 'HEAD_REVIEW' AND OLD.status = 'LEADER_REVIEW' THEN
    SELECT count(*), count(head_score), coalesce(sum(head_score), 0)
      INTO criterion_count, scored_count, score_sum
    FROM criterion_evaluations WHERE member_evaluation_id = OLD.id;
    IF criterion_count = 0 OR scored_count <> criterion_count OR NEW.head_score IS NULL OR abs(score_sum - NEW.head_score) > 0.000001 THEN
      RAISE EXCEPTION 'Department Head review requires complete criterion head scores matching the member aggregate';
    END IF;
  END IF;

  IF NEW.status = 'FINALIZED' AND OLD.status = 'HEAD_REVIEW' THEN
    SELECT count(*), count(final_score), coalesce(sum(final_score), 0)
      INTO criterion_count, scored_count, score_sum
    FROM criterion_evaluations WHERE member_evaluation_id = OLD.id;
    SELECT count(*) INTO unresolved_critical
    FROM data_quality_issues
    WHERE member_evaluation_id = OLD.id AND severity = 'CRITICAL' AND resolved_at IS NULL;
    IF criterion_count = 0 OR scored_count <> criterion_count OR NEW.final_score IS NULL OR abs(score_sum - NEW.final_score) > 0.000001 THEN
      RAISE EXCEPTION 'Finalization requires complete criterion final scores matching the member aggregate';
    END IF;
    IF unresolved_critical > 0 THEN
      RAISE EXCEPTION 'Critical data-quality issues must be resolved before finalization';
    END IF;
    IF NEW.finalized_at IS NULL OR NEW.finalized_by IS NULL THEN
      RAISE EXCEPTION 'Finalization requires finalized_at and finalized_by';
    END IF;
  END IF;

  IF OLD.status = 'FINALIZED' AND NEW.status = 'LOCKED' THEN
    IF ROW(
      NEW.period_id,
      NEW.member_id,
      NEW.resolved_membership_id,
      NEW.resolved_team_id,
      NEW.kpi_version_id,
      NEW.confidence,
      NEW.system_score,
      NEW.leader_score,
      NEW.head_score,
      NEW.final_score,
      NEW.final_rank,
      NEW.final_coefficient,
      NEW.finalized_at,
      NEW.finalized_by
    ) IS DISTINCT FROM ROW(
      OLD.period_id,
      OLD.member_id,
      OLD.resolved_membership_id,
      OLD.resolved_team_id,
      OLD.kpi_version_id,
      OLD.confidence,
      OLD.system_score,
      OLD.leader_score,
      OLD.head_score,
      OLD.final_score,
      OLD.final_rank,
      OLD.final_coefficient,
      OLD.finalized_at,
      OLD.finalized_by
    ) THEN
      RAISE EXCEPTION 'Finalized evaluation outcome cannot change while locking';
    END IF;
    SELECT EXISTS (SELECT 1 FROM historical_snapshots WHERE member_evaluation_id = OLD.id) INTO snapshot_exists;
    IF NOT snapshot_exists THEN
      RAISE EXCEPTION 'LOCKED transition requires a historical snapshot';
    END IF;
    IF OLD.locked_at IS NOT NULL OR NEW.locked_at IS NULL THEN
      RAISE EXCEPTION 'LOCKED transition requires a new locked_at timestamp';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS member_evaluation_final_state_guard ON member_evaluations;
CREATE TRIGGER member_evaluation_final_state_guard
BEFORE UPDATE OR DELETE ON member_evaluations
FOR EACH ROW EXECUTE FUNCTION guard_member_evaluation_final_state();

CREATE OR REPLACE FUNCTION guard_criterion_evaluation_final_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evaluation_id uuid;
  evaluation_state evaluation_status;
  audit_exists boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.member_evaluation_id <> OLD.member_evaluation_id OR NEW.criterion_id <> OLD.criterion_id) THEN
    RAISE EXCEPTION 'Criterion evaluation identity is immutable';
  END IF;
  evaluation_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.member_evaluation_id ELSE NEW.member_evaluation_id END;
  SELECT status INTO evaluation_state FROM member_evaluations WHERE id = evaluation_id;
  IF evaluation_state IN ('FINALIZED', 'LOCKED') THEN
    RAISE EXCEPTION 'Criterion evaluations are immutable after member finalization';
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF OLD.leader_score IS NOT NULL AND NEW.leader_score IS DISTINCT FROM OLD.leader_score THEN
    RAISE EXCEPTION 'Completed Leader criterion scores cannot be rewritten';
  END IF;
  IF OLD.head_score IS NOT NULL AND NEW.head_score IS DISTINCT FROM OLD.head_score THEN
    RAISE EXCEPTION 'Completed Department Head criterion scores cannot be rewritten';
  END IF;
  IF OLD.final_score IS NOT NULL AND NEW.final_score IS DISTINCT FROM OLD.final_score THEN
    RAISE EXCEPTION 'Final criterion scores cannot be rewritten';
  END IF;
  IF OLD.leader_score IS NOT NULL AND NEW.system_score IS DISTINCT FROM OLD.system_score THEN
    RAISE EXCEPTION 'System criterion scores cannot change after Leader review starts';
  END IF;

  IF OLD.leader_score IS NULL AND NEW.leader_score IS NOT NULL THEN
    IF evaluation_state <> 'SYSTEM_EVALUATED' THEN
      RAISE EXCEPTION 'Leader criterion scores may be set only during system-evaluated state';
    END IF;
    IF OLD.system_score IS NULL OR NEW.leader_score IS DISTINCT FROM OLD.system_score THEN
      SELECT EXISTS (
        SELECT 1 FROM adjustments a
        WHERE a.criterion_evaluation_id = OLD.id
          AND a.layer = 'LEADER'
          AND a.previous_score IS NOT DISTINCT FROM OLD.system_score
          AND a.new_score = NEW.leader_score
      ) INTO audit_exists;
      IF NOT audit_exists THEN
        RAISE EXCEPTION 'Leader score changes require a matching append-only adjustment record';
      END IF;
    END IF;
  END IF;

  IF OLD.head_score IS NULL AND NEW.head_score IS NOT NULL THEN
    IF evaluation_state <> 'LEADER_REVIEW' OR OLD.leader_score IS NULL THEN
      RAISE EXCEPTION 'Department Head criterion scores require completed Leader review';
    END IF;
    IF NEW.head_score IS DISTINCT FROM OLD.leader_score THEN
      SELECT EXISTS (
        SELECT 1 FROM adjustments a
        WHERE a.criterion_evaluation_id = OLD.id
          AND a.layer = 'DEPARTMENT_HEAD'
          AND a.previous_score IS NOT DISTINCT FROM OLD.leader_score
          AND a.new_score = NEW.head_score
      ) INTO audit_exists;
      IF NOT audit_exists THEN
        RAISE EXCEPTION 'Department Head score changes require a matching append-only adjustment record';
      END IF;
    END IF;
  END IF;

  IF OLD.final_score IS NULL AND NEW.final_score IS NOT NULL THEN
    IF evaluation_state <> 'HEAD_REVIEW' OR OLD.head_score IS NULL OR NEW.final_score IS DISTINCT FROM OLD.head_score THEN
      RAISE EXCEPTION 'Final criterion score must copy the completed Department Head score';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS criterion_evaluation_final_state_guard ON criterion_evaluations;
CREATE TRIGGER criterion_evaluation_final_state_guard
BEFORE INSERT OR UPDATE OR DELETE ON criterion_evaluations
FOR EACH ROW EXECUTE FUNCTION guard_criterion_evaluation_final_state();

CREATE OR REPLACE FUNCTION guard_evidence_final_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  criterion_evaluation_id uuid;
  evaluation_state evaluation_status;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.criterion_evaluation_id <> OLD.criterion_evaluation_id THEN
    RAISE EXCEPTION 'Evidence cannot move between criterion evaluations';
  END IF;
  criterion_evaluation_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.criterion_evaluation_id ELSE NEW.criterion_evaluation_id END;
  SELECT me.status INTO evaluation_state
  FROM criterion_evaluations ce
  JOIN member_evaluations me ON me.id = ce.member_evaluation_id
  WHERE ce.id = criterion_evaluation_id;
  IF evaluation_state IN ('FINALIZED', 'LOCKED') THEN
    RAISE EXCEPTION 'Evidence is immutable after member finalization';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS evidence_final_state_guard ON evidence;
CREATE TRIGGER evidence_final_state_guard
BEFORE INSERT OR UPDATE OR DELETE ON evidence
FOR EACH ROW EXECUTE FUNCTION guard_evidence_final_state();

CREATE OR REPLACE FUNCTION guard_adjustment_final_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evaluation_state evaluation_status;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Review adjustments are append-only';
  END IF;
  SELECT me.status INTO evaluation_state
  FROM criterion_evaluations ce
  JOIN member_evaluations me ON me.id = ce.member_evaluation_id
  WHERE ce.id = NEW.criterion_evaluation_id;
  IF evaluation_state IN ('FINALIZED', 'LOCKED') THEN
    RAISE EXCEPTION 'Review adjustments cannot be added after member finalization';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS adjustment_final_state_guard ON adjustments;
CREATE TRIGGER adjustment_final_state_guard
BEFORE INSERT OR UPDATE OR DELETE ON adjustments
FOR EACH ROW EXECUTE FUNCTION guard_adjustment_final_state();

CREATE OR REPLACE FUNCTION guard_data_quality_final_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evaluation_id uuid;
  criterion_evaluation_id uuid;
  evaluation_state evaluation_status;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.member_evaluation_id IS DISTINCT FROM OLD.member_evaluation_id OR
    NEW.criterion_evaluation_id IS DISTINCT FROM OLD.criterion_evaluation_id
  ) THEN
    RAISE EXCEPTION 'Data-quality issue identity is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    evaluation_id := OLD.member_evaluation_id;
    criterion_evaluation_id := OLD.criterion_evaluation_id;
  ELSE
    evaluation_id := NEW.member_evaluation_id;
    criterion_evaluation_id := NEW.criterion_evaluation_id;
  END IF;
  IF evaluation_id IS NULL AND criterion_evaluation_id IS NOT NULL THEN
    SELECT member_evaluation_id INTO evaluation_id FROM criterion_evaluations WHERE id = criterion_evaluation_id;
  END IF;
  IF evaluation_id IS NOT NULL THEN
    SELECT status INTO evaluation_state FROM member_evaluations WHERE id = evaluation_id;
    IF evaluation_state IN ('FINALIZED', 'LOCKED') THEN
      RAISE EXCEPTION 'Data-quality state is immutable after member finalization';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS data_quality_final_state_guard ON data_quality_issues;
CREATE TRIGGER data_quality_final_state_guard
BEFORE INSERT OR UPDATE OR DELETE ON data_quality_issues
FOR EACH ROW EXECUTE FUNCTION guard_data_quality_final_state();

CREATE OR REPLACE FUNCTION guard_historical_snapshot_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evaluation_state evaluation_status;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO evaluation_state FROM member_evaluations WHERE id = NEW.member_evaluation_id;
    IF evaluation_state <> 'FINALIZED' THEN
      RAISE EXCEPTION 'Historical snapshots can be created only for FINALIZED evaluations';
    END IF;
    IF NEW.snapshot_version <= 0 OR NEW.checksum !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'Historical snapshot version/checksum is invalid';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Historical snapshots are immutable';
END;
$$;

DROP TRIGGER IF EXISTS historical_snapshot_state_guard ON historical_snapshots;
CREATE TRIGGER historical_snapshot_state_guard
BEFORE INSERT OR UPDATE OR DELETE ON historical_snapshots
FOR EACH ROW EXECUTE FUNCTION guard_historical_snapshot_state();

CREATE OR REPLACE FUNCTION guard_evaluation_period_final_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_stage integer;
  new_stage integer;
  member_count integer;
  qualifying_count integer;
BEGIN
  old_stage := CASE OLD.status
    WHEN 'UPCOMING' THEN 0 WHEN 'COLLECTING' THEN 1 WHEN 'SYSTEM_EVALUATED' THEN 2
    WHEN 'LEADER_REVIEW' THEN 3 WHEN 'HEAD_REVIEW' THEN 4 WHEN 'FINALIZED' THEN 5 WHEN 'LOCKED' THEN 6 END;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('FINALIZED', 'LOCKED') THEN
      RAISE EXCEPTION 'Finalized or locked evaluation periods are immutable';
    END IF;
    RETURN OLD;
  END IF;
  new_stage := CASE NEW.status
    WHEN 'UPCOMING' THEN 0 WHEN 'COLLECTING' THEN 1 WHEN 'SYSTEM_EVALUATED' THEN 2
    WHEN 'LEADER_REVIEW' THEN 3 WHEN 'HEAD_REVIEW' THEN 4 WHEN 'FINALIZED' THEN 5 WHEN 'LOCKED' THEN 6 END;

  IF OLD.status = 'LOCKED' THEN
    RAISE EXCEPTION 'Locked evaluation periods are immutable';
  END IF;
  IF new_stage < old_stage THEN
    RAISE EXCEPTION 'Evaluation period lifecycle cannot move backwards';
  END IF;
  IF OLD.status IN ('FINALIZED', 'LOCKED') AND ROW(NEW.organization_id, NEW.key, NEW.starts_on, NEW.ends_on, NEW.rank_scheme_id)
     IS DISTINCT FROM ROW(OLD.organization_id, OLD.key, OLD.starts_on, OLD.ends_on, OLD.rank_scheme_id) THEN
    RAISE EXCEPTION 'Finalized evaluation period configuration is immutable';
  END IF;

  IF NEW.status IN ('HEAD_REVIEW', 'FINALIZED', 'LOCKED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT count(*) INTO member_count FROM member_evaluations WHERE period_id = OLD.id;
    IF member_count = 0 THEN RAISE EXCEPTION 'Evaluation period cannot advance without member evaluations'; END IF;
    IF NEW.status = 'HEAD_REVIEW' THEN
      SELECT count(*) INTO qualifying_count FROM member_evaluations WHERE period_id = OLD.id AND status IN ('LEADER_REVIEW','HEAD_REVIEW','FINALIZED','LOCKED');
    ELSIF NEW.status = 'FINALIZED' THEN
      SELECT count(*) INTO qualifying_count FROM member_evaluations WHERE period_id = OLD.id AND status IN ('FINALIZED','LOCKED');
    ELSE
      SELECT count(*) INTO qualifying_count FROM member_evaluations WHERE period_id = OLD.id AND status = 'LOCKED';
    END IF;
    IF qualifying_count <> member_count THEN
      RAISE EXCEPTION 'Evaluation period cannot advance beyond member workflow completion';
    END IF;
  END IF;
  IF NEW.status = 'LOCKED' AND NEW.status IS DISTINCT FROM OLD.status AND (NEW.locked_at IS NULL OR NEW.locked_by IS NULL) THEN
    RAISE EXCEPTION 'LOCKED period transition requires lock metadata';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evaluation_period_final_state_guard ON evaluation_periods;
CREATE TRIGGER evaluation_period_final_state_guard
BEFORE UPDATE OR DELETE ON evaluation_periods
FOR EACH ROW EXECUTE FUNCTION guard_evaluation_period_final_state();
