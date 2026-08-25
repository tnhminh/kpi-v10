const appUrl = process.env.APP_URL || "http://localhost:3712";
const email = (process.env.DEV_ADMIN_EMAIL || "admin@kpi.local").trim().toLowerCase();
const password = process.env.DEV_ADMIN_PASSWORD;

if (process.env.NODE_ENV === "production") throw new Error("Local demo evaluation runner is disabled in production.");
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

const login = await request("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ email, password }),
});
const cookie = (login.response.headers.get("set-cookie") || "").split(";")[0];
if (!cookie) throw new Error("Login did not return a session cookie.");

const organizations = (await request("/api/organizations", {}, cookie)).data;
const organization = organizations[0];
if (!organization) throw new Error("No organization access was returned.");
const organizationId = organization.organizationId;

let periods = (await request(`/api/organizations/${organizationId}/evaluation/periods`, {}, cookie)).data;
let period = periods.find((item) => item.key === "2026-09") || periods[0];
if (!period) throw new Error("No evaluation period exists.");

const assignments = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/assignments`, {}, cookie)).data;
if (!assignments.length) throw new Error("Evaluation period has no KPI assignments.");

if (period.status === "UPCOMING") {
  await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/lifecycle`, {
    method: "POST",
    body: JSON.stringify({ action: "START_COLLECTION" }),
  }, cookie);
  periods = (await request(`/api/organizations/${organizationId}/evaluation/periods`, {}, cookie)).data;
  period = periods.find((item) => item.id === period.id);
}
if (!period || !["COLLECTING", "SYSTEM_EVALUATED"].includes(period.status)) {
  throw new Error(`Period '${period?.key ?? "unknown"}' cannot run system evaluation from status '${period?.status ?? "missing"}'.`);
}

const version = (await request(`/api/organizations/${organizationId}/kpi/versions/${assignments[0].kpiVersionId}`, {}, cookie)).data;
const criteriaByName = new Map(version.criteria.map((criterion) => [criterion.name, criterion]));
for (const required of ["Delivery", "Code Quality", "Incident Support", "Proactive Detection", "Documentation"]) {
  if (!criteriaByName.has(required)) throw new Error(`Demo KPI criterion '${required}' was not found.`);
}

const members = (await request(`/api/organizations/${organizationId}/members`, {}, cookie)).data.filter((member) => member.active);
const rows = members.map((member, index) => {
  const delivery = 88 + (index % 8);
  const quality = 3 + (index % 6);
  const incident = 70 + ((index * 7) % 50);
  const proactive = 2 + (index % 4);
  const completedOnTime = Math.round(50 * delivery / 100);
  const reopened = Math.max(1, Math.round(40 * quality / 100));
  const deliberatelyIncomplete = member.employeeId === "BE-1098";

  return {
    memberId: member.id,
    criteria: [
      {
        criterionId: criteriaByName.get("Delivery").id,
        inputFacts: deliberatelyIncomplete ? { completedOnTime: 39 } : { committed: 50, completedOnTime },
        metric: deliberatelyIncomplete ? { value: null, variables: { completedOnTime: 39 } } : { value: delivery, variables: { committed: 50, completedOnTime } },
        confidence: "HIGH",
        evidence: deliberatelyIncomplete ? [] : [{ type: "JIRA", sourceRef: `DEMO-${member.employeeId}-DELIVERY`, title: "Delivery evidence", payload: { source: "local-demo" } }],
      },
      {
        criterionId: criteriaByName.get("Code Quality").id,
        inputFacts: { resolved: 40, reopened },
        metric: { value: quality, variables: { resolved: 40, reopened } },
        confidence: "HIGH",
        evidence: [{ type: "JIRA", sourceRef: `DEMO-${member.employeeId}-QUALITY`, title: "Quality evidence", payload: { source: "local-demo" } }],
      },
      {
        criterionId: criteriaByName.get("Incident Support").id,
        inputFacts: { startedAt: "2026-09-10T10:00:00Z", resolvedAt: "2026-09-10T12:00:00Z" },
        metric: { value: incident, variables: {} },
        confidence: incident > 105 ? "MEDIUM" : "HIGH",
        evidence: [{ type: "JIRA", sourceRef: `DEMO-${member.employeeId}-INCIDENT`, title: "Incident evidence", payload: { source: "local-demo" } }],
      },
      {
        criterionId: criteriaByName.get("Proactive Detection").id,
        inputFacts: { detections: proactive },
        metric: { value: proactive, variables: { detections: proactive } },
        confidence: "HIGH",
        evidence: [{ type: "JIRA", sourceRef: `DEMO-${member.employeeId}-PROACTIVE`, title: "Proactive evidence", payload: { source: "local-demo" } }],
      },
      {
        criterionId: criteriaByName.get("Documentation").id,
        inputFacts: {},
        confidence: "REVIEW_REQUIRED",
        evidence: [{ type: "MANUAL", sourceRef: `DEMO-${member.employeeId}-DOCS`, title: "Documentation review placeholder", payload: { source: "local-demo" } }],
      },
    ],
  };
});

const evaluation = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/evaluate`, {
  method: "POST",
  body: JSON.stringify({ members: rows }),
}, cookie)).data;

const persisted = (await request(`/api/organizations/${organizationId}/evaluation/periods/${period.id}/evaluations`, {}, cookie)).data;
const refreshedPeriod = (await request(`/api/organizations/${organizationId}/evaluation/periods`, {}, cookie)).data.find((item) => item.id === period.id);
const criticalMembers = persisted.filter((item) => item.qualityIssues.some((issue) => issue.severity === "CRITICAL")).length;
const scoredCriteria = persisted.reduce((sum, item) => sum + item.criteria.filter((criterion) => criterion.systemScore !== null).length, 0);

console.log(JSON.stringify({
  loginStatus: login.response.status,
  organization: organization.organizationName,
  period: refreshedPeriod?.key,
  periodStatus: refreshedPeriod?.status,
  assignments: assignments.length,
  membersSent: rows.length,
  results: evaluation.results.length,
  progress: evaluation.progress,
  persistedEvaluations: persisted.length,
  scoredCriteria,
  criticalMembers,
  sample: persisted.slice(0, 2).map((item) => ({
    member: item.memberName,
    team: item.teamName,
    kpiVersion: `${item.templateName} v${item.version}`,
    systemScore: item.systemScore,
    confidence: item.confidence,
    criterionCount: item.criteria.length,
    qualityIssueCount: item.qualityIssues.length,
  })),
}, null, 2));
