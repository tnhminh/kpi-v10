import { createHash } from "node:crypto";
import postgres from "postgres";

const appUrl = process.env.APP_URL || "http://localhost:3712";
const email = (process.env.DEV_ADMIN_EMAIL || "admin@kpi.local").trim().toLowerCase();
const password = process.env.DEV_ADMIN_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;

if (process.env.NODE_ENV === "production") throw new Error("Local T07 verification is disabled in production.");
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

function reasonForCriterion(criterion) {
  return `Local T07 verification: human review supplies a justified score for ${criterion.criterionName} because the previous layer is NOT_EVALUATED.`;
}

function fillMissingPrevious(criteria, previousKey) {
  return criteria.flatMap((criterion) => {
    if (criterion[previousKey] !== null) return [];
    const score = Math.round(Math.min(criterion.maxScore, criterion.maxScore * 0.8) * 100) / 100;
    return [{ criterionEvaluationId: criterion.id, score, reason: reasonForCriterion(criterion) }];
  });
}

async function expectDbBlock(label, work) {
  let blocked = false;
  try {
    await sql.begin(work);
  } catch (error) {
    blocked = true;
    console.log(`${label}=BLOCKED:${error?.code ?? "unknown"}`);
  }
  if (!blocked) throw new Error(`${label} was unexpectedly allowed.`);
}

const login = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
const cookie = (login.response.headers.get("set-cookie") || "").split(";")[0];
if (!cookie) throw new Error("Login did not return a session cookie.");

const organizations = (await request("/api/organizations", {}, cookie)).data;
const organization = organizations[0];
if (!organization) throw new Error("No organization access was returned.");
const organizationId = organization.organizationId;

const periods = (await request(`/api/organizations/${organizationId}/evaluation/periods`, {}, cookie)).data;
const period = periods.find((item) => item.key === "2026-09") || periods[0];
if (!period) throw new Error("No evaluation period exists.");
if (!["SYSTEM_EVALUATED", "LEADER_REVIEW", "HEAD_REVIEW", "FINALIZED", "LOCKED"].includes(period.status)) {
  throw new Error(`T07 verification requires a system-evaluated-or-later period; found ${period.status}.`);
}

let leaderQueue = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/review-queue?layer=LEADER`, {}, cookie)).data;
for (const member of leaderQueue) {
  if (member.status !== "SYSTEM_EVALUATED") continue;
  const adjustments = fillMissingPrevious(member.criteria, "systemScore");
  await request(`/api/organizations/${organizationId}/evaluation/evaluations/${member.id}/leader-review`, {
    method: "POST",
    body: JSON.stringify({ adjustments }),
  }, cookie);
}

let refreshedPeriod = (await request(`/api/organizations/${organizationId}/evaluation/periods`, {}, cookie)).data.find((item) => item.id === period.id);
if (!refreshedPeriod || !["HEAD_REVIEW", "FINALIZED", "LOCKED"].includes(refreshedPeriod.status)) {
  throw new Error(`All Leader reviews should open Head review; period is ${refreshedPeriod?.status ?? "missing"}.`);
}

let headQueue = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/review-queue?layer=DEPARTMENT_HEAD`, {}, cookie)).data;
let target = headQueue.find((member) => member.status === "LEADER_REVIEW" && member.qualityIssues.some((issue) => issue.severity === "CRITICAL" && !issue.resolvedAt));
if (!target) target = headQueue.find((member) => member.status === "LEADER_REVIEW") || headQueue.find((member) => member.status === "HEAD_REVIEW") || headQueue.find((member) => member.status === "FINALIZED") || headQueue.find((member) => member.status === "LOCKED");
if (!target) throw new Error("No member is available for Head review/finalize/lock verification.");

if (target.status === "LEADER_REVIEW") {
  const adjustments = fillMissingPrevious(target.criteria, "leaderScore");
  await request(`/api/organizations/${organizationId}/evaluation/evaluations/${target.id}/head-review`, {
    method: "POST",
    body: JSON.stringify({ adjustments }),
  }, cookie);
}

headQueue = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/review-queue?layer=DEPARTMENT_HEAD`, {}, cookie)).data;
target = headQueue.find((member) => member.id === target.id);
if (!target) throw new Error("Reviewed target disappeared from Head queue.");

for (const issue of target.qualityIssues.filter((item) => item.severity === "CRITICAL" && !item.resolvedAt)) {
  await request(`/api/organizations/${organizationId}/evaluation/quality-issues/${issue.id}/resolve`, {
    method: "POST",
    body: JSON.stringify({ disposition: "WAIVED", reason: "Local T07 verification: source gap inspected and accepted with explicit human review evidence." }),
  }, cookie);
}

headQueue = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/review-queue?layer=DEPARTMENT_HEAD`, {}, cookie)).data;
target = headQueue.find((member) => member.id === target.id);
if (!target) throw new Error("Target disappeared after quality resolution.");

if (target.status === "HEAD_REVIEW") {
  await request(`/api/organizations/${organizationId}/evaluation/evaluations/${target.id}/finalize`, {
    method: "POST",
    body: JSON.stringify({}),
  }, cookie);
}

headQueue = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/review-queue?layer=DEPARTMENT_HEAD`, {}, cookie)).data;
target = headQueue.find((member) => member.id === target.id);
if (!target) throw new Error("Target disappeared after finalization.");

let lockResult = null;
if (target.status === "FINALIZED") {
  lockResult = (await request(`/api/organizations/${organizationId}/evaluation/evaluations/${target.id}/lock`, {
    method: "POST",
    body: JSON.stringify({}),
  }, cookie)).data;
}

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, prepare: false });
try {
  const evaluationRows = await sql`SELECT id, status, final_score, locked_at FROM member_evaluations WHERE id = ${target.id}`;
  const lockedEvaluation = evaluationRows[0];
  if (!lockedEvaluation || lockedEvaluation.status !== "LOCKED") throw new Error(`Expected target to be LOCKED; found ${lockedEvaluation?.status ?? "missing"}.`);

  const snapshots = await sql`SELECT id, payload, checksum, locked_at FROM historical_snapshots WHERE member_evaluation_id = ${target.id}`;
  const snapshot = snapshots[0];
  if (!snapshot) throw new Error("Historical snapshot was not persisted.");
  if (!/^[a-f0-9]{64}$/.test(snapshot.checksum)) throw new Error("Historical snapshot checksum has invalid format.");
  if (lockResult && lockResult.checksum !== snapshot.checksum) throw new Error("API and persisted snapshot checksums differ.");

  const checksumFingerprint = createHash("sha256").update(snapshot.checksum).digest("hex").slice(0, 12);

  const resolvedIssueRows = await sql`
    SELECT id FROM data_quality_issues
    WHERE member_evaluation_id = ${target.id} AND resolved_at IS NOT NULL
    LIMIT 1
  `;
  const resolvedIssueId = resolvedIssueRows[0]?.id ?? null;

  await expectDbBlock("locked_evaluation_mutation", async (tx) => {
    await tx`UPDATE member_evaluations SET final_score = final_score WHERE id = ${target.id}`;
  });
  await expectDbBlock("historical_snapshot_mutation", async (tx) => {
    await tx`UPDATE historical_snapshots SET checksum = checksum WHERE id = ${snapshot.id}`;
  });
  if (resolvedIssueId) {
    await expectDbBlock("resolved_quality_rewrite", async (tx) => {
      await tx`UPDATE data_quality_issues SET resolution_reason = resolution_reason || ' changed' WHERE id = ${resolvedIssueId}`;
    });
  }

  const departmentScopeRows = await sql`SELECT count(*)::int AS count FROM department_head_assignments`;
  refreshedPeriod = (await request(`/api/organizations/${organizationId}/evaluation/periods`, {}, cookie)).data.find((item) => item.id === period.id);
  const finalQueue = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/review-queue?layer=DEPARTMENT_HEAD`, {}, cookie)).data;
  const finalTarget = finalQueue.find((member) => member.id === target.id);

  console.log(JSON.stringify({
    loginStatus: login.response.status,
    organization: organization.organizationName,
    period: refreshedPeriod?.key,
    periodStatus: refreshedPeriod?.status,
    leaderReviewed: finalQueue.filter((item) => ["LEADER_REVIEW", "HEAD_REVIEW", "FINALIZED", "LOCKED"].includes(item.status)).length,
    target: finalTarget ? {
      member: finalTarget.memberName,
      team: finalTarget.teamName,
      status: finalTarget.status,
      finalScore: finalTarget.finalScore,
      finalRank: finalTarget.finalRank,
      resolvedCriticalIssues: finalTarget.qualityIssues.filter((item) => item.severity === "CRITICAL" && item.resolvedAt).length,
    } : { id: target.id, status: lockedEvaluation.status },
    snapshot: { id: snapshot.id, checksumFormat: "sha256-hex", checksumFingerprint },
    departmentHeadAssignments: departmentScopeRows[0]?.count ?? 0,
    integrity: "PASS",
  }, null, 2));
} finally {
  await sql.end({ timeout: 2 });
}
