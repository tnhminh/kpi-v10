import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import postgres from "postgres";

if (process.env.NODE_ENV === "production") throw new Error("Real Jira proof is disabled against production runtime/data.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const required = ["JIRA_REAL_WORKSPACE_URL", "JIRA_REAL_JQL", "JIRA_BACKEND_CREDENTIALS"];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  throw new Error(`Real Jira proof BLOCKED_EXTERNAL: missing ${missing.join(", ")}. No credential values were read or printed.`);
}

const appUrl = process.env.APP_URL || "http://localhost:3712";
const workspaceUrl = new URL(process.env.JIRA_REAL_WORKSPACE_URL);
if (workspaceUrl.protocol !== "https:") throw new Error("JIRA_REAL_WORKSPACE_URL must use HTTPS.");
const boundedJql = process.env.JIRA_REAL_JQL.trim();
if (boundedJql.length > 4000) throw new Error("JIRA_REAL_JQL exceeds the supported 4000-character limit.");
if (/^order\s+by\b/i.test(boundedJql)) {
  throw new Error("JIRA_REAL_JQL must constrain the dataset; an ORDER BY-only query is not accepted by the production verifier.");
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5, prepare: false });
const suffix = randomBytes(8).toString("hex");
const email = `jira-real-proof-${suffix}@kpi.local`;
const password = `JiraProof-${randomBytes(24).toString("base64url")}-Aa1!`;
let userId = null;
let connectionId = null;

function derive(value, salt) {
  return new Promise((resolve, reject) => {
    nodeScrypt(value, salt, 64, { N: 131_072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error); else resolve(Buffer.from(key));
    });
  });
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
  if (!response.ok) {
    const code = payload?.error?.code || `HTTP_${response.status}`;
    const message = payload?.error?.message || "Request failed.";
    throw new Error(`${init.method || "GET"} ${path} -> ${response.status} ${code}: ${message}`);
  }
  return { response, data: payload?.data, requestId: payload?.requestId ?? null };
}

try {
  const [organization] = await sql`
    SELECT id
    FROM organizations
    ORDER BY CASE WHEN slug = 'kpi-local' THEN 0 ELSE 1 END, created_at
    LIMIT 1
  `;
  if (!organization) throw new Error("A local organization is required for the real Jira proof.");

  const passwordHash = await hashPassword(password);
  const [user] = await sql`
    INSERT INTO users (email, display_name, password_hash, role, active, password_change_required, password_changed_at)
    VALUES (${email}, 'Real Jira Proof Administrator', ${passwordHash}, 'ADMINISTRATOR', true, false, now())
    RETURNING id
  `;
  userId = user.id;
  await sql`
    INSERT INTO user_organization_access (user_id, organization_id, role, active)
    VALUES (${userId}, ${organization.id}, 'ADMINISTRATOR', true)
  `;

  const login = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const cookie = (login.response.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie) throw new Error("Real Jira proof login did not return a session cookie.");

  const proofUrl = new URL(workspaceUrl.origin);
  proofUrl.searchParams.set("kpi-proof", suffix);
  const created = await request(`/api/organizations/${organization.id}/jira/connections`, {
    method: "POST",
    body: JSON.stringify({
      workspaceUrl: proofUrl.toString(),
      secretRef: "env:JIRA_BACKEND_CREDENTIALS",
      syncConfig: { jql: boundedJql, fields: [], factMappings: {} },
    }),
  }, cookie);
  connectionId = created.data.id;

  const synced = await request(`/api/organizations/${organization.id}/jira/connections/${connectionId}/sync`, { method: "POST" }, cookie);
  const run = synced.data;
  if (run.status !== "SUCCEEDED") throw new Error(`Real Jira run ended in unexpected state ${run.status}.`);
  if (!Number.isInteger(run.pagesFetched) || run.pagesFetched <= 0) throw new Error("Real Jira run did not fetch a page.");
  if (!Number.isInteger(run.issuesSeen) || run.issuesSeen <= 0) throw new Error("Real Jira bounded query returned no issues; provide a bounded JQL with at least one known issue for release proof.");

  const [persisted] = await sql`
    SELECT
      count(distinct ji.id)::int AS issues,
      count(jif.id)::int AS facts
    FROM jira_issues ji
    LEFT JOIN jira_issue_facts jif ON jif.jira_issue_id = ji.id
    WHERE ji.connection_id = ${connectionId}
  `;
  if (persisted.issues <= 0 || persisted.facts <= 0) throw new Error("Real Jira issues/facts were not persisted after a successful sync.");

  const [auditLeak] = await sql`
    SELECT count(*)::int AS count
    FROM audit_events
    WHERE actor_user_id = ${userId}
      AND (
        coalesce(before::text, '') ILIKE '%apiToken%'
        OR coalesce(after::text, '') ILIKE '%apiToken%'
        OR coalesce(metadata::text, '') ILIKE '%apiToken%'
        OR coalesce(before::text, '') ILIKE '%JIRA_BACKEND_CREDENTIALS%'
        OR coalesce(after::text, '') ILIKE '%JIRA_BACKEND_CREDENTIALS%'
        OR coalesce(metadata::text, '') ILIKE '%JIRA_BACKEND_CREDENTIALS%'
      )
  `;
  if (auditLeak.count !== 0) throw new Error("Credential material/reference unexpectedly appeared in Jira proof audit payload.");

  console.log(JSON.stringify({
    status: "ok",
    organizationId: organization.id,
    workspaceOrigin: workspaceUrl.origin,
    loginStatus: login.response.status,
    connectionCreated: true,
    syncStatus: run.status,
    pagesFetched: run.pagesFetched,
    issuesSeen: run.issuesSeen,
    issuesMapped: run.issuesMapped,
    issuesUnmapped: run.issuesUnmapped,
    persistedIssues: persisted.issues,
    persistedFacts: persisted.facts,
    credentialMaterialInAudit: false,
  }, null, 2));
} finally {
  if (connectionId) {
    try { await sql`DELETE FROM jira_connections WHERE id = ${connectionId}`; }
    catch (error) { console.error(`Real Jira proof connection cleanup warning: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (userId) {
    try {
      await sql`UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = ${userId}`;
      await sql`UPDATE user_organization_access SET active = false, updated_at = now() WHERE user_id = ${userId}`;
      await sql`UPDATE users SET active = false, updated_at = now() WHERE id = ${userId}`;
    } catch (error) {
      console.error(`Real Jira proof identity cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await sql.end({ timeout: 2 });
}
