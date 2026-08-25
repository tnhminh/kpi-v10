import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import postgres from "postgres";

const appUrl = process.env.APP_URL || "http://localhost:3712";
const databaseUrl = process.env.DATABASE_URL;
const verifierEmail = "kpi-config-audit-proof@kpi.local";
const verifierPassword = `Proof-${randomBytes(18).toString("base64url")}`;

if (process.env.NODE_ENV === "production") throw new Error("Local KPI configuration audit proof is disabled in production.");
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
  return { response, data: payload?.data, requestId: payload?.requestId ?? null };
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
    values (${verifierEmail}, 'KPI Config Audit Proof', ${passwordHash}, 'ADMINISTRATOR', true)
    on conflict (email) do update set
      display_name = excluded.display_name,
      password_hash = excluded.password_hash,
      role = 'ADMINISTRATOR',
      active = true,
      updated_at = now()
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

  const templates = (await request(`/api/organizations/${organizationId}/kpi/templates`, {}, cookie)).data;
  let draft = null;
  for (const template of templates) {
    const versions = (await request(`/api/organizations/${organizationId}/kpi/templates/${template.id}/versions`, {}, cookie)).data;
    const version = versions.find((item) => item.status === "DRAFT" && !item.submittedAt);
    if (version) { draft = { template, version }; break; }
  }
  if (!draft) throw new Error("KPI configuration audit proof requires an editable DRAFT version.");
  const detail = (await request(`/api/organizations/${organizationId}/kpi/versions/${draft.version.id}`, {}, cookie)).data;
  const criterion = detail.criteria[0];
  if (!criterion) throw new Error("Editable DRAFT version has no criterion to proof.");

  const mutation = await request(`/api/organizations/${organizationId}/kpi/criteria/${criterion.id}`, {
    method: "PATCH",
    body: JSON.stringify({ description: criterion.description }),
  }, cookie);
  if (!mutation.requestId) throw new Error("KPI criterion mutation returned no requestId.");

  const audit = (await request(`/api/organizations/${organizationId}/audit?limit=100`, {}, cookie)).data;
  const event = audit.find((item) => item.action === "KPI_CRITERION_UPDATED" && item.requestId === mutation.requestId && item.entityId === criterion.id);
  if (!event) throw new Error("Audit API did not return KPI_CRITERION_UPDATED with matching requestId.");
  if (event.actorUserId !== verifierUserId) throw new Error("KPI configuration audit event actor reference is incorrect.");
  if (event.metadata?.actor?.email !== verifierEmail) throw new Error("KPI configuration audit actor snapshot is missing.");

  let actorHardDeleteBlocked = false;
  try {
    await sql`delete from users where id = ${verifierUserId}`;
  } catch (error) {
    actorHardDeleteBlocked = String(error?.message ?? error).toLowerCase().includes("foreign key") || String(error?.message ?? error).includes("audit_events_actor_user_id_fkey");
  }
  if (!actorHardDeleteBlocked) throw new Error("Audited KPI configuration actor hard-delete was not blocked.");
  await sql`update users set active = false, updated_at = now() where id = ${verifierUserId}`;

  console.log(JSON.stringify({
    loginStatus: login.response.status,
    organizationId,
    draftVersion: `${draft.template.name} v${draft.version.version}`,
    criterionId: criterion.id,
    auditedAction: event.action,
    requestIdCorrelation: event.requestId === mutation.requestId,
    actorReferencePreserved: event.actorUserId === verifierUserId,
    actorSnapshotPreserved: event.metadata.actor.email === verifierEmail,
    auditedActorHardDeleteBlocked: actorHardDeleteBlocked,
    auditedActorDeactivated: true,
  }, null, 2));
} finally {
  if (verifierUserId) await sql`update users set active = false, updated_at = now() where id = ${verifierUserId}`.catch(() => undefined);
  await sql.end({ timeout: 2 });
}
