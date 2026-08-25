-- T09 hardening: audited actors are historical references and must not be hard-deleted.
-- User offboarding must deactivate/revoke the account instead of rewriting audit history.

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
  WHERE t.relname = 'audit_events'
    AND c.contype = 'f'
    AND a.attname = 'actor_user_id'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE audit_events DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_actor_user_id_fkey
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT;
