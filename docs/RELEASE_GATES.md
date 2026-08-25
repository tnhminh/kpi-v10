# Production Release Gates

Last updated: 2026-08-25

Status values: `PASS`, `PARTIAL`, `BLOCKED_EXTERNAL`, `FAIL`. A gate may be marked PASS only with objective evidence appropriate to that gate. Localhost evidence does not satisfy target-production infrastructure requirements.

## G0 — Architecture ready
**Status:** PASS

Required evidence:
- Domain/service/transport boundaries documented.
- Server-side authority for auth, KPI evaluation, review/finalization and audit.
- Historical reproducibility invariants recorded.

Evidence: `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, T00–T09 implementation.

## G1 — Database & migration integrity
**Status:** PASS (repository/local)

Required evidence:
- Explicit tracked migrations.
- Local clean migration/parity.
- DB constraints/triggers for critical invariants.
- Restored database preserves migrations/data/integrity triggers.

Evidence: migrations `0001`–`0014`, `db:verify:migrations:local`, T06/T07/T09 DB probes, `proof:restore`.

Target production migration/backup execution remains G13, not G1.

## G2 — Authentication / Authorization / Tenant isolation
**Status:** PASS (repository/local)

Required evidence:
- Secure password/session lifecycle.
- Login throttling and mutation-origin protection.
- Tenant resolution from authenticated access.
- Team Leader/Department Head resource scope.
- No organization-wide Department Head leakage.

Evidence PASS: T04 auth tests/live login, T07 Department Head review scope proof, T12 RBAC regression tests and live analytics proof showing 0 rows without assignment and assigned-department rows only after an effective assignment. Full local release proof also PASSes.

## G3 — KPI configuration authority
**Status:** PASS

Evidence: T03/T05 deterministic scoring/config lifecycle, server/API authority, PostgreSQL submission immutability, KPI configuration audit proof.

## G4 — Evaluation authority
**Status:** PASS

Evidence: canonical pipeline, server-resolved membership/team/KPI version, NOT_EVALUATED policy, T06 14/14 local DB/API batch and integrity probes.

## G5 — Review / Finalization / Historical immutability
**Status:** PASS (repository/local)

Evidence: T07 layered review/finalize/lock, immutable historical checksum snapshot, quality disposition guards, T09 append-only audit/history, T12 assignment-scoped history behavior.

## G6 — Jira / External integrations
**Status:** BLOCKED_EXTERNAL for real Jira

Repository/local evidence PASS:
- Jira connection/mapping/sync model.
- production-shaped demo facts.
- server-owned Jira evaluation.
- frozen-fact rerun proof.

Open evidence:
- real Atlassian credentialed network/API/persistence sync using approved workspace and bounded JQL.

Owner task: T14.

## G7 — UI / Browser E2E
**Status:** PASS (repository/local)

Evidence: `npm run proof:browser-e2e` using actual system Chrome:
- login,
- Team creation through UI,
- DB persistence,
- browser reload persistence,
- navigation through Evaluation Periods, System Evaluation, Leader Review, Calibration, Jira Integration, Historical Analytics and Settings,
- zero page errors.

Target-environment smoke remains G14.

## G8 — Observability
**Status:** PARTIAL

Repository/local evidence PASS:
- correlated structured request logs,
- framework error instrumentation,
- bounded-cardinality request/error/latency/readiness/auth-throttle metrics,
- production-protected `/api/metrics`,
- local observability proof.

Open target evidence:
- central log ingestion,
- scraper on every replica,
- dashboards/retention,
- alert rules and delivery.

Owner task: T17.

## G9 — Backup / Restore / Disaster Recovery
**Status:** PASS (repository/local), target backup remains deployment gate

Evidence: `npm run proof:restore`:
- source dump,
- isolated temporary PostgreSQL cluster,
- restore,
- 14/14 migration parity,
- representative persisted data,
- key integrity triggers,
- restored standalone `/api/ready` HTTP 200,
- temporary artifacts cleaned.

Target production pre-migration backup and operational RPO/RTO evidence belong to T17/G13.

## G10 — CI / Supply chain / build
**Status:** PASS

PASS locally:
- lockfile exists,
- lint/typecheck/test/build have passed,
- dependency audit has reported zero high vulnerabilities at prior checkpoints.

Local PASS:
- clean `npm ci` from lockfile,
- `npm run proof:release-local` sequentially PASSes verify, dependency audit, migration parity, DB/API proofs, observability, real Chrome E2E and restore.

Remote PASS:
- GitHub Actions run for commit `c9274f8` completed successfully after one CI-only metrics-auth environment-isolation defect was fixed and reverified.
- Remote job includes clean install, full verify, PostgreSQL migration/parity and production dependency audit.

## G11 — Runtime / Container
**Status:** PASS (repository/remote CI)

Evidence:
- Next.js standalone build/runtime proof.
- non-root multi-stage Dockerfile reviewed in repository.
- GitHub Actions run `32852668799` on commit `e2171c9` built the real image successfully.
- Content-addressed image ID: `sha256:ef6b06304378a1d1002e554e6be5d41c137c032ff7823b264bd4bf96ce44b1f7`.
- Runtime UID: `1001` (non-root).
- Runtime-injected production configuration connected the container to CI PostgreSQL.
- Container `/api/health` returned `status=ok`; `/api/ready` returned `status=ready` with configuration/database checks `ok`.

The actual production registry/artifact promotion and target deployment remain G13/G14, not G11.

## G12 — Security / Secret management
**Status:** PARTIAL

Repository/local PASS:
- scrypt/opaque sessions,
- CSRF/origin protection,
- RBAC/tenant boundaries,
- logger secret redaction,
- environment validation,
- Jira secret references,
- production metrics token requirement.

Open target evidence:
- production secret manager/distribution,
- production-unique secret values,
- TLS/ingress,
- final adversarial review.

Owner tasks: T17/T18.

## G13 — Production deployment / rollback
**Status:** BLOCKED_EXTERNAL

Required evidence:
- real production target identified and authorized,
- reviewed immutable artifact,
- pre-migration backup,
- target migration/parity,
- deploy,
- rollback artifact/owner/process.

Owner task: T17.

## G14 — Production smoke test
**Status:** BLOCKED_EXTERNAL

Required evidence after deployment:
- HTTPS/domain reachable,
- health/readiness 200,
- authorized login,
- tenant-scoped representative reads,
- KPI/evaluation/review/history/audit read smoke,
- Jira smoke if enabled,
- browser interaction/reload acceptance,
- logs/metrics visible centrally.

Owner task: T17.

## G15 — LIVE PRODUCTION GO
**Status:** BLOCKED_EXTERNAL / NO GO

PASS conditions:
- G0–G14 required-for-target gates PASS.
- No unresolved P0/P1 defects.
- `docs/RELEASE_CHECKLIST.md` completed with environment-specific evidence.
- Final adversarial review PASS.
- Release owner records GO.

Current decision: **NO_GO_EXTERNAL_GATES_OPEN**.

Primary open gates: real Jira if production-required, production secret/infrastructure configuration, central logs/metrics/alerts, production artifact promotion/deploy/rollback and post-deploy smoke.
