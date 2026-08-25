import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (process.env.NODE_ENV === "production") throw new Error("Local demo seed is disabled in production.");
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, prepare: false });

const teamDefinitions = [
  { name: "API", description: "Backend API platform and service delivery.", leader: "Nguyen Minh Quan", leaderEmployeeId: "TL-1001", leaderEmail: "nguyen.minh.quan@kpi.local" },
  { name: "CMS", description: "Content management platform engineering.", leader: "Tran Thu Ha", leaderEmployeeId: "TL-1002", leaderEmail: "tran.thu.ha@kpi.local" },
  { name: "Ads", description: "Advertising platform engineering and operations.", leader: "Le Hoang Nam", leaderEmployeeId: "TL-1003", leaderEmail: "le.hoang.nam@kpi.local" },
  { name: "Payment", description: "Payment platform reliability and delivery.", leader: "Pham Gia Bao", leaderEmployeeId: "TL-1004", leaderEmail: "pham.gia.bao@kpi.local" },
  { name: "R&D", description: "Research, experimentation and platform innovation.", leader: "Do Anh Khoa", leaderEmployeeId: "TL-1005", leaderEmail: "do.anh.khoa@kpi.local" },
  { name: "Database", description: "Database platform, performance and reliability.", leader: "Vu Bao Chau", leaderEmployeeId: "TL-1006", leaderEmail: "vu.bao.chau@kpi.local" },
];

const memberDefinitions = [
  { name: "Nguyen Van An", employeeId: "BE-1042", email: "nguyen.van.an@kpi.local", team: "API" },
  { name: "Le Minh Chau", employeeId: "BE-1051", email: "le.minh.chau@kpi.local", team: "API" },
  { name: "Tran Quoc Huy", employeeId: "BE-1067", email: "tran.quoc.huy@kpi.local", team: "API" },
  { name: "Pham Thu Trang", employeeId: "BE-1082", email: "pham.thu.trang@kpi.local", team: "Payment" },
  { name: "Do Gia Han", employeeId: "BE-1098", email: "do.gia.han@kpi.local", team: "R&D" },
  { name: "Hoang Duc Long", employeeId: "BE-1101", email: "hoang.duc.long@kpi.local", team: "Ads" },
  { name: "Bui Thanh Lam", employeeId: "BE-1116", email: "bui.thanh.lam@kpi.local", team: "CMS" },
  { name: "Nguyen My Linh", employeeId: "BE-1124", email: "nguyen.my.linh@kpi.local", team: "Database" },
];

const metricDefinitions = [
  { key: "on_time_completion_rate", name: "On-time Completion Rate", description: "Percentage of committed work completed on or before deadline.", formulaKind: "RATIO", requiredFields: ["committed", "completedOnTime"] },
  { key: "reopen_rate", name: "Reopen Rate", description: "Percentage of resolved issues reopened later.", formulaKind: "RATIO", requiredFields: ["resolved", "reopened"] },
  { key: "resolution_time_minutes", name: "Resolution Time", description: "Median incident resolution duration in minutes.", formulaKind: "DURATION", requiredFields: ["resolvedAt", "startedAt"] },
  { key: "proactive_detection_count", name: "Proactive Detection", description: "Count of validated proactive production-risk detections.", formulaKind: "COUNT", requiredFields: ["detections"] },
];

const criteria = [
  {
    name: "Delivery",
    description: "Reliable and timely delivery against committed work.",
    position: 0,
    maxScore: 3,
    method: "AUTO",
    evidencePolicy: { sources: ["JIRA"] },
    requiredEvidence: true,
    metricKey: "on_time_completion_rate",
    rule: { type: "THRESHOLD", bands: [{ operator: ">=", value: 95, score: 3 }, { operator: ">=", value: 90, score: 2.8 }, { operator: ">=", value: 85, score: 2.5 }, { operator: ">=", value: 80, score: 2.2 }], fallback: 1.5 },
  },
  {
    name: "Code Quality",
    description: "Quality signals derived from bugs, reopen and review evidence.",
    position: 1,
    maxScore: 2.5,
    method: "ASSISTED",
    evidencePolicy: { sources: ["JIRA", "MANUAL"] },
    requiredEvidence: true,
    metricKey: "reopen_rate",
    rule: { type: "THRESHOLD", bands: [{ operator: "<=", value: 4, score: 2.5 }, { operator: "<=", value: 6, score: 2.3 }, { operator: "<=", value: 8, score: 2.1 }, { operator: "<=", value: 12, score: 1.7 }], fallback: 1 },
  },
  {
    name: "Incident Support",
    description: "Operational response and incident resolution contribution.",
    position: 2,
    maxScore: 2,
    method: "AUTO",
    evidencePolicy: { sources: ["JIRA"] },
    requiredEvidence: true,
    metricKey: "resolution_time_minutes",
    rule: { type: "THRESHOLD", bands: [{ operator: "<=", value: 60, score: 2 }, { operator: "<=", value: 90, score: 1.8 }, { operator: "<=", value: 120, score: 1.7 }, { operator: "<=", value: 180, score: 1.3 }], fallback: 0.8 },
  },
  {
    name: "Proactive Detection",
    description: "Proactive identification of risks and production issues.",
    position: 3,
    maxScore: 1.5,
    method: "ASSISTED",
    evidencePolicy: { sources: ["JIRA", "MANUAL"] },
    requiredEvidence: true,
    metricKey: "proactive_detection_count",
    rule: { type: "THRESHOLD", bands: [{ operator: ">=", value: 5, score: 1.5 }, { operator: ">=", value: 3, score: 1.2 }, { operator: ">=", value: 1, score: 0.8 }], fallback: 0.4 },
  },
  {
    name: "Documentation",
    description: "Knowledge sharing and documentation quality.",
    position: 4,
    maxScore: 1,
    method: "MANUAL",
    evidencePolicy: { sources: ["MANUAL"] },
    requiredEvidence: true,
    metricKey: null,
    rule: null,
  },
];

async function ensureKpiConfiguration(tx, organizationId, adminUserId) {
  const metrics = new Map();
  for (const metric of metricDefinitions) {
    const rows = await tx`
      INSERT INTO metric_definitions (organization_id, key, name, description, formula_kind, required_fields, supported_issue_types, data_quality_requirements, active)
      VALUES (${organizationId}, ${metric.key}, ${metric.name}, ${metric.description}, ${metric.formulaKind}, ${tx.json(metric.requiredFields)}, ${tx.json([])}, ${tx.json({ requireCompleteFields: true })}, true)
      ON CONFLICT (organization_id, key) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        required_fields = EXCLUDED.required_fields,
        active = true,
        updated_at = now()
      RETURNING id, key
    `;
    metrics.set(rows[0].key, rows[0].id);
  }

  const templateRows = await tx`
    INSERT INTO kpi_templates (organization_id, name, kpi_group, description, created_by)
    VALUES (${organizationId}, 'Backend Engineering KPI', 'Engineering', 'Production-like local demo KPI configuration for backend engineering teams.', ${adminUserId})
    ON CONFLICT (organization_id, name) DO UPDATE SET
      kpi_group = EXCLUDED.kpi_group,
      description = EXCLUDED.description,
      updated_at = now()
    RETURNING id
  `;
  const templateId = templateRows[0].id;

  let v1Rows = await tx`SELECT id, status, submitted_at FROM kpi_versions WHERE template_id = ${templateId} AND version = 1 LIMIT 1`;
  let v1Id;
  if (v1Rows.length === 0) {
    const created = await tx`
      INSERT INTO kpi_versions (template_id, version, status, total_max_score, created_by)
      VALUES (${templateId}, 1, 'DRAFT', 10, ${adminUserId}) RETURNING id
    `;
    v1Id = created[0].id;
    await insertCriteria(tx, v1Id, metrics);

    await tx`UPDATE kpi_versions SET submitted_at = now(), updated_at = now() WHERE id = ${v1Id}`;
    await tx`UPDATE kpi_versions SET approved_at = now(), approved_by = ${adminUserId}, updated_at = now() WHERE id = ${v1Id}`;
    await tx`UPDATE kpi_versions SET status = 'PUBLISHED', published_at = now(), updated_at = now() WHERE id = ${v1Id}`;
  } else {
    v1Id = v1Rows[0].id;
  }

  const v2Rows = await tx`SELECT id FROM kpi_versions WHERE template_id = ${templateId} AND version = 2 LIMIT 1`;
  if (v2Rows.length === 0) {
    const created = await tx`
      INSERT INTO kpi_versions (template_id, version, status, total_max_score, created_by)
      VALUES (${templateId}, 2, 'DRAFT', 10, ${adminUserId}) RETURNING id
    `;
    await insertCriteria(tx, created[0].id, metrics);
  }

  return { templateId, publishedVersionId: v1Id };
}

async function insertCriteria(tx, versionId, metrics) {
  for (const criterion of criteria) {
    const criterionRows = await tx`
      INSERT INTO criteria (kpi_version_id, name, description, position, max_score, method, evidence_policy, review_required, required_evidence, adjustment_policy)
      VALUES (${versionId}, ${criterion.name}, ${criterion.description}, ${criterion.position}, ${criterion.maxScore}, ${criterion.method}, ${tx.json(criterion.evidencePolicy)}, true, ${criterion.requiredEvidence}, ${tx.json({ meaningfulDelta: 0.3 })})
      RETURNING id
    `;
    const criterionId = criterionRows[0].id;
    if (criterion.metricKey) {
      await tx`
        INSERT INTO metric_configurations (criterion_id, metric_definition_id, parameters)
        VALUES (${criterionId}, ${metrics.get(criterion.metricKey)}, ${tx.json({})})
      `;
    }
    if (criterion.rule) {
      const { type, ...config } = criterion.rule;
      await tx`
        INSERT INTO scoring_rules (criterion_id, type, position, config)
        VALUES (${criterionId}, ${type}, 0, ${tx.json(config)})
      `;
    }
  }
}

try {
  await sql.begin(async (tx) => {
    const orgRows = await tx`SELECT id FROM organizations WHERE slug = 'kpi-local' LIMIT 1`;
    if (orgRows.length === 0) throw new Error("Local organization 'kpi-local' is missing. Run db:bootstrap-local-admin first.");
    const organizationId = orgRows[0].id;

    const adminRows = await tx`SELECT id FROM users WHERE lower(email) = 'admin@kpi.local' LIMIT 1`;
    if (adminRows.length === 0) throw new Error("Local administrator is missing. Run db:bootstrap-local-admin first.");
    const adminUserId = adminRows[0].id;

    const departmentRows = await tx`
      INSERT INTO departments (organization_id, name, code, active)
      VALUES (${organizationId}, 'Backend Department', 'BACKEND', true)
      ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name, active = true, updated_at = now()
      RETURNING id
    `;
    const departmentId = departmentRows[0].id;

    const teamIds = new Map();
    for (const team of teamDefinitions) {
      const teamRows = await tx`
        INSERT INTO teams (department_id, name, description, effective_from, active)
        VALUES (${departmentId}, ${team.name}, ${team.description}, '2026-01-01', true)
        ON CONFLICT (department_id, name) DO UPDATE SET description = EXCLUDED.description, active = true, updated_at = now()
        RETURNING id
      `;
      teamIds.set(team.name, teamRows[0].id);
    }

    for (const team of teamDefinitions) {
      const leaderRows = await tx`
        INSERT INTO members (organization_id, employee_id, name, email, active)
        VALUES (${organizationId}, ${team.leaderEmployeeId}, ${team.leader}, ${team.leaderEmail}, true)
        ON CONFLICT (organization_id, employee_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, active = true, updated_at = now()
        RETURNING id
      `;
      const leaderId = leaderRows[0].id;
      const teamId = teamIds.get(team.name);
      await tx`UPDATE teams SET leader_member_id = ${leaderId}, updated_at = now() WHERE id = ${teamId}`;
      await tx`
        INSERT INTO team_leadership_assignments (team_id, leader_member_id, effective_from)
        SELECT ${teamId}, ${leaderId}, '2026-01-01'
        WHERE NOT EXISTS (
          SELECT 1 FROM team_leadership_assignments WHERE team_id = ${teamId} AND leader_member_id = ${leaderId} AND effective_from = '2026-01-01'
        )
      `;
      await tx`
        INSERT INTO team_memberships (member_id, team_id, effective_from, "primary")
        SELECT ${leaderId}, ${teamId}, '2026-01-01', true
        WHERE NOT EXISTS (
          SELECT 1 FROM team_memberships WHERE member_id = ${leaderId} AND team_id = ${teamId} AND effective_from = '2026-01-01' AND "primary" = true
        )
      `;
    }

    for (const member of memberDefinitions) {
      const memberRows = await tx`
        INSERT INTO members (organization_id, employee_id, name, email, active)
        VALUES (${organizationId}, ${member.employeeId}, ${member.name}, ${member.email}, true)
        ON CONFLICT (organization_id, employee_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, active = true, updated_at = now()
        RETURNING id
      `;
      const memberId = memberRows[0].id;
      const teamId = teamIds.get(member.team);
      await tx`
        INSERT INTO team_memberships (member_id, team_id, effective_from, "primary")
        SELECT ${memberId}, ${teamId}, '2026-01-01', true
        WHERE NOT EXISTS (
          SELECT 1 FROM team_memberships WHERE member_id = ${memberId} AND team_id = ${teamId} AND effective_from = '2026-01-01' AND "primary" = true
        )
      `;
    }

    const { publishedVersionId } = await ensureKpiConfiguration(tx, organizationId, adminUserId);

    const rankRows = await tx`
      INSERT INTO rank_schemes (organization_id, name, active)
      VALUES (${organizationId}, 'Backend 2026 Rank Scheme', true)
      ON CONFLICT (organization_id, name) DO UPDATE SET active = true, updated_at = now()
      RETURNING id
    `;
    const rankSchemeId = rankRows[0].id;
    const existingBands = await tx`SELECT count(*)::int AS count FROM rank_bands WHERE rank_scheme_id = ${rankSchemeId}`;
    if (existingBands[0].count === 0) {
      const bands = [
        ["A+", 10, 10, true, true, 1.4, 0],
        ["A", 9.7, 10, true, false, 1.3, 1],
        ["B+", 9.4, 9.7, true, false, 1.2, 2],
        ["B", 9, 9.4, true, false, 1.1, 3],
        ["C", 8, 9, true, false, 1, 4],
        ["D", 7.5, 8, true, false, 0.8, 5],
        ["E", null, 7.5, true, false, 0.6, 6],
      ];
      for (const [rank, min, max, minInclusive, maxInclusive, coefficient, position] of bands) {
        await tx`
          INSERT INTO rank_bands (rank_scheme_id, rank, min_score, max_score, min_inclusive, max_inclusive, coefficient, position)
          VALUES (${rankSchemeId}, ${rank}, ${min}, ${max}, ${minInclusive}, ${maxInclusive}, ${coefficient}, ${position})
        `;
      }
    }

    const periodRows = await tx`
      INSERT INTO evaluation_periods (organization_id, key, starts_on, ends_on, status, rank_scheme_id)
      VALUES (${organizationId}, '2026-09', '2026-09-01', '2026-09-30', 'UPCOMING', ${rankSchemeId})
      ON CONFLICT (organization_id, key) DO UPDATE SET rank_scheme_id = EXCLUDED.rank_scheme_id, updated_at = now()
      RETURNING id
    `;
    const periodId = periodRows[0].id;
    for (const teamId of teamIds.values()) {
      await tx`
        INSERT INTO period_kpi_assignments (period_id, team_id, kpi_version_id, assigned_by)
        VALUES (${periodId}, ${teamId}, ${publishedVersionId}, ${adminUserId})
        ON CONFLICT (period_id, team_id) DO NOTHING
      `;
    }
  });

  const counts = await sql`
    SELECT
      (SELECT count(*) FROM teams t JOIN departments d ON d.id=t.department_id JOIN organizations o ON o.id=d.organization_id WHERE o.slug='kpi-local')::int AS teams,
      (SELECT count(*) FROM members m JOIN organizations o ON o.id=m.organization_id WHERE o.slug='kpi-local')::int AS members,
      (SELECT count(*) FROM kpi_templates k JOIN organizations o ON o.id=k.organization_id WHERE o.slug='kpi-local')::int AS templates,
      (SELECT count(*) FROM evaluation_periods p JOIN organizations o ON o.id=p.organization_id WHERE o.slug='kpi-local')::int AS periods
  `;
  console.log(`Local demo data ready: ${counts[0].teams} teams, ${counts[0].members} members, ${counts[0].templates} KPI template(s), ${counts[0].periods} evaluation period(s).`);
} finally {
  await sql.end({ timeout: 2 });
}
