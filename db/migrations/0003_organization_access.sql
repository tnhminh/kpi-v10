CREATE TABLE user_organization_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_organization_access_user_org_uq UNIQUE (user_id, organization_id)
);

CREATE INDEX user_organization_access_org_idx ON user_organization_access(organization_id);

-- Canonical human identifiers are case-insensitive at the database boundary.
CREATE UNIQUE INDEX members_org_email_lower_uq ON members (organization_id, lower(email));
CREATE UNIQUE INDEX teams_department_name_lower_uq ON teams (department_id, lower(name));
CREATE UNIQUE INDEX kpi_templates_org_name_lower_uq ON kpi_templates (organization_id, lower(name));
