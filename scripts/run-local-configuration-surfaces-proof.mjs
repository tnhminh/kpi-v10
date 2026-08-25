import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import postgres from "postgres";

const appUrl = process.env.APP_URL || "http://localhost:3712";
const databaseUrl = process.env.DATABASE_URL;
const verifierEmail = `configuration-proof-${Date.now()}@kpi.local`;
const verifierPassword = `Proof-${randomBytes(18).toString("base64url")}`;

if (process.env.NODE_ENV === "production") throw new Error("Local configuration-surface proof is disabled in production.");
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

async function request(path, cookie = "") {
  const headers = new Headers({ Origin: appUrl, "Sec-Fetch-Site": "same-origin" });
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(`${appUrl}${path}`, { headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`GET ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  return { response, data: payload?.data };
}

async function login(cookiePath, email, password) {
  const response = await fetch(`${appUrl}${cookiePath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: appUrl, "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify({ email, password }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`POST ${cookiePath} -> ${response.status}: ${JSON.stringify(payload)}`);
  return response;
}

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, prepare: false });
let verifierUserId = null;

try {
  const organizationRows = await sql`select id from organizations where slug = 'kpi-local' limit 1`;
  if (!organizationRows[0]) throw new Error("Local organization 'kpi-local' is missing.");
  const organizationId = organizationRows[0].id;
  const passwordHash = await hashPassword(verifierPassword);
  const verifierRows = await sql`
    insert into users (email, display_name, password_hash, role, active)
    values (${verifierEmail}, 'Configuration Surfaces Proof', ${passwordHash}, 'ADMINISTRATOR', true)
    returning id
  `;
  verifierUserId = verifierRows[0].id;
  await sql`
    insert into user_organization_access (user_id, organization_id, role, active)
    values (${verifierUserId}, ${organizationId}, 'ADMINISTRATOR', true)
  `;

  const loginResponse = await login("/api/auth/login", verifierEmail, verifierPassword);
  const cookie = (loginResponse.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie) throw new Error("Verifier login did not return a session cookie.");

  const [metricsResponse, rankResponse, templatesResponse, periodsResponse] = await Promise.all([
    request(`/api/organizations/${organizationId}/kpi/metrics`, cookie),
    request(`/api/organizations/${organizationId}/kpi/rank-schemes`, cookie),
    request(`/api/organizations/${organizationId}/kpi/templates`, cookie),
    request(`/api/organizations/${organizationId}/evaluation/periods`, cookie),
  ]);
  const metrics = metricsResponse.data;
  const rankSchemes = rankResponse.data;
  const templates = templatesResponse.data;
  const periods = periodsResponse.data;
  if (!metrics.length) throw new Error("Metric Library proof expected persisted metric definitions.");
  if (!rankSchemes.length || !rankSchemes.some((scheme) => scheme.bands.length)) throw new Error("Rank Scheme proof expected validated persisted bands.");
  if (!templates.length) throw new Error("Scoring Rule proof expected a KPI template.");
  if (!periods.length) throw new Error("Data Quality proof expected an evaluation period.");

  let persistedRules = 0;
  let criterionCount = 0;
  for (const template of templates) {
    const versions = (await request(`/api/organizations/${organizationId}/kpi/templates/${template.id}/versions`, cookie)).data;
    for (const version of versions) {
      const detail = (await request(`/api/organizations/${organizationId}/kpi/versions/${version.id}`, cookie)).data;
      criterionCount += detail.criteria.length;
      persistedRules += detail.criteria.reduce((sum, criterion) => sum + criterion.rules.length, 0);
    }
  }
  if (persistedRules <= 0) throw new Error("Scoring Rule proof expected at least one persisted rule.");

  const currentPeriod = [...periods].sort((left, right) => right.startsOn.localeCompare(left.startsOn))[0];
  const scopedEvaluations = (await request(`/api/organizations/${organizationId}/evaluation/periods/${currentPeriod.id}/review-queue?layer=DEPARTMENT_HEAD`, cookie)).data;
  const qualityIssues = scopedEvaluations.flatMap((evaluation) => evaluation.qualityIssues);
  const unresolvedCritical = qualityIssues.filter((issue) => issue.severity === "CRITICAL" && !issue.resolvedAt).length;

  console.log(JSON.stringify({
    loginStatus: loginResponse.status,
    organizationId,
    metrics: metrics.length,
    activeMetrics: metrics.filter((metric) => metric.active).length,
    rankSchemes: rankSchemes.length,
    rankBands: rankSchemes.reduce((sum, scheme) => sum + scheme.bands.length, 0),
    templates: templates.length,
    criteriaAcrossVersions: criterionCount,
    persistedScoringRules: persistedRules,
    qualityPeriod: currentPeriod.key,
    scopedEvaluations: scopedEvaluations.length,
    persistedQualityIssues: qualityIssues.length,
    unresolvedCriticalQualityIssues: unresolvedCritical,
  }, null, 2));
} finally {
  if (verifierUserId) {
    await sql`delete from sessions where user_id = ${verifierUserId}`.catch(() => undefined);
    await sql`delete from user_organization_access where user_id = ${verifierUserId}`.catch(() => undefined);
    await sql`delete from users where id = ${verifierUserId}`.catch(() => undefined);
  }
  await sql.end({ timeout: 2 });
}
