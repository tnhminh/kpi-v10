import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import postgres from "postgres";

const appUrl = process.env.APP_URL || "http://localhost:3712";
const databaseUrl = process.env.DATABASE_URL;
if (process.env.NODE_ENV === "production") throw new Error("Local administration proof is disabled in production.");
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const adminEmail = "admin-scope-proof@kpi.local";
const proofSuffix = randomBytes(6).toString("hex");
const headEmail = `head-scope-proof-${proofSuffix}@kpi.local`;
const password = `Proof-${randomBytes(18).toString("base64url")}`;

function derive(value, salt) {
  return new Promise((resolve, reject) => nodeScrypt(value, salt, 64, { N: 131_072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(Buffer.from(key))));
}
async function hashPassword(value) {
  const salt = randomBytes(16);
  const key = await derive(value, salt);
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
  return { response, data: payload?.data, requestId: payload?.requestId ?? null };
}

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, prepare: false });
let adminId = null;
let headId = null;
let assignmentId = null;
try {
  const [organization] = await sql`select id from organizations where slug = 'kpi-local' limit 1`;
  const [department] = await sql`select d.id, d.name from departments d where d.organization_id = ${organization.id} and d.active = true order by d.name limit 1`;
  if (!organization || !department) throw new Error("Local organization/department seed is required.");
  const passwordHash = await hashPassword(password);

  const [admin] = await sql`insert into users (email, display_name, password_hash, role, active) values (${adminEmail}, 'Administration Proof Admin', ${passwordHash}, 'ADMINISTRATOR', true) on conflict (email) do update set display_name = excluded.display_name, password_hash = excluded.password_hash, role = 'ADMINISTRATOR', active = true, updated_at = now() returning id`;
  adminId = admin.id;
  const [head] = await sql`insert into users (email, display_name, password_hash, role, active) values (${headEmail}, 'Administration Proof Head', ${passwordHash}, 'DEPARTMENT_HEAD', true) on conflict (email) do update set display_name = excluded.display_name, password_hash = excluded.password_hash, role = 'DEPARTMENT_HEAD', active = true, updated_at = now() returning id`;
  headId = head.id;
  await sql`insert into user_organization_access (user_id, organization_id, role, active) values (${adminId}, ${organization.id}, 'ADMINISTRATOR', true) on conflict (user_id, organization_id) do update set role = 'ADMINISTRATOR', active = true, updated_at = now()`;
  await sql`insert into user_organization_access (user_id, organization_id, role, active) values (${headId}, ${organization.id}, 'DEPARTMENT_HEAD', true) on conflict (user_id, organization_id) do update set role = 'DEPARTMENT_HEAD', active = true, updated_at = now()`;

  const login = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email: adminEmail, password }) });
  const cookie = (login.response.headers.get("set-cookie") || "").split(";")[0];
  const users = (await request(`/api/organizations/${organization.id}/administration/users`, {}, cookie)).data;
  if (!users.some((user) => user.userId === headId && user.role === "DEPARTMENT_HEAD" && user.userActive && user.accessActive)) throw new Error("Eligible Department Head was not listed by administration API.");

  const today = new Date().toISOString().slice(0, 10);
  const created = await request(`/api/organizations/${organization.id}/administration/department-head-assignments`, { method: "POST", body: JSON.stringify({ departmentId: department.id, userId: headId, effectiveFrom: today, effectiveTo: null }) }, cookie);
  assignmentId = created.data.id;
  const auditAfterCreate = (await request(`/api/organizations/${organization.id}/audit?limit=100`, {}, cookie)).data.find((event) => event.action === "DEPARTMENT_HEAD_ASSIGNMENT_CREATED" && event.entityId === assignmentId && event.requestId === created.requestId);
  if (!auditAfterCreate) throw new Error("Create assignment audit/requestId correlation failed.");

  const closed = await request(`/api/organizations/${organization.id}/administration/department-head-assignments/${assignmentId}`, { method: "PATCH", body: JSON.stringify({ effectiveTo: today }) }, cookie);
  const auditAfterClose = (await request(`/api/organizations/${organization.id}/audit?limit=100`, {}, cookie)).data.find((event) => event.action === "DEPARTMENT_HEAD_ASSIGNMENT_CLOSED" && event.entityId === assignmentId && event.requestId === closed.requestId);
  if (!auditAfterClose) throw new Error("Close assignment audit/requestId correlation failed.");

  const assignments = (await request(`/api/organizations/${organization.id}/administration/department-head-assignments`, {}, cookie)).data;
  const retained = assignments.find((item) => item.id === assignmentId);
  if (!retained || retained.effectiveFrom !== today || retained.effectiveTo !== today) throw new Error("Closed assignment history was not preserved.");

  console.log(JSON.stringify({ loginStatus: login.response.status, organizationId: organization.id, department: department.name, eligibleDepartmentHeadListed: true, assignmentCreated: true, createAuditCorrelated: true, assignmentClosed: true, closeAuditCorrelated: true, historicalAssignmentRetained: true, effectiveRange: `${today} -> ${today}` }, null, 2));
} finally {
  if (adminId) await sql`update users set active = false, updated_at = now() where id = ${adminId}`.catch(() => undefined);
  if (headId) await sql`update users set active = false, updated_at = now() where id = ${headId}`.catch(() => undefined);
  await sql.end({ timeout: 2 });
}
