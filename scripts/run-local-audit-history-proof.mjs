import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import postgres from "postgres";

const appUrl = process.env.APP_URL || "http://localhost:3712";
const databaseUrl = process.env.DATABASE_URL;
const verifierEmail = "audit-proof@kpi.local";
const verifierPassword = `Proof-${randomBytes(18).toString("base64url")}`;

if (process.env.NODE_ENV === "production") throw new Error("Local audit/history proof is disabled in production.");
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
  return { response, payload, data: payload?.data, requestId: payload?.requestId ?? null };
}

async function mutationBlocked(sql, statement) {
  try {
    await sql.unsafe(statement);
    return false;
  } catch (error) {
    return String(error?.message ?? error).includes("audit_events is append-only");
  }
}

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, prepare: false });
let verifierUserId = null;
let auditEventId = null;

try {
  const organizationRows = await sql`select id from organizations where slug = 'kpi-local' limit 1`;
  if (!organizationRows[0]) throw new Error("Local organization 'kpi-local' is missing.");
  const organizationId = organizationRows[0].id;

  const passwordHash = await hashPassword(verifierPassword);
  const verifierRows = await sql`
    insert into users (email, display_name, password_hash, role, active)
    values (${verifierEmail}, 'Audit History Proof', ${passwordHash}, 'ADMINISTRATOR', true)
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

  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: verifierEmail, password: verifierPassword }),
  });
  const cookie = (login.response.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie) throw new Error("Verifier login did not return a session cookie.");

  const connections = (await request(`/api/organizations/${organizationId}/jira/connections`, {}, cookie)).data;
  const connection = connections[0];
  if (!connection) throw new Error("A local Jira demo connection is required. Run db:seed:jira-demo first.");
  const mappings = (await request(`/api/organizations/${organizationId}/jira/connections/${connection.id}/mappings`, {}, cookie)).data;
  if (!mappings.length) throw new Error("Jira member mappings are required for the audit proof.");

  const mappingMutation = await request(`/api/organizations/${organizationId}/jira/connections/${connection.id}/mappings`, {
    method: "PUT",
    body: JSON.stringify({ mappings: mappings.map((item) => ({
      memberId: item.memberId,
      jiraAccountId: item.jiraAccountId,
      jiraDisplayName: item.jiraDisplayName,
    })) }),
  }, cookie);
  if (!mappingMutation.requestId) throw new Error("Audited mapping mutation did not return a requestId.");

  const auditResponse = await request(`/api/organizations/${organizationId}/audit?limit=50`, {}, cookie);
  const auditEvent = auditResponse.data.find((item) => item.action === "JIRA_MEMBER_MAPPINGS_REPLACED" && item.requestId === mappingMutation.requestId);
  if (!auditEvent) throw new Error("Audit API did not return the mapping mutation with matching requestId.");
  auditEventId = auditEvent.id;

  const actorSnapshot = auditEvent.metadata?.actor;
  if (!actorSnapshot || actorSnapshot.email !== verifierEmail || actorSnapshot.displayName !== "Audit History Proof") {
    throw new Error("Audit event did not persist the actor identity snapshot.");
  }
  if (auditEvent.metadata?.logicallyIdempotent !== true) throw new Error("Idempotent Jira mapping proof unexpectedly changed logical mapping data.");

  const history = (await request(`/api/organizations/${organizationId}/analytics/history`, {}, cookie)).data;
  if (history.scope !== "ORGANIZATION") throw new Error("Administrator history scope must be ORGANIZATION.");
  if (history.summary.totalCount < history.summary.validCount) throw new Error("Historical analytics coverage is invalid.");
  if (history.summary.validCount <= 0) throw new Error("Historical analytics proof expected at least one finalized/locked local evaluation.");

  const updateBlocked = await mutationBlocked(sql, `update audit_events set action = 'TAMPERED' where id = '${auditEventId}'`);
  const deleteBlocked = await mutationBlocked(sql, `delete from audit_events where id = '${auditEventId}'`);
  if (!updateBlocked || !deleteBlocked) throw new Error("PostgreSQL append-only guard did not block audit mutation.");

  let actorDeleteBlocked = false;
  try {
    await sql`delete from users where id = ${verifierUserId}`;
  } catch (error) {
    actorDeleteBlocked = String(error?.message ?? error).toLowerCase().includes("foreign key") || String(error?.message ?? error).includes("audit_events_actor_user_id_fkey");
  }
  if (!actorDeleteBlocked) throw new Error("Audited actor hard-delete was not blocked by PostgreSQL.");
  await sql`update users set active = false, updated_at = now() where id = ${verifierUserId}`;

  const retainedRows = await sql`
    select actor_user_id, metadata
    from audit_events
    where id = ${auditEventId}
    limit 1
  `;
  const retained = retainedRows[0];
  if (!retained) throw new Error("Audit event disappeared after verifier deactivation.");
  if (retained.actor_user_id !== verifierUserId) throw new Error("Audit actor reference changed after verifier deactivation.");
  if (retained.metadata?.actor?.email !== verifierEmail || retained.metadata?.actor?.displayName !== "Audit History Proof") {
    throw new Error("Audit actor snapshot was not preserved after verifier deactivation.");
  }

  console.log(JSON.stringify({
    loginStatus: login.response.status,
    organizationId,
    auditedAction: auditEvent.action,
    requestIdCorrelation: auditEvent.requestId === mappingMutation.requestId,
    logicallyIdempotentMutation: auditEvent.metadata.logicallyIdempotent,
    appendOnlyUpdateBlocked: updateBlocked,
    appendOnlyDeleteBlocked: deleteBlocked,
    auditedActorHardDeleteBlocked: actorDeleteBlocked,
    auditedActorDeactivated: true,
    actorReferencePreservedAfterDeactivation: retained.actor_user_id === verifierUserId,
    actorSnapshotPreservedAfterDeactivation: retained.metadata.actor.email === verifierEmail,
    historyScope: history.scope,
    historicalScore: history.summary.score,
    historicalValidCount: history.summary.validCount,
    historicalTotalCount: history.summary.totalCount,
    historicalCoverage: history.summary.coverageLabel,
  }, null, 2));
} finally {
  if (verifierUserId) await sql`update users set active = false, updated_at = now() where id = ${verifierUserId}`.catch(() => undefined);
  await sql.end({ timeout: 2 });
}
