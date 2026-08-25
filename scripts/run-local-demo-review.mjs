const appUrl = process.env.APP_URL || "http://localhost:3712";
const email = (process.env.DEV_ADMIN_EMAIL || "admin@kpi.local").trim().toLowerCase();
const password = process.env.DEV_ADMIN_PASSWORD;

if (process.env.NODE_ENV === "production") throw new Error("Local review runner is disabled in production.");
if (!password) throw new Error("DEV_ADMIN_PASSWORD is required.");

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

async function requestExpectedFailure(path, init, cookie, expectedCode) {
  const headers = new Headers(init.headers);
  headers.set("Origin", appUrl);
  headers.set("Sec-Fetch-Site", "same-origin");
  headers.set("Content-Type", "application/json");
  headers.set("Cookie", cookie);
  const response = await fetch(`${appUrl}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => null);
  if (response.ok) throw new Error(`${init.method || "GET"} ${path} unexpectedly succeeded.`);
  if (payload?.error?.code !== expectedCode) throw new Error(`${init.method || "GET"} ${path} failed with unexpected code: ${JSON.stringify(payload)}`);
  return { status: response.status, code: payload.error.code };
}

const login = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
const cookie = (login.response.headers.get("set-cookie") || "").split(";")[0];
if (!cookie) throw new Error("Login did not return a session cookie.");
const organization = (await request("/api/organizations", {}, cookie)).data[0];
if (!organization) throw new Error("No organization access was returned.");
const organizationId = organization.organizationId;

const periods = (await request(`/api/organizations/${organizationId}/evaluation/periods`, {}, cookie)).data;
const period = periods.find((item) => item.key === "2026-09") || periods[0];
if (!period) throw new Error("No evaluation period exists.");
if (!["SYSTEM_EVALUATED", "LEADER_REVIEW", "HEAD_REVIEW", "FINALIZED", "LOCKED"].includes(period.status)) {
  throw new Error(`Review runner requires a system-evaluated-or-later period, got '${period.status}'.`);
}

let evaluations = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/review-queue?layer=LEADER`, {}, cookie)).data;
if (!evaluations.length) throw new Error("Review queue is empty.");

let leaderCompleted = 0;
for (const evaluation of evaluations) {
  if (evaluation.status !== "SYSTEM_EVALUATED") continue;
  const adjustments = evaluation.criteria
    .filter((criterion) => criterion.systemScore === null)
    .map((criterion) => ({
      criterionEvaluationId: criterion.id,
      score: Number((criterion.maxScore * 0.8).toFixed(2)),
      reason: criterion.criterionName === "Documentation"
        ? "Local demo: reviewer verified the manual documentation evidence."
        : "Local demo: reviewer supplied a bounded human score because the system input was not evaluable.",
    }));
  await request(`/api/organizations/${organizationId}/evaluation/evaluations/${evaluation.id}/leader-review`, {
    method: "POST",
    body: JSON.stringify({ adjustments }),
  }, cookie);
  leaderCompleted += 1;
}

let refreshedPeriod = (await request(`/api/organizations/${organizationId}/evaluation/periods`, {}, cookie)).data.find((item) => item.id === period.id);
if (refreshedPeriod?.status !== "HEAD_REVIEW" && refreshedPeriod?.status !== "FINALIZED" && refreshedPeriod?.status !== "LOCKED") {
  throw new Error(`Expected period HEAD_REVIEW after Leader completion, got '${refreshedPeriod?.status}'.`);
}

evaluations = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/review-queue?layer=DEPARTMENT_HEAD`, {}, cookie)).data;
let headCompleted = 0;
for (const evaluation of evaluations) {
  if (evaluation.status !== "LEADER_REVIEW") continue;
  await request(`/api/organizations/${organizationId}/evaluation/evaluations/${evaluation.id}/head-review`, {
    method: "POST",
    body: JSON.stringify({ adjustments: [] }),
  }, cookie);
  headCompleted += 1;
}

evaluations = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/review-queue?layer=DEPARTMENT_HEAD`, {}, cookie)).data;
const critical = evaluations.filter((evaluation) => evaluation.qualityIssues.some((issue) => issue.severity === "CRITICAL" && !issue.resolvedAt));
const nonCritical = evaluations.filter((evaluation) => !evaluation.qualityIssues.some((issue) => issue.severity === "CRITICAL" && !issue.resolvedAt));
let finalized = 0;
for (const evaluation of nonCritical) {
  if (evaluation.status !== "HEAD_REVIEW") continue;
  await request(`/api/organizations/${organizationId}/evaluation/evaluations/${evaluation.id}/finalize`, {
    method: "POST",
    body: JSON.stringify({}),
  }, cookie);
  finalized += 1;
}

let criticalFinalizeBlock = null;
const criticalCandidate = critical.find((evaluation) => evaluation.status === "HEAD_REVIEW");
if (criticalCandidate) {
  criticalFinalizeBlock = await requestExpectedFailure(`/api/organizations/${organizationId}/evaluation/evaluations/${criticalCandidate.id}/finalize`, {
    method: "POST",
    body: JSON.stringify({}),
  }, cookie, "REVIEW_LIFECYCLE_CONFLICT");
}

evaluations = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/review-queue?layer=DEPARTMENT_HEAD`, {}, cookie)).data;
let lockResult = null;
const finalizedCandidate = evaluations.find((evaluation) => evaluation.status === "FINALIZED");
if (finalizedCandidate) {
  lockResult = (await request(`/api/organizations/${organizationId}/evaluation/evaluations/${finalizedCandidate.id}/lock`, {
    method: "POST",
    body: JSON.stringify({}),
  }, cookie)).data;
} else {
  const locked = evaluations.find((evaluation) => evaluation.status === "LOCKED");
  if (!locked) throw new Error("No finalized or locked evaluation is available for the lock verification.");
}

const finalEvaluations = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/review-queue?layer=DEPARTMENT_HEAD`, {}, cookie)).data;
refreshedPeriod = (await request(`/api/organizations/${organizationId}/evaluation/periods`, {}, cookie)).data.find((item) => item.id === period.id);
const counts = Object.fromEntries(["SYSTEM_EVALUATED", "LEADER_REVIEW", "HEAD_REVIEW", "FINALIZED", "LOCKED"].map((status) => [status, finalEvaluations.filter((item) => item.status === status).length]));

if (leaderCompleted > 0 && !finalEvaluations.every((item) => item.status !== "SYSTEM_EVALUATED")) throw new Error("Leader review did not advance every eligible evaluation.");
if (critical.length > 0 && !criticalFinalizeBlock && critical.some((item) => item.status === "HEAD_REVIEW")) throw new Error("Critical finalization block was not verified.");
if (lockResult && !/^[a-f0-9]{64}$/.test(lockResult.checksum)) throw new Error("Lock response checksum is not a SHA-256 hex digest.");

console.log(JSON.stringify({
  loginStatus: login.response.status,
  organization: organization.organizationName,
  period: refreshedPeriod?.key,
  periodStatus: refreshedPeriod?.status,
  evaluations: finalEvaluations.length,
  leaderCompleted,
  headCompleted,
  finalizedThisRun: finalized,
  unresolvedCriticalMembers: critical.length,
  criticalFinalizeBlock,
  statusCounts: counts,
  lock: lockResult ? {
    status: lockResult.status,
    snapshotId: lockResult.snapshotId,
    checksumLength: lockResult.checksum.length,
    checksumPrefix: lockResult.checksum.slice(0, 12),
  } : { status: "already-locked" },
}, null, 2));
