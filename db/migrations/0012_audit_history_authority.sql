-- T09: tenant-safe append-only audit authority.
-- Legacy audit rows cannot be safely assigned to an organization without provenance,
-- so fail explicitly instead of guessing a tenant.

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS organization_id uuid;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM audit_events WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'audit_events contains legacy rows without organization_id; migrate them explicitly before applying 0012';
  END IF;
END $$;

ALTER TABLE audit_events ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_events_organization_id_organizations_id_fk'
  ) THEN
    ALTER TABLE audit_events
      ADD CONSTRAINT audit_events_organization_id_organizations_id_fk
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS audit_events_org_time_idx ON audit_events (organization_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only_guard ON audit_events;
CREATE TRIGGER audit_events_append_only_guard
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
