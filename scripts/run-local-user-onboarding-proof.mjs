import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import postgres from "postgres";

const appUrl = process.env.APP_URL || "http://localhost:3712";
const databaseUrl = process.env.DATABASE_URL;
if (process.env.NODE_ENV === "production") throw new Error("Local user-onboarding proof is disabled in production.");
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const proofSuffix = randomBytes(6).toString("hex");
const adminEmail = "onboarding-proof-admin@kpi.local";
const memberEmail = `onboarding-proof-member-${proofSuffix}@kpi.local`;
const memberEmployeeId = `ONBOARD-${proofSuffix}`;
const adminPassword = `Admin-${randomBytes(18).toString("base64url")}`;
const temporaryPassword = `Temp-${randomBytes(18).toString("base64url")}`;
const newPassword = `New-${randomBytes(20).toString("base64url")}`;

function derive(value, salt) { return new Promise((resolve, reject) => nodeScrypt(value, salt, 64, { N: 131_072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(Buffer.from(key)))); }
async function hashPassword(value) { const salt = randomBytes(16); const key = await derive(value, salt); return ["scrypt", 131_072, 8, 1, salt.toString("base64url"), key.toString("base64url")].join("$"); }
async function request(path, init = {}, cookie = "", expectOk = true) {
  const headers = new Headers(init.headers); headers.set("Origin", appUrl); headers.set("Sec-Fetch-Site", "same-origin");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json"); if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(`${appUrl}${path}`, { ...init, headers }); const payload = await response.json().catch(() => null);
  if (expectOk && !response.ok) throw new Error(`${init.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  return { response, payload, data: payload?.data, requestId: payload?.requestId ?? null };
}

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, prepare: false });
let adminId = null; let provisionedUserId = null; let memberId = null;
try {
  const [organization] = await sql`select id from organizations where slug = 'kpi-local' limit 1`;
  if (!organization) throw new Error("Local organization seed is required.");
  const [member] = await sql`insert into members (organization_id, employee_id, name, email, active) values (${organization.id}, ${memberEmployeeId}, 'Onboarding Proof Member', ${memberEmail}, true) returning id, name, email`;
  if (!member) throw new Error("Temporary onboarding member could not be created.");
  memberId = member.id;
  const [admin] = await sql`insert into users (email, display_name, password_hash, role, active, password_change_required) values (${adminEmail}, 'Onboarding Proof Admin', ${await hashPassword(adminPassword)}, 'ADMINISTRATOR', true, false) on conflict (email) do update set password_hash=excluded.password_hash, role='ADMINISTRATOR', active=true, password_change_required=false, updated_at=now() returning id`;
  adminId = admin.id;
  await sql`insert into user_organization_access (user_id, organization_id, role, active) values (${adminId}, ${organization.id}, 'ADMINISTRATOR', true) on conflict (user_id, organization_id) do update set role='ADMINISTRATOR', active=true, updated_at=now()`;

  const adminLogin = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email: adminEmail, password: adminPassword }) });
  const adminCookie = (adminLogin.response.headers.get("set-cookie") || "").split(";")[0];
  const provision = await request(`/api/organizations/${organization.id}/administration/users`, { method: "POST", body: JSON.stringify({ email: member.email, displayName: member.name, role: "MEMBER", temporaryPassword, memberId: member.id }) }, adminCookie);
  provisionedUserId = provision.data.userId;
  if (provision.data.passwordChangeRequired !== true) throw new Error("Provisioned account was not marked for forced password change.");
  const audit = (await request(`/api/organizations/${organization.id}/audit?limit=100`, {}, adminCookie)).data.find((event) => event.action === "ORGANIZATION_USER_PROVISIONED" && event.entityId === provisionedUserId && event.requestId === provision.requestId);
  if (!audit) throw new Error("Provisioning audit/requestId correlation failed.");
  const serializedAudit = JSON.stringify(audit).toLowerCase();
  if (serializedAudit.includes(temporaryPassword.toLowerCase()) || serializedAudit.includes("passwordhash") || serializedAudit.includes("temporarypassword")) throw new Error("Provisioning audit leaked password material.");

  const tempLogin = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email: member.email, password: temporaryPassword }) });
  const tempCookie = (tempLogin.response.headers.get("set-cookie") || "").split(";")[0];
  const beforeMe = await request("/api/auth/me", {}, tempCookie);
  if (beforeMe.data.passwordChangeRequired !== true) throw new Error("Temporary session did not expose forced-rotation state.");
  const blockedOrganizations = await request("/api/organizations", {}, tempCookie, false);
  if (blockedOrganizations.response.status !== 403 || blockedOrganizations.payload?.error?.code !== "PASSWORD_CHANGE_REQUIRED") throw new Error("Temporary session was not blocked from organization data.");

  await request("/api/auth/password", { method: "POST", body: JSON.stringify({ currentPassword: temporaryPassword, newPassword }) }, tempCookie);
  const afterMe = await request("/api/auth/me", {}, tempCookie);
  if (afterMe.data.passwordChangeRequired !== false) throw new Error("Forced-rotation flag did not clear after password change.");
  const organizationsAfter = await request("/api/organizations", {}, tempCookie);
  if (!organizationsAfter.data.some((item) => item.organizationId === organization.id)) throw new Error("Organization access did not open after password rotation.");
  const passwordAudit = (await request(`/api/organizations/${organization.id}/audit?limit=100`, {}, adminCookie)).data.find((event) => event.action === "PASSWORD_CHANGED" && event.entityId === provisionedUserId);
  if (!passwordAudit) throw new Error("Password change was not audit-recorded.");
  if (JSON.stringify(passwordAudit).toLowerCase().includes(newPassword.toLowerCase()) || JSON.stringify(passwordAudit).toLowerCase().includes(temporaryPassword.toLowerCase())) throw new Error("Password change audit leaked password material.");
  await request("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }, tempCookie);

  const oldPasswordLogin = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email: member.email, password: temporaryPassword }) }, "", false);
  if (oldPasswordLogin.response.status !== 401) throw new Error("Old temporary password still authenticated after rotation.");
  const newPasswordLogin = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email: member.email, password: newPassword }) });
  if (newPasswordLogin.response.status !== 200) throw new Error("New password did not authenticate after rotation.");

  console.log(JSON.stringify({ adminLoginStatus: adminLogin.response.status, userProvisioned: true, memberLinked: provision.data.memberId === member.id, passwordChangeRequiredAtProvision: true, auditCorrelated: true, auditPasswordMaterialAbsent: true, temporaryLoginStatus: tempLogin.response.status, temporarySessionOrgAccessBlocked: true, passwordRotated: true, organizationAccessAfterRotation: true, oldTemporaryPasswordRejected: true, newPasswordAccepted: true }, null, 2));
} finally {
  if (memberId) {
    await sql`update members set user_id = null, updated_at = now() where id = ${memberId} and user_id = ${provisionedUserId}`.catch(() => undefined);
    await sql`delete from members where id = ${memberId}`.catch(() => undefined);
  }
  if (provisionedUserId) { await sql`delete from sessions where user_id = ${provisionedUserId}`.catch(() => undefined); await sql`delete from user_organization_access where user_id = ${provisionedUserId}`.catch(() => undefined); await sql`delete from users where id = ${provisionedUserId}`.catch(async () => { await sql`update users set active=false, updated_at=now() where id=${provisionedUserId}`; }); }
  if (adminId) await sql`update users set active=false, updated_at=now() where id=${adminId}`.catch(() => undefined);
  await sql.end({ timeout: 2 });
}
