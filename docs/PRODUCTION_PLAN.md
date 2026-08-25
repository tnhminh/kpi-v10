# Productionization Plan

## Objective
Transform the current contest-grade KPI prototype into a production-ready internal performance-management platform without discarding the existing UI.

## Execution loop
Every task follows the same gate:

1. IMPLEMENT the scoped change.
2. TEST with the most relevant automated/runtime proof.
3. REVIEW code, security, authorization, data integrity, UX and regression risk.
4. If REVIEW or TEST fails: FIX the defect, TEST AGAIN, then REVIEW AGAIN. Repeat until green.
5. Only after a green review, update `STATUS.md`, `HANDOFF.md`, `QA.md`, `TASKS.md`, traceability/gates and `DECISIONS.md` when applicable.
6. Re-run the required verification after code/documentation changes before marking the task DONE.

No task may be marked complete while known verification failures remain.

## Definition of Done
Production-ready means all P0 items below are implemented and verified:

- [x] Persistent PostgreSQL-backed domain model and migrations.
- [x] Server-side API/service layer with validation and domain invariants for migrated T00–T07 workflows.
- [x] Authentication, secure sessions, and server-side RBAC.
- [x] Period-aware team membership and KPI version resolution.
- [x] Deterministic metric/scoring engine with NOT_EVALUATED support.
- [x] Leader review and Department Head calibration persisted with reasons.
- [x] Finalize/lock workflow with immutable historical snapshots.
- [x] Jira connector boundary, sync jobs, fact snapshots, and recalculation policy.
- [x] Append-only audit events for sensitive mutations.
- [x] Automated unit/integration/E2E coverage for critical workflows, including 146 unit/contract tests, live PostgreSQL integrity proofs, real system-Chrome mutation/reload navigation, and isolated backup/restore readiness proof.
- [x] Production security headers, input validation, request protections, and secret handling.
- [x] Health/readiness endpoints, structured logging, and observability hooks. Central target-environment ingestion, dashboards and alert delivery remain external release gates.
- [x] Container/deployment configuration, migration procedure, backup/restore guidance. Production execution/rehearsal remains an external release gate.
- [x] CI quality gates: lint, typecheck, test, build. Workflow is committed; remote CI execution remains an external release gate.
- [x] Documentation and handoff reflect the current repository/local implementation and explicitly separate local PASS evidence from remaining external production gates.

## Task sequence

### T00 — Governance and handoff baseline
Create the durable project-memory documents and quality loop.

Acceptance:
- Production plan exists.
- Status, handoff, QA, architecture, and decisions files exist.
- Existing app still lint/build passes.

### T01 — Production foundation
Add dependency baseline, environment contract, security headers, logging primitives, validation helpers, health/readiness routes, test runner, and CI-friendly scripts.

### T02 — PostgreSQL domain model
Add PostgreSQL schema/migrations for organization, KPI versioning, membership, evaluations, reviews, snapshots, Jira facts, rank schemes, users/sessions, and audit events.

### T03 — Domain services and scoring engine
Implement deterministic, testable business rules independently of UI and transport.

### T04 — Authentication and RBAC
Implement secure login/session lifecycle and server-side role/permission enforcement.

### T05 — Organization + KPI APIs
Implement validated CRUD/version lifecycle APIs and connect core UI mutations to persistence.

### T06 — Evaluation pipeline
Implement period resolution, metric/scoring execution, evidence creation, and data-quality handling.

### T07 — Human review, finalization, and lock
Persist Leader/Head changes, require reasons, finalize, snapshot, and enforce immutability.

### T08 — Jira integration boundary
Implement sync abstraction, member mapping, fact snapshots, retry/error state, and recalculation policy.

### T09 — Audit and historical analytics
Persist append-only audit events and derive historical aggregates only from valid final values.

### T10 — Production hardening
Add broad test coverage, production container/runtime files, backup/restore runbook, observability, and release checklist.

## Current baseline
The repository started as a frontend-oriented prototype. T00–T09 are now complete: the shell is session-gated, tenant/RBAC/resource scope is server-derived, Organization/KPI/Evaluation/Review/Jira/Audit/History workflows use protected PostgreSQL-backed APIs, deterministic scoring preserves NOT_EVALUATED, finalized/locked review state is protected by checksum snapshots plus PostgreSQL immutability guards, Jira-backed evaluation freezes exact contributing issue facts before reruns, and sensitive mutations append tenant-scoped immutable audit events. Historical analytics aggregates only valid FINALIZED/LOCKED outcomes and reports non-final rows through coverage rather than treating them as zero. Local PostgreSQL has applied migrations `0001`–`0014`; live T06/T07/T08/T09 API/DB integrity flows have passed. T10 has also removed seed authority from the active shell; added API-backed Dashboard/Metric/Rules/Quality/Rank and Administration surfaces; implemented period-effective Department Head assignment management; added forced first-login user onboarding with temporary-session restrictions, password rotation, session revocation and non-secret audit; and added standalone runtime assets, CI/runbooks and expanded KPI-configuration audit coverage. T10 now also includes vendor-neutral request/error/latency/readiness metrics, structured request-completion telemetry, framework error instrumentation, and scrape-protected `/api/metrics`. Production hardening now has clean-install, aggregate local release, real browser E2E and isolated backup/restore evidence PASS. Remaining release gates are real Atlassian credentialed sync if Jira is production-enabled, remote GitHub CI, container-runtime evidence for the chosen deployment architecture, and target-environment secrets/logs/metrics/alerts/deploy/rollback/smoke validation.
