ALTER TABLE kpi_versions ADD CONSTRAINT kpi_versions_positive_version CHECK (version > 0);
ALTER TABLE criteria ADD CONSTRAINT criteria_nonnegative_position CHECK (position >= 0);
ALTER TABLE scoring_rules ADD CONSTRAINT scoring_rules_nonnegative_position CHECK (position >= 0);

CREATE UNIQUE INDEX criteria_version_name_lower_uq ON criteria (kpi_version_id, lower(name));
CREATE UNIQUE INDEX metric_definitions_org_key_lower_uq ON metric_definitions (organization_id, lower(key));
