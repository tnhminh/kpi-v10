import postgres from "postgres";

const appUrl = process.env.APP_URL || "http://localhost:3712";
const email = (process.env.DEV_ADMIN_EMAIL || "t07.scope@kpi.local").trim().toLowerCase();
const password = process.env.DEV_ADMIN_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;

if (process.env.NODE_ENV === "production") throw new Error("Local Department Head scope verification is disabled in production.");
if (!password) throw new Error("DEV_ADMIN_PASSWORD is required.");
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

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
try {
  const users = await sql`SELECT id FROM users WHERE lower(email) = ${email} LIMIT 1`;
  const userId = users[0]?.id;
  if (!userId) throw new Error("Scope verification user must be bootstrapped first.");

  const organizations = await sql`
    SELECT uoa.organization_id
    FROM user_organization_access uoa
    WHERE uoa.user_id = ${userId}
    ORDER BY uoa.created_at
    LIMIT 1
  `;
  const organizationId = organizations[0]?.organization_id;
  if (!organizationId) throw new Error("Scope verification user has no organization access.");

  await sql.begin(async (tx) => {
    await tx`UPDATE users SET role = 'DEPARTMENT_HEAD', updated_at = now() WHERE id = ${userId}`;
    await tx`UPDATE user_organization_access SET role = 'DEPARTMENT_HEAD', active = true, updated_at = now() WHERE user_id = ${userId} AND organization_id = ${organizationId}`;
    await tx`DELETE FROM department_head_assignments WHERE user_id = ${userId}`;
  });

  const login = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const cookie = (login.response.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie) throw new Error("Department Head login did not return a session cookie.");

  const periods = (await request(`/api/organizations/${organizationId}/evaluation/periods`, {}, cookie)).data;
  const period = periods.find((item) => item.key === "2026-09") || periods[0];
  if (!period) throw new Error("No evaluation period exists.");

  const departments = await sql`
    SELECT DISTINCT t.department_id AS id
    FROM member_evaluations me
    JOIN teams t ON t.id = me.resolved_team_id
    WHERE me.period_id = ${period.id}
    LIMIT 1
  `;
  const departmentId = departments[0]?.id;
  if (!departmentId) throw new Error("No resolved evaluation department exists for scope verification.");

  const queuePath = `/api/organizations/${organizationId}/evaluation/periods/${period.id}/review-queue?layer=DEPARTMENT_HEAD`;
  const before = (await request(queuePath, {}, cookie)).data;
  if (before.length !== 0) throw new Error(`Department Head without assignment unexpectedly saw ${before.length} evaluation(s).`);

  await sql`
    INSERT INTO department_head_assignments (department_id, user_id, effective_from, effective_to)
    VALUES (${departmentId}, ${userId}, ${period.startsOn}, null)
  `;
  const assigned = (await request(queuePath, {}, cookie)).data;
  if (assigned.length === 0) throw new Error("Department Head with effective assignment saw no evaluations in the assigned department.");

  await sql`DELETE FROM department_head_assignments WHERE department_id = ${departmentId} AND user_id = ${userId}`;
  const afterRemoval = (await request(queuePath, {}, cookie)).data;
  if (afterRemoval.length !== 0) throw new Error(`Department Head retained ${afterRemoval.length} evaluation(s) after assignment removal.`);

  console.log(JSON.stringify({
    loginStatus: login.response.status,
    period: period.key,
    withoutAssignment: before.length,
    withEffectiveAssignment: assigned.length,
    afterAssignmentRemoval: afterRemoval.length,
    scopeIntegrity: "PASS",
  }, null, 2));
} finally {
  await sql.end({ timeout: 2 });
}
