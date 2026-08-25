# Jira Demo Data Contract

Last updated: 2026-08-25

## Purpose

`scripts/seed-local-jira-demo.mjs` creates production-shaped Jira data directly in the local PostgreSQL integration tables so T08/T08-B can be developed without requiring a real Atlassian tenant or API token.

This is development/demo authority only. It does not replace real Jira connector verification.

## Command

```bash
npm run db:seed:jira-demo
```

Prerequisites:
- local PostgreSQL configured through `.env.local`;
- `db:seed:local` already created organization `kpi-local`, active members and effective memberships;
- migrations through `0011_jira_sync_foundation.sql` applied.

The script is disabled when `NODE_ENV=production`.

## Persisted demo workspace

- Workspace URL: `https://kpi-demo.atlassian.net`
- Secret reference only: `env:JIRA_DEMO_CREDENTIALS`
- No Jira password/token is written to source, database payloads, docs, or logs.
- Explicit member mapping: every active local member with an effective 2026-09 primary membership receives deterministic Jira account id `demo-<employee-id>`.
- Current seed result: 14 mapped members, 87 Jira issues/facts, 84 member-attributed issues, 3 intentionally unmapped issues, and one idempotently maintained successful demo sync-run record.

## Jira-shaped raw fields

Each generated issue persists a realistic `current_payload.fields` object including, where applicable:

- identity: `summary`, `description`, `project`, `issuetype`, `status`, `priority`, `resolution`;
- people: `assignee`, `reporter`, `creator` with Atlassian-like account metadata;
- lifecycle dates: `created`, `updated`, `duedate`, `resolutiondate`;
- planning: story points `customfield_10016`, sprint `customfield_10020`, sprint id/name, epic key, team key and commitment scope;
- classification: labels, components, fix versions, parent, subtasks and issue links;
- time tracking: `timeoriginalestimate`, `timeestimate`, `timespent`, `timetracking`, `progress`, `workratio`;
- operational context: environment, incident severity, customer impact, SLA breach and rollback-required signals;
- quality context: reopen count, code-review iteration count, rework count and production-escape signal;
- collaboration/evidence: comments, attachments container, votes and watches.

The raw payload intentionally contains richer structures than the normalized KPI facts. This preserves room for later connector/normalizer upgrades without changing historical demo fixtures.

## Normalized fact mapping

The demo Jira connection stores declarative mappings compatible with `src/server/jira/normalizer.ts`.

| Fact | Jira source / transform | KPI use |
| --- | --- | --- |
| `committed` | constant `1` | Delivery denominator candidate |
| `completed` | status in Done/Resolved/Closed | delivery/resolution coverage |
| `completedOnTime` | `resolutiondate <= duedate` | `on_time_completion_rate` |
| `reopened`, `reopenCount` | `customfield_20001` | `reopen_rate` |
| `resolutionMinutes` | `customfield_20002` | `resolution_time_minutes` |
| `cycleTimeMinutes` | `customfield_20003` | future lead/cycle-time metrics |
| `detections`, `proactiveDetection` | label `proactive-detection` | `proactive_detection_count` |
| `storyPoints` | `customfield_10016` | throughput/planning metrics |
| `originalEstimateSeconds` | `timeoriginalestimate` | estimation metrics |
| `timeSpentSeconds` | `timespent` | efficiency/time metrics |
| `productionEscape` | `customfield_20017` | escaped-defect quality metric |
| `reviewIterations` | `customfield_20012` | code-review/rework metrics |
| `reworkCount` | `customfield_20013` | quality/rework metrics |
| `slaBreached` | `customfield_20011` | incident SLA metric |
| `incidentSeverity` | `customfield_20014` | incident segmentation |
| `customerImpact` | `customfield_20015` | impact weighting |
| `rollbackRequired` | `customfield_20016` | release reliability |
| `blockedMinutes` | `customfield_20018` | flow-efficiency metric |
| `sprintId`, `sprintName` | custom scalar mirror fields | period/sprint attribution |
| `epicKey`, `teamKey` | custom scalar mirror fields | grouping and attribution |
| `commitmentScope` | `customfield_20023` | committed/unplanned segmentation |
| `environmentName` | `customfield_20024` | production/staging segmentation |
| `documentationUpdated` | label `documentation` | documentation evidence |
| `automationAdded` | label `automation` | automation/proactive evidence |

## Generated issue scenarios

Each mapped member receives six issue archetypes for September 2026:

1. Story — committed delivery, varied on-time/late completion and story points.
2. Task — maintenance commitment; some members deliberately remain `In Progress` to test incomplete observations.
3. Bug — resolved regression with varied reopen/production-escape/rework signals.
4. Incident — P1/P2/P3 production incident with resolution minutes, SLA, impact and rollback signals.
5. Task — proactive risk detection with `proactive-detection` evidence.
6. Task — documentation + automation improvement.

Additional anomalies are inserted independently of member mappings:

- external contractor account not mapped to a KPI member;
- unassigned production incident;
- legacy completed bug with missing due/resolution/story-point/time fields.

Mapped member fixtures also include controlled missing-field cases such as missing due date and missing story points.

## Current data-quality coverage

Latest local seed verification on 2026-08-25:

- normalized facts: 87;
- unmapped facts: 3;
- missing completion-date observations: 5;
- missing story points: 3;
- missing resolution minutes: 4.

These are intentional fixtures. T08-B must convert insufficient coverage into explicit data-quality/NOT_EVALUATED behavior where required; it must not silently treat missing facts as score zero.

## KPI adaptation target

The dataset provides enough raw + normalized evidence to derive the four system-backed demo metrics already configured by `scripts/seed-local-demo.mjs`:

- `on_time_completion_rate`: aggregate committed/completion/on-time facts for the member and evaluation period, with explicit coverage accounting;
- `reopen_rate`: aggregate resolved/reopened quality facts, preferably scoped to eligible issue types defined by metric configuration;
- `resolution_time_minutes`: aggregate incident `resolutionMinutes` (the current demo report calculates a median);
- `proactive_detection_count`: sum validated `detections` facts.

T08-B should read these current facts, freeze the exact contributing facts in `jira_fact_snapshots` when used for an evaluation, and refuse silent recalculation after human review begins.
