import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (process.env.NODE_ENV === "production") throw new Error("Local Jira demo seed is disabled in production.");
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, prepare: false });
const workspaceUrl = "https://kpi-demo.atlassian.net";
const project = { id: "10000", key: "KPI", name: "KPI Engineering Demo" };

const factMappings = {
  committed: { type: "CONSTANT", value: 1 },
  completed: { type: "STATUS_IN", field: "status.name", values: ["Done", "Resolved", "Closed"] },
  completedOnTime: { type: "DATE_LTE", leftField: "resolutiondate", rightField: "duedate" },
  reopened: { type: "FIELD", field: "customfield_20001" },
  reopenCount: { type: "FIELD", field: "customfield_20001" },
  resolutionMinutes: { type: "FIELD", field: "customfield_20002" },
  cycleTimeMinutes: { type: "FIELD", field: "customfield_20003" },
  storyPoints: { type: "FIELD", field: "customfield_10016" },
  originalEstimateSeconds: { type: "FIELD", field: "timeoriginalestimate" },
  timeSpentSeconds: { type: "FIELD", field: "timespent" },
  proactiveDetection: { type: "LABEL_PRESENT", field: "labels", label: "proactive-detection" },
  detections: { type: "LABEL_PRESENT", field: "labels", label: "proactive-detection" },
  documentationUpdated: { type: "LABEL_PRESENT", field: "labels", label: "documentation" },
  automationAdded: { type: "LABEL_PRESENT", field: "labels", label: "automation" },
  productionEscape: { type: "FIELD", field: "customfield_20017" },
  reviewIterations: { type: "FIELD", field: "customfield_20012" },
  reworkCount: { type: "FIELD", field: "customfield_20013" },
  slaBreached: { type: "FIELD", field: "customfield_20011" },
  incidentSeverity: { type: "FIELD", field: "customfield_20014" },
  customerImpact: { type: "FIELD", field: "customfield_20015" },
  rollbackRequired: { type: "FIELD", field: "customfield_20016" },
  blockedMinutes: { type: "FIELD", field: "customfield_20018" },
  sprintId: { type: "FIELD", field: "customfield_20019" },
  sprintName: { type: "FIELD", field: "customfield_20020" },
  epicKey: { type: "FIELD", field: "customfield_20021" },
  teamKey: { type: "FIELD", field: "customfield_20022" },
  commitmentScope: { type: "FIELD", field: "customfield_20023" },
  environmentName: { type: "FIELD", field: "customfield_20024" },
};

const syncFields = [
  "description", "reporter", "creator", "priority", "resolution", "created", "duedate", "resolutiondate",
  "labels", "components", "fixVersions", "parent", "subtasks", "issuelinks", "comment", "attachment",
  "customfield_10016", "customfield_10020", "customfield_20001", "customfield_20002", "customfield_20003",
  "customfield_20011", "customfield_20012", "customfield_20013", "customfield_20014", "customfield_20015",
  "customfield_20016", "customfield_20017", "customfield_20018", "customfield_20019", "customfield_20020",
  "customfield_20021", "customfield_20022", "customfield_20023", "customfield_20024", "timeoriginalestimate",
  "timeestimate", "timespent", "timetracking", "progress", "votes", "watches", "workratio", "environment",
];

function iso(day, hour = 9, minute = 0) {
  return `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
}
function dateOnly(day) { return `2026-09-${String(day).padStart(2, "0")}`; }
function addMinutes(start, minutes) { return new Date(Date.parse(start) + minutes * 60_000).toISOString(); }
function jiraUser(accountId, name, email) {
  return { accountId, accountType: "atlassian", displayName: name, emailAddress: email, active: true, timeZone: "Asia/Ho_Chi_Minh" };
}
function adf(text) {
  return { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}
function statusObject(name) {
  const done = ["Done", "Resolved", "Closed"].includes(name);
  return { id: done ? "10002" : name === "In Progress" ? "10001" : "10000", name, statusCategory: { id: done ? 3 : name === "In Progress" ? 4 : 2, key: done ? "done" : name === "In Progress" ? "indeterminate" : "new", name: done ? "Done" : name === "In Progress" ? "In Progress" : "To Do" } };
}
function issueTypeObject(name) {
  const ids = { Story: "10001", Task: "10002", Bug: "10004", Incident: "10005" };
  return { id: ids[name] ?? "10002", name, subtask: false, hierarchyLevel: 0 };
}
function normalizeFacts(issue) {
  const f = issue.fields;
  const terminal = ["Done", "Resolved", "Closed"].includes(f.status?.name);
  const left = f.resolutiondate ? Date.parse(f.resolutiondate) : NaN;
  const right = f.duedate ? Date.parse(`${f.duedate}T23:59:59Z`) : NaN;
  const hasLabel = (label) => Array.isArray(f.labels) ? (f.labels.some((value) => String(value).toLowerCase() === label) ? 1 : 0) : null;
  return {
    issueKey: issue.issueKey,
    issueType: issue.issueType,
    status: issue.status,
    updatedAt: issue.updatedAt,
    assigneeAccountId: issue.assigneeAccountId,
    committed: 1,
    completed: terminal ? 1 : 0,
    completedOnTime: Number.isFinite(left) && Number.isFinite(right) ? (left <= right ? 1 : 0) : null,
    reopened: f.customfield_20001 ?? null,
    reopenCount: f.customfield_20001 ?? null,
    resolutionMinutes: f.customfield_20002 ?? null,
    cycleTimeMinutes: f.customfield_20003 ?? null,
    storyPoints: f.customfield_10016 ?? null,
    originalEstimateSeconds: f.timeoriginalestimate ?? null,
    timeSpentSeconds: f.timespent ?? null,
    proactiveDetection: hasLabel("proactive-detection"), detections: hasLabel("proactive-detection"),
    documentationUpdated: hasLabel("documentation"), automationAdded: hasLabel("automation"),
    productionEscape: f.customfield_20017 ?? null,
    reviewIterations: f.customfield_20012 ?? null,
    reworkCount: f.customfield_20013 ?? null,
    slaBreached: f.customfield_20011 ?? null,
    incidentSeverity: f.customfield_20014 ?? null,
    customerImpact: f.customfield_20015 ?? null,
    rollbackRequired: f.customfield_20016 ?? null,
    blockedMinutes: f.customfield_20018 ?? null,
    sprintId: f.customfield_20019 ?? null,
    sprintName: f.customfield_20020 ?? null,
    epicKey: f.customfield_20021 ?? null,
    teamKey: f.customfield_20022 ?? null,
    commitmentScope: f.customfield_20023 ?? null,
    environmentName: f.customfield_20024 ?? null,
  };
}
function attribution(issue, memberId) {
  return {
    source: "JIRA",
    demoSeed: true,
    issueKey: issue.issueKey,
    mappedMemberId: memberId,
    assigneeAccountId: issue.assigneeAccountId,
    mappings: Object.fromEntries(Object.entries(factMappings).map(([key, rule]) => [key, rule.type === "DATE_LTE" ? { transform: rule.type, fields: [rule.leftField, rule.rightField] } : rule.type === "CONSTANT" ? { transform: rule.type } : { transform: rule.type, field: rule.field ?? null } ])),
  };
}
function buildIssue(member, memberIndex, slot) {
  const accountId = `demo-${member.employee_id.toLowerCase()}`;
  const startDay = 2 + ((memberIndex * 2 + slot * 3) % 18);
  const created = iso(startDay, 8 + (slot % 5));
  const dueDay = Math.min(28, startDay + 4 + (slot % 3));
  const sprintNo = 18 + Math.floor((startDay - 1) / 14);
  const common = {
    assignee: jiraUser(accountId, member.name, member.email),
    reporter: jiraUser("demo-product-owner", "Demo Product Owner", "product.owner@kpi.local"),
    creator: jiraUser("demo-product-owner", "Demo Product Owner", "product.owner@kpi.local"),
    project,
    created,
    updated: addMinutes(created, 60 * (24 + memberIndex + slot)),
    duedate: dateOnly(dueDay),
    labels: ["kpi-demo", "committed", member.team_name.toLowerCase().replace(/[^a-z0-9]+/g, "-")],
    components: [{ id: `2${memberIndex % 6}001`, name: `${member.team_name} Platform` }],
    fixVersions: [{ id: `3${sprintNo}`, name: `2026.09.${sprintNo}`, released: false, archived: false }],
    customfield_10020: [{ id: sprintNo, name: `Sprint ${sprintNo}`, state: sprintNo === 19 ? "active" : "closed", startDate: iso(sprintNo === 18 ? 1 : 15), endDate: iso(sprintNo === 18 ? 14 : 30), boardId: 42 }],
    customfield_20012: 1 + ((memberIndex + slot) % 3),
    customfield_20013: (memberIndex + slot) % 2,
    customfield_20017: 0,
    customfield_20018: ((memberIndex + slot) % 4) * 30,
    customfield_20019: sprintNo,
    customfield_20020: `Sprint ${sprintNo}`,
    customfield_20021: `KPI-EPIC-${1 + (memberIndex % 4)}`,
    customfield_20022: member.team_name,
    customfield_20023: "SPRINT_COMMITMENT",
    customfield_20024: slot === 3 ? "production" : "staging",
    votes: { votes: (memberIndex + slot) % 4, hasVoted: false },
    watches: { watchCount: 2 + ((memberIndex + slot) % 6), isWatching: false },
    environment: slot === 3 ? "Production cluster" : "Staging / CI",
    attachment: [],
    comment: { total: 1, comments: [{ id: `c-${memberIndex}-${slot}`, author: jiraUser(accountId, member.name, member.email), body: adf("Demo engineering evidence comment."), created: addMinutes(created, 120) }] },
  };

  let issueType = "Task", status = "Done", summary = "", resolutionMinutes = 360, storyPoints = 3, reopenCount = 0;
  let resolutiondate = addMinutes(created, resolutionMinutes);
  let priority = { id: "3", name: "Medium" }, resolution = { id: "1", name: "Done" };
  let labels = [...common.labels];
  let severity = null, customerImpact = "NONE", rollbackRequired = 0, slaBreached = 0;

  if (slot === 0) {
    issueType = "Story"; summary = `Deliver ${member.team_name} committed feature`; storyPoints = 5 + (memberIndex % 4) * 2; resolutionMinutes = 900 + memberIndex * 35;
    const late = memberIndex % 4 === 0; resolutiondate = iso(Math.min(29, dueDay + (late ? 2 : -1)), 11); labels.push("feature", "customer-value");
  } else if (slot === 1) {
    issueType = "Task"; summary = `Complete ${member.team_name} maintenance commitment`; storyPoints = 3; resolutionMinutes = 480 + memberIndex * 20;
    if (memberIndex % 5 === 0) { status = "In Progress"; resolution = null; resolutiondate = null; }
    else resolutiondate = iso(Math.min(29, dueDay - (memberIndex % 3 === 0 ? 0 : 1)), 15);
    labels.push("maintenance");
  } else if (slot === 2) {
    issueType = "Bug"; summary = `Fix regression in ${member.team_name} service`; storyPoints = 2 + (memberIndex % 3); reopenCount = memberIndex % 4 === 1 ? 1 : 0;
    resolutionMinutes = 240 + memberIndex * 22; resolutiondate = addMinutes(created, resolutionMinutes); priority = { id: memberIndex % 3 === 0 ? "2" : "3", name: memberIndex % 3 === 0 ? "High" : "Medium" };
    labels.push("bug", reopenCount ? "reopened" : "quality");
    if (memberIndex % 7 === 0) common.customfield_20017 = 1;
  } else if (slot === 3) {
    issueType = "Incident"; summary = `Resolve production incident for ${member.team_name}`; storyPoints = 1; severity = ["P1", "P2", "P3"][memberIndex % 3];
    resolutionMinutes = 45 + memberIndex * 11; resolutiondate = addMinutes(created, resolutionMinutes); slaBreached = resolutionMinutes > (severity === "P1" ? 90 : severity === "P2" ? 150 : 240) ? 1 : 0;
    customerImpact = severity === "P1" ? "HIGH" : severity === "P2" ? "MEDIUM" : "LOW"; rollbackRequired = memberIndex % 6 === 0 ? 1 : 0; priority = { id: severity === "P1" ? "1" : severity === "P2" ? "2" : "3", name: severity === "P1" ? "Highest" : severity === "P2" ? "High" : "Medium" };
    labels.push("incident", "production", `severity-${severity.toLowerCase()}`);
  } else if (slot === 4) {
    issueType = "Task"; summary = `Proactively detect risk in ${member.team_name}`; storyPoints = 2; resolutionMinutes = 210 + memberIndex * 9; resolutiondate = addMinutes(created, resolutionMinutes); labels.push("proactive-detection", "risk-prevention", "observability");
  } else {
    issueType = "Task"; summary = `Improve runbook and automation for ${member.team_name}`; storyPoints = memberIndex === 6 ? null : 3; resolutionMinutes = 300 + memberIndex * 12; resolutiondate = addMinutes(created, resolutionMinutes); labels.push("documentation", "automation", "knowledge-sharing");
  }

  if (member.employee_id === "BE-1098" && slot === 0) common.duedate = null;
  if (member.employee_id === "BE-1124" && slot === 5) storyPoints = null;

  const originalEstimate = storyPoints === null ? null : storyPoints * 4 * 3600;
  const timeSpent = originalEstimate === null ? null : Math.round(originalEstimate * (0.75 + ((memberIndex + slot) % 5) * 0.1));
  const fields = {
    ...common,
    summary,
    description: adf(`${summary}. Generated as production-shaped local Jira evidence for KPI integration testing.`),
    issuetype: issueTypeObject(issueType), status: statusObject(status), priority, resolution,
    resolutiondate, labels, customfield_10016: storyPoints,
    customfield_20001: reopenCount,
    customfield_20002: status === "In Progress" ? null : resolutionMinutes,
    customfield_20003: status === "In Progress" ? null : resolutionMinutes + 90 + ((memberIndex + slot) % 4) * 45,
    customfield_20011: slaBreached,
    customfield_20014: severity,
    customfield_20015: customerImpact,
    customfield_20016: rollbackRequired,
    timeoriginalestimate: originalEstimate,
    timeestimate: status === "In Progress" && originalEstimate ? Math.round(originalEstimate * 0.35) : 0,
    timespent: timeSpent,
    timetracking: { originalEstimate: originalEstimate ? `${Math.round(originalEstimate / 3600)}h` : null, remainingEstimate: status === "In Progress" && originalEstimate ? `${Math.round(originalEstimate * 0.35 / 3600)}h` : "0m", timeSpent: timeSpent ? `${Math.round(timeSpent / 3600)}h` : null, originalEstimateSeconds: originalEstimate, remainingEstimateSeconds: status === "In Progress" && originalEstimate ? Math.round(originalEstimate * 0.35) : 0, timeSpentSeconds: timeSpent },
    progress: { progress: timeSpent ?? 0, total: originalEstimate ?? 0, percent: originalEstimate ? Math.min(100, Math.round((timeSpent ?? 0) / originalEstimate * 100)) : 0 },
    workratio: originalEstimate ? Math.round((timeSpent ?? 0) / originalEstimate * 100) : -1,
    subtasks: [], issuelinks: [], parent: slot === 2 ? { id: `epic-${memberIndex % 4}`, key: `KPI-EPIC-${1 + (memberIndex % 4)}`, fields: { summary: "Engineering Reliability" } } : null,
  };
  return {
    issueKey: `KPIDEMO-${memberIndex * 10 + slot + 1}`,
    summary,
    updatedAt: fields.updated,
    assigneeAccountId: accountId,
    issueType,
    status,
    fields,
  };
}

function anomalyIssues() {
  const base = {
    project, reporter: jiraUser("demo-product-owner", "Demo Product Owner", "product.owner@kpi.local"), creator: jiraUser("demo-product-owner", "Demo Product Owner", "product.owner@kpi.local"),
    issuetype: issueTypeObject("Task"), priority: { id: "3", name: "Medium" }, resolution: { id: "1", name: "Done" }, created: iso(20), updated: iso(22), labels: ["kpi-demo", "data-quality"], components: [], fixVersions: [], customfield_10020: [], attachment: [], comment: { total: 0, comments: [] },
  };
  return [
    { issueKey: "KPIDEMO-901", summary: "External contractor issue", updatedAt: iso(22), assigneeAccountId: "external-demo-01", issueType: "Task", status: "Done", fields: { ...base, summary: "External contractor issue", assignee: jiraUser("external-demo-01", "External Contractor", "contractor@example.invalid"), status: statusObject("Done"), duedate: dateOnly(24), resolutiondate: iso(23), customfield_10016: 2, customfield_20001: 0, customfield_20002: 180, customfield_20003: 240, customfield_20011: 0, customfield_20012: 1, customfield_20013: 0, customfield_20014: null, customfield_20015: "NONE", customfield_20016: 0, customfield_20017: 0, customfield_20018: 0, customfield_20019: 19, customfield_20020: "Sprint 19", customfield_20021: "KPI-EPIC-4", customfield_20022: "External", customfield_20023: "SPRINT_COMMITMENT", customfield_20024: "staging", timeoriginalestimate: 28800, timespent: 21600 } },
    { issueKey: "KPIDEMO-902", summary: "Unassigned production incident", updatedAt: iso(24), assigneeAccountId: null, issueType: "Incident", status: "Resolved", fields: { ...base, summary: "Unassigned production incident", assignee: null, issuetype: issueTypeObject("Incident"), status: statusObject("Resolved"), duedate: dateOnly(24), resolutiondate: iso(24, 12), labels: ["kpi-demo", "incident", "production"], customfield_10016: 1, customfield_20001: 0, customfield_20002: 95, customfield_20003: 140, customfield_20011: 1, customfield_20012: 2, customfield_20013: 1, customfield_20014: "P1", customfield_20015: "HIGH", customfield_20016: 1, customfield_20017: 1, customfield_20018: 30, customfield_20019: 19, customfield_20020: "Sprint 19", customfield_20021: "KPI-EPIC-2", customfield_20022: "Unknown", customfield_20023: "UNPLANNED", customfield_20024: "production", timeoriginalestimate: 14400, timespent: 17100 } },
    { issueKey: "KPIDEMO-903", summary: "Done issue missing completion dates", updatedAt: iso(25), assigneeAccountId: "external-demo-02", issueType: "Bug", status: "Done", fields: { ...base, summary: "Done issue missing completion dates", assignee: jiraUser("external-demo-02", "Legacy Jira User", "legacy@example.invalid"), issuetype: issueTypeObject("Bug"), status: statusObject("Done"), duedate: null, resolutiondate: null, labels: ["kpi-demo", "bug", "data-quality", "missing-dates"], customfield_10016: null, customfield_20001: 1, customfield_20002: null, customfield_20003: null, customfield_20011: null, customfield_20012: 4, customfield_20013: 2, customfield_20014: null, customfield_20015: "UNKNOWN", customfield_20016: null, customfield_20017: 1, customfield_20018: 120, customfield_20019: 19, customfield_20020: "Sprint 19", customfield_20021: null, customfield_20022: null, customfield_20023: "LEGACY", customfield_20024: null, timeoriginalestimate: null, timespent: null } },
  ];
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

try {
  const result = await sql.begin(async (tx) => {
    const orgRows = await tx`SELECT id FROM organizations WHERE slug = 'kpi-local' LIMIT 1`;
    if (!orgRows.length) throw new Error("Local organization 'kpi-local' is missing. Run db:bootstrap-local-admin and db:seed:local first.");
    const organizationId = orgRows[0].id;
    const adminRows = await tx`SELECT id FROM users WHERE lower(email) = 'admin@kpi.local' LIMIT 1`;
    if (!adminRows.length) throw new Error("Local administrator is missing. Run db:bootstrap-local-admin first.");
    const adminUserId = adminRows[0].id;
    const members = await tx`
      SELECT DISTINCT ON (m.id) m.id, m.employee_id, m.name, m.email, t.name AS team_name
      FROM members m
      JOIN team_memberships tm ON tm.member_id = m.id AND tm."primary" = true
      JOIN teams t ON t.id = tm.team_id
      JOIN departments d ON d.id = t.department_id
      WHERE m.organization_id = ${organizationId}
        AND m.active = true
        AND tm.effective_from <= '2026-09-30'
        AND (tm.effective_to IS NULL OR tm.effective_to >= '2026-09-01')
      ORDER BY m.id, tm.effective_from DESC
    `;
    if (!members.length) throw new Error("No active demo members with 2026-09 primary memberships were found. Run db:seed:local first.");

    const syncConfig = { jql: "project = KPI AND created >= 2026-09-01 AND created <= 2026-09-30 ORDER BY updated ASC", fields: syncFields, factMappings };
    const connectionRows = await tx`
      INSERT INTO jira_connections (organization_id, workspace_url, secret_ref, sync_config, active, last_sync_at)
      VALUES (${organizationId}, ${workspaceUrl}, 'env:JIRA_DEMO_CREDENTIALS', ${tx.json(syncConfig)}, true, now())
      ON CONFLICT (organization_id, workspace_url) DO UPDATE SET
        secret_ref = EXCLUDED.secret_ref,
        sync_config = EXCLUDED.sync_config,
        active = true,
        last_sync_at = now(),
        updated_at = now()
      RETURNING id
    `;
    const connectionId = connectionRows[0].id;

    await tx`DELETE FROM jira_member_mappings WHERE connection_id = ${connectionId}`;
    for (const member of members) {
      await tx`
        INSERT INTO jira_member_mappings (connection_id, member_id, jira_account_id, jira_display_name, active)
        VALUES (${connectionId}, ${member.id}, ${`demo-${member.employee_id.toLowerCase()}`}, ${member.name}, true)
      `;
    }

    const generated = members.flatMap((member, memberIndex) => Array.from({ length: 6 }, (_, slot) => ({ issue: buildIssue(member, memberIndex, slot), memberId: member.id })));
    const anomalies = anomalyIssues().map((issue) => ({ issue, memberId: null }));
    const allIssues = [...generated, ...anomalies];

    for (const { issue, memberId } of allIssues) {
      const sourceUpdatedAt = issue.updatedAt ? new Date(issue.updatedAt) : null;
      const currentPayload = { demoSeed: true, fields: issue.fields, assigneeAccountId: issue.assigneeAccountId, issueType: issue.issueType, status: issue.status };
      const issueRows = await tx`
        INSERT INTO jira_issues (connection_id, issue_key, summary, current_payload, jira_updated_at, synced_at)
        VALUES (${connectionId}, ${issue.issueKey}, ${issue.summary}, ${tx.json(currentPayload)}, ${sourceUpdatedAt}, now())
        ON CONFLICT (connection_id, issue_key) DO UPDATE SET
          summary = EXCLUDED.summary,
          current_payload = EXCLUDED.current_payload,
          jira_updated_at = EXCLUDED.jira_updated_at,
          synced_at = now()
        RETURNING id
      `;
      const jiraIssueId = issueRows[0].id;
      const facts = normalizeFacts(issue);
      await tx`
        INSERT INTO jira_issue_facts (jira_issue_id, member_id, facts, attribution, observed_at, source_updated_at, updated_at)
        VALUES (${jiraIssueId}, ${memberId}, ${tx.json(facts)}, ${tx.json(attribution(issue, memberId))}, now(), ${sourceUpdatedAt}, now())
        ON CONFLICT (jira_issue_id) DO UPDATE SET
          member_id = EXCLUDED.member_id,
          facts = EXCLUDED.facts,
          attribution = EXCLUDED.attribution,
          observed_at = now(),
          source_updated_at = EXCLUDED.source_updated_at,
          updated_at = now()
      `;
    }

    const existingRun = await tx`
      SELECT id FROM jira_sync_runs
      WHERE connection_id = ${connectionId} AND metadata @> ${tx.json({ demoSeed: true })}
      ORDER BY started_at DESC LIMIT 1
    `;
    const mappedCount = generated.length;
    const unmappedCount = anomalies.length;
    if (existingRun.length) {
      await tx`
        UPDATE jira_sync_runs SET status='SUCCEEDED', initiated_by=${adminUserId}, started_at=now() - interval '3 seconds', completed_at=now(),
          issues_seen=${allIssues.length}, issues_mapped=${mappedCount}, issues_unmapped=${unmappedCount}, pages_fetched=1,
          error_code=NULL, error_message=NULL, metadata=${tx.json({ demoSeed: true, source: "local-generated", pageSize: allIssues.length })}
        WHERE id=${existingRun[0].id}
      `;
    } else {
      await tx`
        INSERT INTO jira_sync_runs (connection_id, status, initiated_by, started_at, completed_at, issues_seen, issues_mapped, issues_unmapped, pages_fetched, metadata)
        VALUES (${connectionId}, 'SUCCEEDED', ${adminUserId}, now() - interval '3 seconds', now(), ${allIssues.length}, ${mappedCount}, ${unmappedCount}, 1, ${tx.json({ demoSeed: true, source: "local-generated", pageSize: allIssues.length })})
      `;
    }

    return { organizationId, connectionId, memberCount: members.length, issueCount: allIssues.length, mappedCount, unmappedCount };
  });

  const aggregates = await sql`
    SELECT m.employee_id, m.name,
      count(*) FILTER (WHERE (jf.facts->>'committed')::int = 1)::int AS committed,
      count(*) FILTER (WHERE (jf.facts->>'completed')::int = 1)::int AS completed,
      count(*) FILTER (WHERE (jf.facts->>'completedOnTime')::int = 1)::int AS completed_on_time,
      count(*) FILTER (WHERE (jf.facts->>'completedOnTime') IS NOT NULL)::int AS completion_observations,
      count(*) FILTER (WHERE (jf.facts->>'completedOnTime') IS NULL)::int AS missing_completion_dates,
      coalesce(sum((jf.facts->>'reopened')::int), 0)::int AS reopened,
      coalesce(sum((jf.facts->>'detections')::int), 0)::int AS proactive_detections,
      count(*) FILTER (WHERE jf.facts->>'issueType' = 'Incident')::int AS incidents,
      array_remove(array_agg(CASE WHEN jf.facts->>'issueType' = 'Incident' THEN (jf.facts->>'resolutionMinutes')::numeric END), NULL) AS incident_minutes
    FROM jira_issue_facts jf
    JOIN jira_issues ji ON ji.id = jf.jira_issue_id
    JOIN jira_connections jc ON jc.id = ji.connection_id
    JOIN members m ON m.id = jf.member_id
    WHERE jc.workspace_url = ${workspaceUrl}
    GROUP BY m.id, m.employee_id, m.name
    ORDER BY m.employee_id
  `;
  const compatible = aggregates.map((row) => {
    const incidentMinutes = (row.incident_minutes ?? []).map(Number);
    const completionObservations = Number(row.completion_observations);
    return {
      employeeId: row.employee_id,
      member: row.name,
      delivery: { committed: Number(row.committed), completed: Number(row.completed), completedOnTime: Number(row.completed_on_time), onTimeRate: completionObservations ? Math.round(Number(row.completed_on_time) / completionObservations * 10000) / 100 : null, completionCoverage: Number(row.committed) ? Math.round(completionObservations / Number(row.committed) * 10000) / 100 : null, missingCompletionDates: Number(row.missing_completion_dates) },
      quality: { resolved: Number(row.completed), reopened: Number(row.reopened), reopenRate: Number(row.completed) ? Math.round(Number(row.reopened) / Number(row.completed) * 10000) / 100 : null },
      incident: { count: Number(row.incidents), medianResolutionMinutes: median(incidentMinutes) },
      proactive: { detections: Number(row.proactive_detections) },
    };
  });

  const completenessRows = await sql`
    SELECT
      count(*)::int AS facts,
      count(*) FILTER (WHERE member_id IS NULL)::int AS unmapped,
      count(*) FILTER (WHERE facts->>'completedOnTime' IS NULL)::int AS missing_completion_dates,
      count(*) FILTER (WHERE facts->>'storyPoints' IS NULL)::int AS missing_story_points,
      count(*) FILTER (WHERE facts->>'resolutionMinutes' IS NULL)::int AS missing_resolution_minutes
    FROM jira_issue_facts jf
    JOIN jira_issues ji ON ji.id=jf.jira_issue_id
    JOIN jira_connections jc ON jc.id=ji.connection_id
    WHERE jc.workspace_url=${workspaceUrl}
  `;

  console.log(JSON.stringify({
    workspaceUrl,
    connectionId: result.connectionId,
    membersMapped: result.memberCount,
    issuesSeeded: result.issueCount,
    mappedIssues: result.mappedCount,
    unmappedIssues: result.unmappedCount,
    normalizedFactCoverage: completenessRows[0],
    kpiCompatibility: compatible,
  }, null, 2));
} finally {
  await sql.end({ timeout: 2 });
}
