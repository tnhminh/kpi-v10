# Detailed Execution Backlog

Last updated: 2026-08-25

This file is the authoritative execution backlog. A task is DONE only when implementation, objective acceptance criteria, verification evidence, documentation, and handoff are all complete. External infrastructure/credential gates are recorded as `BLOCKED_EXTERNAL`; they must never be reported as PASS from localhost evidence.

## Status vocabulary
- `DONE`: acceptance and verification complete.
- `READY`: internally actionable now.
- `IN_PROGRESS`: actively being implemented/verified.
- `BLOCKED_INTERNAL`: repository defect/dependency must be resolved first.
- `BLOCKED_EXTERNAL`: requires credential, infrastructure, owner approval, or runtime not available to this project environment.

---

## T00 — Governance and durable handoff baseline
**Status:** DONE
**Priority:** P0
**Risk:** Medium
**Dependencies:** none
**Blocks:** all later tasks

### Goal
Establish project memory and a repeatable implement → verify → document → review loop.

### Scope
Production plan, status, handoff, QA, architecture and decision records; baseline lint/build verification.

### Acceptance Criteria
- [x] Durable project docs exist.
- [x] Project remains explicitly NOT READY until release evidence exists.
- [x] Lint/build baseline PASS.

### Verification
See `docs/QA.md` T00.

### Definition of Done
Code/doc baseline verified and handoff workflow established.

---

## T01 — Production foundation
**Status:** DONE
**Priority:** P0
**Risk:** High
**Dependencies:** T00

### Goal
Provide production-safe environment validation, HTTP boundaries, health/readiness, structured logging, security headers and test tooling.

### Implementation details
- Runtime environment contract.
- Security headers/CSP.
- `/api/health`, `/api/ready`.
- Structured logger/request IDs.
- Zod validation and normalized API errors.
- lint/typecheck/test/build scripts.

### Acceptance Criteria
- [x] Secrets are runtime-only.
- [x] Health/readiness routes build and run.
- [x] Request validation/error boundaries are server-owned.
- [x] Full automated gate PASS.

### Verification
See `docs/QA.md` T01.

---

## T02 — PostgreSQL domain model and migrations
**Status:** DONE
**Priority:** P0
**Risk:** Critical
**Dependencies:** T01

### Goal
Replace prototype state with an explicit relational model preserving tenant boundaries, effective dates, versions and historical facts.

### Scope
Organizations, users/access/sessions, departments/teams/members, effective membership/leadership, KPI configuration/versioning, evaluation/review, Jira facts/snapshots, rank schemes, audit, quality and historical snapshots.

### Acceptance Criteria
- [x] Explicit SQL migrations are atomic and tracked.
- [x] NOT_EVALUATED remains nullable, not zero.
- [x] Local PostgreSQL migration execution proven.
- [x] `/api/ready` validates DB connectivity.

### Verification
Migrations `0001`–`0014`; `npm run db:verify:migrations:local`.

---

## T03 — Deterministic KPI domain/scoring engine
**Status:** DONE
**Priority:** P0
**Risk:** Critical
**Dependencies:** T02

### Goal
Make KPI calculation deterministic, bounded, explainable and independent of UI/transport.

### Acceptance Criteria
- [x] Threshold/range/formula/hybrid scoring deterministic.
- [x] No `eval`/dynamic code execution.
- [x] Criterion/KPI score bounds enforced.
- [x] NOT_EVALUATED distinct from zero.
- [x] Rank bands reject gaps/overlaps.
- [x] Historical aggregation excludes non-final values from numerator.

### Verification
Domain unit tests; `docs/QA.md` T03.

---

## T04 — Authentication, sessions and RBAC
**Status:** DONE
**Priority:** P0
**Risk:** Critical
**Dependencies:** T02

### Goal
Ensure all product authority comes from authenticated server state and resolved resource scope.

### Security implementation
- Fixed-cost scrypt password hashes.
- Opaque session token; HMAC digest only in DB.
- HttpOnly / SameSite=Strict / production Secure cookie.
- Shared DB login throttling.
- mutation-origin / Fetch Metadata protection.
- role permission map plus tenant/resource-scope checks.

### Acceptance Criteria
- [x] Inactive/revoked/expired sessions rejected.
- [x] Unknown account follows real KDF path.
- [x] Client roles are never trusted.
- [x] Cross-resource authorization requires resolved scope.
- [x] Live local login/session flow PASS.

### Verification
Auth/RBAC tests plus local HTTP proof.

---

## T05 — Organization and KPI configuration authority
**Status:** DONE
**Priority:** P0
**Risk:** Critical
**Dependencies:** T02–T04

### Goal
Move Organization/Team/Member/KPI configuration and the active UI from seed authority to protected PostgreSQL APIs.

### Backend
Tenant-scoped CRUD; membership overlap protection; KPI version clone/lifecycle; criteria/metric/scoring configuration; server-side validation; DB immutability after submission.

### Frontend / UX
Session-gated shell; API-backed Teams/Members/Templates/KPI Builder; submitted drafts read-only; clone-to-edit.

### Acceptance Criteria
- [x] No active production shell dependency on seed KPI authority.
- [x] KPI lifecycle/configuration persisted and protected.
- [x] High-value browser mutation/reload persistence now covered by T11 browser proof.

### Verification
Unit/build gates, local API seed smoke, `npm run proof:browser-e2e`.

---

## T06 — Authoritative evaluation pipeline
**Status:** DONE
**Priority:** P0
**Risk:** Critical
**Dependencies:** T03–T05

### Goal
Create one server-authoritative evaluation path resolving period membership/team/KPI version and persisting evidence/quality.

### Acceptance Criteria
- [x] Browser cannot submit authoritative scores.
- [x] Effective membership + period KPI assignment resolve server-side.
- [x] Missing/critical data never becomes zero.
- [x] Assignment/metric semantics freeze after collection starts.
- [x] Local 14/14 batch proof and DB mutation probes PASS.

### Verification
T06 tests and local DB/API proofs in `docs/QA.md`.

---

## T07 — Human review, finalization and immutable lock
**Status:** DONE
**Priority:** P0
**Risk:** Critical
**Dependencies:** T06

### Goal
Persist layered human review, auditable adjustments, explicit quality disposition, final rank and immutable historical snapshots.

### Acceptance Criteria
- [x] Leader/Department Head scope is effective-period resource scope.
- [x] Changed human scores require bounded reasoned adjustment.
- [x] CRITICAL quality blocks finalization unless explicitly resolved/waived.
- [x] LOCKED evaluation/snapshot/quality state is DB-immutable.

### Verification
T07 HTTP/DB end-to-end proof and trigger mutation probes.

---

## T08 — Jira integration and frozen evaluation facts
**Status:** DONE (local integration); real Atlassian execution tracked in T14
**Priority:** P0
**Risk:** Critical
**Dependencies:** T06

### Goal
Separate mutable Jira sync state from immutable evaluation inputs and make Jira-backed evaluation server-owned.

### Acceptance Criteria
- [x] Secrets stored only as references.
- [x] Sync/mapping/current facts persisted.
- [x] Jira metric provider aggregates server-side.
- [x] Exact contributing facts snapshot on first evaluation use.
- [x] Rerun remains unchanged after current Jira fact mutation.

### Verification
`npm run db:seed:jira-demo`; `npm run db:evaluate:jira-demo`.

---

## T09 — Append-only audit and historical analytics authority
**Status:** DONE
**Priority:** P0
**Risk:** Critical
**Dependencies:** T05–T08

### Goal
Make sensitive mutation history tenant-scoped, append-only and request-correlated; derive historical KPI only from authoritative final outcomes.

### Acceptance Criteria
- [x] Audit UPDATE/DELETE blocked by PostgreSQL.
- [x] Audited actor hard-delete blocked; identity snapshot retained.
- [x] Sensitive writes append audit in same transaction.
- [x] Historical non-final values affect coverage only.

### Verification
`npm run db:proof:audit-history`.

---

## T10 — Core production hardening
**Status:** DONE for repository/local subphases A–I; remaining external closure split into T11–T18
**Priority:** P0
**Risk:** High
**Dependencies:** T00–T09

### Completed subphases
- T10-A standalone runtime, Dockerfile, CI workflow, migration verifier/runbooks.
- T10-B API-backed Executive Dashboard.
- T10-C API-backed Metric Library / Rules / Data Quality / Rank Schemes.
- T10-D same-transaction KPI configuration audit.
- T10-E Administration Settings + effective Department Head assignment UI/API.
- T10-F production user onboarding + forced password rotation.
- T10-G bounded-cardinality observability + protected Prometheus endpoint.
- T10-H real system-Chrome browser E2E/reload proof.
- T10-I isolated PostgreSQL backup/restore + restored standalone readiness proof.

### Acceptance Criteria
- [x] Repository/local hardening subphases have repeatable proof commands.
- [x] Browser E2E PASS using real local Chrome.
- [x] Restore rehearsal PASS using isolated temporary PostgreSQL cluster.
- [ ] External runtime/integration/deployment gates are closed by T14–T18.

---

## T11 — Detailed planning, traceability and documentation reconciliation
**Status:** DONE
**Priority:** P0
**Risk:** Medium
**Dependencies:** T10

### Goal
Make the documentation sufficient for a new high-reasoning planning agent or coding agent to continue without rediscovering architecture from the codebase.

### Current state
Roadmap/status/handoff existed but detailed task decomposition and release-gate traceability were missing; several QA/status lines still described browser/restore as blocked after those proofs had passed.

### Scope
- `docs/TASKS.md` detailed source of truth.
- `docs/TRACEABILITY.md` requirement → task → code → proof.
- `docs/RELEASE_GATES.md` objective GO/NO-GO gates.
- Reconcile `STATUS.md`, `HANDOFF.md`, `QA.md`, `PRODUCTION_PLAN.md`, `OPERATIONS.md`, `RELEASE_CHECKLIST.md`, `DECISIONS.md`.

### Acceptance Criteria
- [x] Every remaining production concern maps to a task.
- [x] Browser E2E and restore evidence are no longer documented as blocked.
- [x] External blockers are clearly separated from internal defects.
- [x] Docs agree on current GO/NO-GO state.
- [x] Full lint/typecheck/test/build PASS after doc/code closeout as part of `npm run proof:release-local`.

### Verification
`npm run verify`; documentation review; `git diff --check`.

### Required documentation updates
All release/governance docs listed above.

### Handoff
After T11, select the highest-priority READY task in this file; do not restart planning from scratch.

---

## T12 — Department Head analytics/resource-scope hardening
**Status:** DONE
**Priority:** P0
**Risk:** Critical (authorization)
**Dependencies:** T07, T09

### Goal
Ensure Department Head analytics and reusable RBAC helpers never widen department authority to the entire organization.

### Why this task exists
ADR-016 defines Department Head authority as period-effective department scope, but Historical Analytics treated `DEPARTMENT_HEAD` as organization-wide and generic RBAC helpers allowed organization-wide Department Head reads/reviews.

### Implementation details
#### Backend
- Historical Analytics scope becomes `DEPARTMENT` for Department Head.
- Query requires an effective `department_head_assignments` record for the evaluation period start and resolved department.
- Administrator remains organization-wide; Member/Team Leader historical analytics remains self-scoped at the current product boundary.

#### Frontend / UX
- Historical Analytics displays department-scope hint/label.

#### Security / Authorization
- Generic `canReviewTeam` / `canReadMemberEvaluation` require caller-provided resolved authorized team IDs for Department Head as well as Team Leader.

### Failure modes / Edge cases
- Department Head with no assignment must receive zero historical rows, not organization data.
- Assignment outside period must not grant history.
- Administrator must remain organization-wide.
- Multiple valid assignments must not duplicate rows (EXISTS predicate).

### Acceptance Criteria
- [x] No assignment → Department Head history totalCount = 0.
- [x] Effective assignment → Department Head history returns assigned department rows and scope `DEPARTMENT`.
- [x] RBAC unit tests assert Department Head requires resolved team scope.
- [x] Full verification PASS: 31/31 test files, 146/146 tests, production build and live administration/history proof.

### Verification
`npm run db:proof:administration`; `npm run test -- --run src/server/auth/rbac.test.ts src/server/analytics/history.test.ts` or full `npm run test`; `npm run verify`.

### Documentation updates required
TASKS, STATUS, HANDOFF, QA, DECISIONS/TRACEABILITY when closed.

---

## T13 — Aggregate local release proof and clean-install gate
**Status:** DONE
**Priority:** P0
**Risk:** High
**Dependencies:** T11, T12

### Goal
Provide one repeatable repository/local release evidence path rather than manually assembling individual PASS claims.

### Scope
- Add `proof:release-local` orchestration for migration parity + all high-value DB/API/browser/observability/restore proofs.
- Run `npm ci` from lockfile.
- Run lint/typecheck/tests/build and production dependency audit.
- Record reviewed commit/release identifier.

### Acceptance Criteria
- [x] `npm ci` PASS from lockfile: 443 packages installed; audit reported 0 vulnerabilities.
- [x] lint/typecheck/tests/build PASS: 31/31 test files, 146/146 tests, Next.js production build PASS.
- [x] `npm audit --omit=dev --audit-level=high` PASS with 0 vulnerabilities.
- [x] migration parity PASS: 14/14, latest `0014_user_onboarding`.
- [x] audit/history, dashboard, configuration, KPI-audit, administration, onboarding, observability, browser E2E and restore proofs PASS.
- [x] Cross-platform `npm run proof:release-local` PASSes all 12 steps sequentially.
- [x] `git diff --check` PASS; only expected Git line-ending notices were emitted.

### Out of scope
Real Atlassian, container engine, production infrastructure.

---

## T14 — Real Atlassian credentialed sync verifier
**Status:** BLOCKED_EXTERNAL (internal verifier complete)
**Priority:** P0 if Jira is enabled in production
**Risk:** High
**Dependencies:** T08

### Goal
Build a safe repeatable verifier proving the real Jira Cloud connector/network/credential/persistence path.

### Implementation details
- Add local-only proof harness.
- Require `JIRA_REAL_WORKSPACE_URL`, `JIRA_BACKEND_CREDENTIALS`, and a deliberately bounded `JIRA_REAL_JQL`.
- Never print email/token/secret JSON.
- Use `secretRef=env:JIRA_BACKEND_CREDENTIALS`.
- Execute protected connection + sync path or an equivalently authoritative server-owned path.
- Verify SUCCEEDED run, pages/issues counters and persisted facts.
- Clean/deactivate verifier identity safely without deleting audited actors.

### Acceptance Criteria
- [x] Missing environment values fail closed with a non-secret `BLOCKED_EXTERNAL` message.
- [x] Missing-credential proof output prints variable names only and no credential values; verifier code never intentionally emits credential JSON/token values.
- [ ] Real Jira API fetch succeeds.
- [ ] `jira_sync_runs.status=SUCCEEDED`, pagesFetched > 0, issuesSeen > 0 for bounded JQL.
- [ ] Persisted Jira facts exist for the verifier connection.

### External blocker
Current `.env.local` does not provide real Jira credentials/workspace configuration.

### Closure input
Production/release owner supplies approved real workspace URL, bounded JQL and secret-managed credential JSON.

---

## T15 — GitHub CI remote execution
**Status:** DONE
**Priority:** P0
**Risk:** High
**Dependencies:** T13

### Goal
Prove the committed GitHub Actions workflow on the private remote repository, not only reproduce commands locally.

### Current state
Private repository `tnhminh/kpi-v10` exists and `master` has been pushed. Workflow is committed.

### Acceptance Criteria
- [x] Remote workflow run observed for reviewed pushed commits.
- [x] Install, verify, PostgreSQL migration/parity and production dependency audit PASS.
- [x] First CI-only metrics-auth test isolation defect was reproduced, fixed, locally reverified and rerun.
- [x] GitHub Actions run for commit `c9274f8` completed `success`; reviewed logs exposed no credential material.

### Failure modes
Missing Actions permission/runner is `BLOCKED_EXTERNAL`; workflow defects are `BLOCKED_INTERNAL` and must be fixed.

---

## T16 — Container image/runtime evidence
**Status:** DONE
**Priority:** P0 when container deployment is target
**Risk:** High
**Dependencies:** T13

### Goal
Build and run the reviewed release image and record immutable digest/non-root/readiness evidence.

### Execution path
Docker/Podman remain unavailable on the local host, but GitHub-hosted Ubuntu runners provide a Docker daemon. T16 now uses remote CI to build the reviewed image, record its content-addressed image ID, inspect non-root UID, start the container with runtime-injected environment, and verify health/readiness against the CI PostgreSQL service.

### Acceptance Criteria
- [x] `docker build` succeeds from reviewed commit `e2171c9` in GitHub Actions.
- [x] Content-addressed image ID recorded: `sha256:ef6b06304378a1d1002e554e6be5d41c137c032ff7823b264bd4bf96ce44b1f7`.
- [x] Runtime process is non-root: UID `1001`.
- [x] Production environment is injected with `docker run -e ...`; `.env*` is excluded from build context by `.dockerignore`.
- [x] Container `/api/health` returns `status=ok`; `/api/ready` returns `status=ready` with configuration/database checks `ok`.

### Verification
GitHub Actions run `32852668799` for commit `e2171c9` completed `success`. See `docs/QA.md` T16.

### Exact closure command
See `docs/OPERATIONS.md` container commands.

---

## T17 — Production infrastructure, secrets, telemetry and deployment
**Status:** BLOCKED_EXTERNAL
**Priority:** P0
**Risk:** Critical
**Dependencies:** T13–T16

### Goal
Validate the real target environment and perform a controlled deployment with operational evidence.

### Required external inputs
- production host/container platform,
- production PostgreSQL,
- production `APP_URL`, `AUTH_SECRET`, `METRICS_TOKEN`, DB/Jira secrets,
- TLS/domain/ingress,
- centralized log backend,
- Prometheus-compatible metrics collector,
- alert delivery/on-call ownership,
- backup destination and release/rollback authorization.

### Acceptance Criteria
- [ ] Production secrets are secret-managed and absent from source/image/logs.
- [ ] Pre-migration backup exists outside application host.
- [ ] target migration + parity PASS.
- [ ] deployment uses reviewed immutable artifact.
- [ ] HTTPS/domain operational.
- [ ] health/readiness PASS behind target ingress.
- [ ] central logs receive structured events.
- [ ] metrics collector authenticates and scrapes every replica.
- [ ] critical alerts are configured and test-delivered.
- [ ] target browser smoke PASS.
- [ ] rollback owner/artifact/process verified.

### Safety
Never perform destructive production DB operations without verified target, backup and rollback authorization.

---

## T18 — Final adversarial review and LIVE PRODUCTION GO
**Status:** BLOCKED_EXTERNAL (until T14–T17 as applicable)
**Priority:** P0
**Risk:** Critical
**Dependencies:** all P0 tasks

### Goal
Issue an objective GO/NO-GO decision based on evidence, not implementation confidence.

### Final review scope
Auth bypass, privilege escalation, cross-tenant/object access, CSRF, sessions, brute force, secrets/logging, SQL/data integrity, immutable historical state, unsafe inputs/URLs, dependency vulnerabilities, debug exposure, deployment/rollback/DR.

### Acceptance Criteria
- [ ] No unresolved P0/P1 defects.
- [ ] Required real Jira gate PASS or Jira production feature explicitly disabled/accepted by release owner.
- [ ] Remote CI PASS.
- [ ] Deployment/runtime gates PASS for actual target architecture.
- [ ] Backup/restore, monitoring and alerts operational.
- [ ] `docs/RELEASE_CHECKLIST.md` completed with environment-specific evidence.
- [ ] `G15 LIVE PRODUCTION GO = PASS` in `docs/RELEASE_GATES.md`.

### Stop condition
Until every required external gate has evidence, final state remains `NO_GO_EXTERNAL_GATES_OPEN` even when all repository/local tasks are complete.
