import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import postgres from "postgres";

const appUrl = process.env.APP_URL || "http://localhost:3712";
const databaseUrl = process.env.DATABASE_URL;
const verifierEmail = `dashboard-proof-${Date.now()}@kpi.local`;
const verifierPassword = `Proof-${randomBytes(18).toString("base64url")}`;

if (process.env.NODE_ENV === "production") throw new Error("Local dashboard proof is disabled in production.");
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

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, prepare: false });
let verifierUserId = null;

try {
  const organizationRows = await sql`select id from organizations where slug = 'kpi-local' limit 1`;
  if (!organizationRows[0]) throw new Error("Local organization 'kpi-local' is missing.");
  const organizationId = organizationRows[0].id;
  const passwordHash = await hashPassword(verifierPassword);
  const verifierRows = await sql`
    insert into users (email, display_name, password_hash, role, active)
    values (${verifierEmail}, 'Dashboard Proof', ${passwordHash}, 'ADMINISTRATOR', true)
    returning id
  `;
  verifierUserId = verifierRows[0].id;
  await sql`
    insert into user_organization_access (user_id, organization_id, role, active)
    values (${verifierUserId}, ${organizationId}, 'ADMINISTRATOR', true)
  `;

  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: verifierEmail, password: verifierPassword }),
  });
  const cookie = (login.response.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie) throw new Error("Verifier login did not return a session cookie.");

  const [historyResponse, periodsResponse, teamsResponse, membersResponse] = await Promise.all([
    request(`/api/organizations/${organizationId}/analytics/history`, {}, cookie),
    request(`/api/organizations/${organizationId}/evaluation/periods`, {}, cookie),
    request(`/api/organizations/${organizationId}/teams`, {}, cookie),
    request(`/api/organizations/${organizationId}/members`, {}, cookie),
  ]);
  const history = historyResponse.data;
  const periods = periodsResponse.data;
  const teams = teamsResponse.data;
  const members = membersResponse.data;
  if (history.scope !== "ORGANIZATION") throw new Error("Administrator dashboard history scope must be ORGANIZATION.");
  if (!periods.length) throw new Error("Dashboard proof expected at least one evaluation period.");
  if (!teams.length) throw new Error("Dashboard proof expected at least one team.");
  if (!members.length) throw new Error("Dashboard proof expected at least one member.");

  const currentPeriod = [...periods].sort((left, right) => right.startsOn.localeCompare(left.startsOn))[0];
  const evaluations = (await request(`/api/organizations/${organizationId}/evaluation/periods/${currentPeriod.id}/evaluations`, {}, cookie)).data;
  const stage = { PENDING: 0, SYSTEM_EVALUATED: 1, LEADER_REVIEW: 2, HEAD_REVIEW: 3, FINALIZED: 4, LOCKED: 5 };
  const finalized = evaluations.filter((row) => stage[row.status] >= stage.FINALIZED).length;
  const attention = evaluations.filter((row) => row.confidence === "LOW" || row.confidence === "REVIEW_REQUIRED" || row.qualityIssues.some((issue) => issue.severity === "CRITICAL" && !issue.resolvedAt)).length;
  const teamIds = new Set(evaluations.map((row) => row.resolvedTeamId));

  console.log(JSON.stringify({
    loginStatus: login.response.status,
    organizationId,
    historyScope: history.scope,
    historicalScore: history.summary.score,
    historicalCoverage: history.summary.coverageLabel,
    currentPeriod: currentPeriod.key,
    currentPeriodStatus: currentPeriod.status,
    configuredTeams: teams.length,
    configuredMembers: members.length,
    currentEvaluations: evaluations.length,
    currentEvaluationTeams: teamIds.size,
    finalizedOrLocked: finalized,
    attentionCases: attention,
  }, null, 2));
} finally {
  if (verifierUserId) {
    await sql`delete from sessions where user_id = ${verifierUserId}`.catch(() => undefined);
    await sql`delete from user_organization_access where user_id = ${verifierUserId}`.catch(() => undefined);
    await sql`delete from users where id = ${verifierUserId}`.catch(() => undefined);
  }
  await sql.end({ timeout: 2 });
}
