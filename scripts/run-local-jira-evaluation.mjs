import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import postgres from "postgres";

const appUrl = process.env.APP_URL || "http://localhost:3712";
const databaseUrl = process.env.DATABASE_URL;
const periodKey = "2026-09-jira-auto";
const verifierEmail = "jira-proof@kpi.local";
const verifierPassword = `Proof-${randomBytes(18).toString("base64url")}`;

if (process.env.NODE_ENV === "production") throw new Error("Local Jira evaluation proof is disabled in production.");
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

function derive(passwordValue, salt) {
  return new Promise((resolve, reject) => {
    nodeScrypt(passwordValue, salt, 64, { N: 131_072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(Buffer.from(key));
    });
  });
}

async function hashPassword(passwordValue) {
  const salt = randomBytes(16);
  const key = await derive(passwordValue, salt);
  return ["scrypt", 131_072, 8, 1, salt.toString("base64url"), key.toString("base64url")].join("$");
}

async function request(path, init = {}, cookie = "") {
  const headers = new Headers(init.headers);
  headers.set("Origin", appUrl);
  headers.set("Sec-Fetch-Site", "same-origin");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(`${appUrl}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  return { response, data: payload?.data };
}

function stableScores(rows) {
  return JSON.stringify(rows.map((row) => ({
    memberId: row.memberId,
    systemScore: row.systemScore,
    confidence: row.confidence,
    criteria: row.criteria.map((criterion) => ({
      criterionId: criterion.criterionId,
      metricValue: criterion.metricValue,
      systemScore: criterion.systemScore,
      confidence: criterion.confidence,
    })),
  })));
}

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, prepare: false });
let verifierUserId = null;
let mutatedFact = null;

try {
  const organizationRows = await sql`select id from organizations where slug = 'kpi-local' limit 1`;
  if (!organizationRows[0]) throw new Error("Local organization 'kpi-local' is missing.");
  const organizationId = organizationRows[0].id;

  const passwordHash = await hashPassword(verifierPassword);
  const verifierRows = await sql`
    insert into users (email, display_name, password_hash, role, active)
    values (${verifierEmail}, 'Jira Evaluation Proof', ${passwordHash}, 'ADMINISTRATOR', true)
    on conflict (email) do update set password_hash = excluded.password_hash, role = 'ADMINISTRATOR', active = true, updated_at = now()
    returning id
  `;
  verifierUserId = verifierRows[0].id;
  await sql`
    insert into user_organization_access (user_id, organization_id, role, active)
    values (${verifierUserId}, ${organizationId}, 'ADMINISTRATOR', true)
    on conflict (user_id, organization_id) do update set role = 'ADMINISTRATOR', active = true, updated_at = now()
  `;

  const login = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email: verifierEmail, password: verifierPassword }) });
  const cookie = (login.response.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie) throw new Error("Verifier login did not return a session cookie.");

  const organizations = (await request("/api/organizations", {}, cookie)).data;
  const organization = organizations.find((item) => item.organizationId === organizationId);
  if (!organization) throw new Error("Verifier did not receive organization access.");
  const teams = (await request(`/api/organizations/${organizationId}/teams`, {}, cookie)).data;
  const templates = (await request(`/api/organizations/${organizationId}/kpi/templates`, {}, cookie)).data;
  if (!teams.length || !templates.length) throw new Error("Demo teams/templates are required.");

  let publishedVersion = null;
  for (const template of templates) {
    const versions = (await request(`/api/organizations/${organizationId}/kpi/templates/${template.id}/versions`, {}, cookie)).data;
    publishedVersion = versions.find((item) => item.status === "PUBLISHED" || item.status === "IN_USE") ?? publishedVersion;
    if (publishedVersion) break;
  }
  if (!publishedVersion) throw new Error("No published/in-use KPI version exists.");

  let periods = (await request(`/api/organizations/${organizationId}/evaluation/periods`, {}, cookie)).data;
  let period = periods.find((item) => item.key === periodKey);
  if (!period) {
    period = (await request(`/api/organizations/${organizationId}/evaluation/periods`, {
      method: "POST",
      body: JSON.stringify({ key: periodKey, startsOn: "2026-09-01", endsOn: "2026-09-30", rankSchemeId: null }),
    }, cookie)).data;
  }
  if (period.status === "UPCOMING") {
    await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/assignments`, {
      method: "PUT",
      body: JSON.stringify({ assignments: teams.map((team) => ({ teamId: team.id, kpiVersionId: publishedVersion.id })) }),
    }, cookie);
    period = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/lifecycle`, {
      method: "POST",
      body: JSON.stringify({ action: "START_COLLECTION" }),
    }, cookie)).data;
  }
  if (!["COLLECTING", "SYSTEM_EVALUATED"].includes(period.status)) throw new Error(`Proof period is not Jira-evaluable from status '${period.status}'.`);

  const firstRun = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/evaluate-jira`, {
    method: "POST",
    body: JSON.stringify({ memberIds: [] }),
  }, cookie)).data;
  const firstPersisted = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/evaluations`, {}, cookie)).data;

  const snapshotBefore = await sql`
    select count(*)::int as rows,
      count(distinct s.jira_issue_id)::int as issues,
      md5(coalesce(string_agg(s.jira_issue_id::text || ':' || s.facts::text || ':' || s.attribution::text, '|' order by s.jira_issue_id, s.member_evaluation_id), '')) as digest
    from jira_fact_snapshots s
    join member_evaluations e on e.id = s.member_evaluation_id
    where e.period_id = ${period.id}
  `;
  if ((snapshotBefore[0]?.rows ?? 0) <= 0) throw new Error("No Jira fact snapshots were persisted.");

  const candidate = await sql`
    select f.id, f.facts
    from jira_issue_facts f
    join jira_fact_snapshots s on s.jira_issue_id = f.jira_issue_id
    join member_evaluations e on e.id = s.member_evaluation_id
    where e.period_id = ${period.id}
    order by f.id limit 1
  `;
  if (!candidate[0]) throw new Error("No current Jira fact is available for snapshot immutability proof.");
  mutatedFact = { id: candidate[0].id, facts: candidate[0].facts };
  await sql`
    update jira_issue_facts set facts = ${sql.json({
      issueType: "Incident", committed: 1, completed: 1, completedOnTime: 0,
      reopened: 999, reopenCount: 999, resolutionMinutes: 999999,
      detections: 999, proactiveDetection: true, updatedAt: "2026-09-30T23:59:59.000Z"
    })}, updated_at = now() where id = ${mutatedFact.id}
  `;

  const secondRun = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/evaluate-jira`, {
    method: "POST",
    body: JSON.stringify({ memberIds: [] }),
  }, cookie)).data;
  const secondPersisted = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/evaluations`, {}, cookie)).data;
  const snapshotAfter = await sql`
    select count(*)::int as rows,
      count(distinct s.jira_issue_id)::int as issues,
      md5(coalesce(string_agg(s.jira_issue_id::text || ':' || s.facts::text || ':' || s.attribution::text, '|' order by s.jira_issue_id, s.member_evaluation_id), '')) as digest
    from jira_fact_snapshots s
    join member_evaluations e on e.id = s.member_evaluation_id
    where e.period_id = ${period.id}
  `;

  const scoresStable = stableScores(firstPersisted) === stableScores(secondPersisted);
  const snapshotsStable = snapshotBefore[0].rows === snapshotAfter[0].rows
    && snapshotBefore[0].issues === snapshotAfter[0].issues
    && snapshotBefore[0].digest === snapshotAfter[0].digest;
  if (!scoresStable) throw new Error("Current Jira fact mutation changed evaluation results despite frozen snapshots.");
  if (!snapshotsStable) throw new Error("Jira snapshots changed after current-state mutation and rerun.");

  console.log(JSON.stringify({
    loginStatus: login.response.status,
    organization: organization.organizationName,
    period: periodKey,
    source: firstRun.source,
    firstRunResults: firstRun.results.length,
    secondRunResults: secondRun.results.length,
    progress: secondRun.progress,
    persistedEvaluations: secondPersisted.length,
    snapshotRows: snapshotAfter[0].rows,
    distinctSnapshottedIssues: snapshotAfter[0].issues,
    snapshotDigestStable: snapshotsStable,
    evaluationScoresStableAfterCurrentFactMutation: scoresStable,
    criticalMembers: secondPersisted.filter((item) => item.qualityIssues.some((issue) => issue.severity === "CRITICAL")).length
  }, null, 2));
} finally {
  if (mutatedFact) await sql`update jira_issue_facts set facts = ${sql.json(mutatedFact.facts)}, updated_at = now() where id = ${mutatedFact.id}`.catch(() => undefined);
  if (verifierUserId) await sql`delete from users where id = ${verifierUserId}`.catch(() => undefined);
  await sql.end({ timeout: 2 });
}
