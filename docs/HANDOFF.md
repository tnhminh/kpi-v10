# Agent Handoff

## Project
KPI Performance Management Studio

## Repository
`E:\kpi-v10`

## Product intent
A configurable, explainable, versioned KPI performance-management platform. The core invariants are historical reproducibility, period-aware membership/version resolution, human review, and immutable locked results.

## Current implementation
The UI is a Next.js 16 / React 19 / TypeScript application. `src/components/app-gateway.tsx` session-gates the shell, resolves authenticated organization access, and refuses silent seed fallback when persistence/auth infrastructure is unavailable. `src/components/studio.tsx` is the visual shell, while `src/components/kpi-builder.tsx` is the persisted KPI configuration workspace.

Teams, Members, KPI Templates, KPI Builder, Metric Library, Scoring Rules, Rank Schemes, Evaluation Periods, System Evaluation, Leader Review, Department Head Calibration, Data Quality, Executive Dashboard, Jira Control Center, Audit Log, and Historical Analytics now use authenticated organization-scoped APIs as authority. The active shell no longer imports `src/lib/kpi.ts`; that file is legacy fixture data only and must not be reintroduced as production authority. Development Jira evidence is persisted separately through `scripts/seed-local-jira-demo.mjs`.

## Productionization rule
Before starting work, read:
1. `docs/PRODUCTION_PLAN.md`
2. `docs/STATUS.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DECISIONS.md`
5. `docs/QA.md`

After every task:
- update status;
- record verification evidence;
- record architectural decisions if introduced;
- note any remaining risks and the exact next task.

## Domain invariants that must never regress
- Criterion score is bounded by its configured maximum.
- Final KPI is bounded by configured total/rules.
- NOT_EVALUATED is distinct from zero.
- Missing data is not poor performance.
- Evaluations resolve the member's team membership for the evaluation period.
- Historical evaluations retain the KPI version actually used.
- Finalized reviews are never silently overwritten by later Jira changes.
- Locked snapshots are immutable.
- Human score changes of material size require an auditable reason.
- AUTO/ASSISTED scores expose Input → Metric → Rule → Score → Confidence → Evidence.
- Creating a new team/KPI never requires a team-name-specific source branch.

## T03 completed behavior
- Deterministic threshold, range, formula and hybrid scoring is implemented in `src/domain/kpi`.
- Formula evaluation uses a repository-owned parser; it does not use `eval`/`Function`.
- Missing metric inputs produce NOT_EVALUATED rather than zero.
- Criterion/KPI score bounds and malformed external criterion data are rejected.
- Rank schemes reject gaps/overlaps and rank is resolved only after aggregate score calculation.
- Membership/KPI version resolution is period-aware and rejects invalid calendar dates/ambiguity.
- Recalculation, finalization, lock, adjustment reason and historical aggregation policies are pure/testable domain code.
- Final T03 verification: lint PASS, typecheck PASS, 46/46 unit tests PASS, production build PASS.

## T04 completed behavior
- Passwords use Node scrypt with fixed production parameters `N=131072, r=8, p=1`, random salts, and timing-safe derived-key comparison.
- Unknown-account logins still execute the same KDF path using a valid dummy hash to reduce account-enumeration timing differences.
- Browser receives a high-entropy opaque session token; PostgreSQL stores only `HMAC-SHA256(AUTH_SECRET, token)`.
- Session cookie is `HttpOnly`, `SameSite=Strict`, `Path=/`, 8-hour TTL, and `Secure` in production.
- Session resolution rejects revoked, expired, or inactive-user sessions on the server.
- Login failure throttling is shared in PostgreSQL using an HMAC-normalized email key; raw email is not stored in the throttle table.
- Mutation routes use origin / Fetch Metadata protection in addition to Strict SameSite cookies.
- Roles/permissions come from the server-side session user, never from the prototype role selector or client payload.
- Coarse RBAC is paired with resource-scope policy helpers (`canReviewTeam`, `canReadMemberEvaluation`). Future APIs must resolve actual team leadership/member identity from DB before invoking these helpers; possession of the coarse permission alone is insufficient.
- Routes implemented: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`.
- Migration `0002_auth_hardening.sql` adds case-insensitive user-email uniqueness and shared login-attempt state.
- Final T04 verification: lint PASS, typecheck PASS, 13 test files / 64 tests PASS, production build PASS, security review completed.

## T05-A completed checkpoint
- Added explicit `user_organization_access` scope with an organization-specific role; organization IDs are resolved against the authenticated user before tenant data access.
- Added protected APIs for accessible organizations, Teams, Members, Member Memberships, and KPI Templates.
- Team/Member/KPI writes use server RBAC + organization scope + browser mutation guard; no client role is trusted.
- Primary membership writes use a member-scoped PostgreSQL advisory transaction lock plus overlap validation.
- Added case-insensitive uniqueness indexes for member email, team name within department, and KPI template name within organization.
- Expected PostgreSQL unique violations are mapped to HTTP 409 rather than generic 500 responses.
- Vitest now resolves the same `@` alias as TypeScript/Next via `vitest.config.mts`.
- Verification: lint PASS, typecheck PASS, 16 test files / 73 tests PASS, production build PASS.

## T05-B completed checkpoint
- Added protected, tenant-scoped APIs for Metric Definitions, KPI Versions, version detail, Criteria, Metric Configuration, Scoring Rules, and lifecycle transitions.
- KPI version cloning runs transactionally under a template advisory lock and copies criterion/metric/rule configuration into a new DRAFT without rewriting the source.
- A draft is editable only before submission. Submission requires criteria max scores to total exactly 10; AUTO/ASSISTED criteria need a metric plus scoring rule; mandatory evidence needs a configured source.
- Formula syntax validation reuses the same repository-owned parser as runtime scoring; invalid custom metric/scoring formulas are rejected before persistence.
- `kpi:manage` and `kpi:approve` are separate permissions: Department Head can approve but cannot edit configuration; Administrator retains both.
- Lifecycle is submit (DRAFT + `submittedAt`) → approve (DRAFT + `approvedAt/approvedBy`) → publish (`PUBLISHED`) → retire (`RETIRED`).
- Configuration mutations and lifecycle transitions serialize by KPI-version advisory lock. Criterion child mutations re-read version status after lock acquisition so a concurrent submit cannot race with a stale edit.
- Migrations `0004`/`0005` add KPI ordering/uniqueness constraints and PostgreSQL triggers that freeze submitted criteria/metric/rules, protect lifecycle timestamps, and enforce monotonic lifecycle state. Draft cascade deletion is explicitly preserved.
- Code/offline verification before documentation closeout: lint PASS, typecheck PASS, 18 test files / 85 tests PASS, production build PASS. Review rounds found and fixed formula-validation, total>10, DB immutability, cascade and lock-order gaps.
- At the original T05-B checkpoint, live trigger/migration execution was not claimed because an authorized `DATABASE_URL` was not yet available. This environment blocker was later cleared; local PostgreSQL migrations through `0010` and T06/T07 live integrity probes have since passed.

## T05-C completed checkpoint
- The product shell is gated by `/api/auth/me`; 401 renders login, infrastructure errors render an explicit unavailable state, and successful sessions load only organizations authorized for the user.
- The client role switcher was removed as authority. Header identity, organization role, organization selection, and logout come from authenticated server state.
- Teams, Members, and KPI Templates load/mutate through protected tenant-scoped APIs.
- `src/components/kpi-builder.tsx` loads persisted templates, versions, criteria, metric definitions, metric configuration, scoring rules, and lifecycle state. Local component state is only an unsaved edit buffer.
- Draft selection is revalidated against the currently loaded template/version lists, avoiding stale cross-organization/template IDs.
- Evidence editing preserves multiple configured sources. Threshold-rule edits preserve existing RANGE/FORMULA/HYBRID rules instead of replacing unrelated rules.
- Submitted drafts are read-only in the UI; changes require cloning a new draft. Server and PostgreSQL immutability guards remain the authority.
- Client transport/state coverage now includes KPI route payload/error handling and builder selection behavior.
- Final T05-C code/offline verification: lint PASS, typecheck PASS, 20 test files / 92 tests PASS, production build PASS.

## T06 completed checkpoint
- `src/server/evaluation/pipeline.ts` is the single canonical scoring orchestration path; the duplicate engine was removed.
- `CollectedMetricInputProvider` is the trusted input-provider boundary. Raw clients never submit a system score; the server derives scores from configured metrics/rules.
- Protected period/assignment/lifecycle/evaluation/result APIs resolve effective membership → team → period KPI assignment before scoring and persist `resolvedMembershipId`/team/KPI version.
- MANUAL criteria remain unscored by the system. Missing/critical inputs remain NOT_EVALUATED/REVIEW_REQUIRED, never zero.
- Evidence and data-quality issues persist with criterion results; ordered rule fallback stops at the first EVALUATED rule.
- `evaluation:run` and `evaluation:ingest` are separate. Department Head can operate evaluation flow but trusted facts/evidence ingestion is Administrator-only at the current boundary.
- Migrations `0007_evaluation_historical_integrity.sql` and `0008_evaluation_resolution_freeze.sql` freeze submitted metric semantics, freeze period assignments for INSERT/UPDATE/DELETE after collection starts, and require exact persisted membership resolution.
- Live PostgreSQL verification: 14/14 eligible members persisted, 55 evaluated criteria, one deliberate critical-data member remained NOT_EVALUATED; period reached SYSTEM_EVALUATED. Trigger probes confirmed semantic metric edits, assignment UPDATE/DELETE, null membership, and mismatched membership are blocked.
- Final automated gates: lint PASS, typecheck PASS, 22 test files / 106 tests PASS, Next.js 16.3.2 production build PASS. Browser click-through remains environment-blocked because the ChatCode browser engine is unavailable.

## T07 completed checkpoint
- `src/server/review/repository.ts` is authoritative for Leader Review, Department Head review, quality resolution/waiver, finalization, ranking, snapshot lock and period workflow advancement.
- `src/components/review-workspace.tsx` replaces seeded Leader Review/Calibration authority with persisted API-backed criterion layers and quality actions.
- Team Leader scope resolves effective team leadership for the period. Department Head scope resolves effective `department_head_assignments`; Administrator is the explicit cross-scope bypass.
- Human changes are layered system → leader → head → final. Changed criterion values append adjustment records with before/after/reason/actor; system evidence/scores are not destructively overwritten.
- Unresolved CRITICAL data quality blocks finalization. Department Head/Admin may explicitly RESOLVE or WAIVE an issue only with disposition, reason, actor and timestamp; resolved quality records are immutable.
- Finalization requires complete Head scores, derives final KPI/rank, and persists final metadata. Locking creates a canonical historical payload plus SHA-256 checksum before the evaluation becomes LOCKED.
- `0009_review_finalization_lock.sql` enforces lifecycle monotonicity, finalized/locked result immutability, append-only adjustments, quality freeze and historical-snapshot immutability at PostgreSQL boundary.
- `0010_review_scope_quality_resolution.sql` adds period-effective Department Head assignments and auditable quality-resolution metadata/guards.
- Live local proof: 14 review rows available; Department Head queue 0 without assignment → 14 with effective assignment → 0 after removal. A deliberate critical-data member was Head-reviewed, explicitly waived with reason, finalized and locked; PostgreSQL blocked mutation of the LOCKED evaluation, historical snapshot and resolved quality record.
- Final automated gates: lint PASS, typecheck PASS, 24 test files / 116 tests PASS, Next.js 16.3.2 production build PASS. Browser click-through remains environment-blocked by unavailable ChatCode browser capability.

## T08 completed checkpoint
- T08-A: Jira connector, explicit member mapping, sync-run history, mutable raw/current facts, protected Admin-only Jira APIs and API-backed Jira Control Center are implemented. `0011_jira_sync_foundation.sql` is applied locally and credentials remain external through `secretRef`.
- Local Jira evidence remains production-shaped: 14 member mappings, 87 current fact rows, 84 mapped + 3 intentional unmapped issues, with controlled missing-field fixtures in `docs/JIRA_DEMO_DATA.md`.
- T08-B code/offline path is now implemented. `src/server/jira/evaluation-provider.ts` aggregates Jira current facts by member/period/metric for on-time completion, reopen rate, median incident resolution time and proactive detections. Missing required observations become CRITICAL/REVIEW_REQUIRED rather than zero.
- `POST .../evaluate-jira` uses `evaluation:run` and never accepts raw facts or system scores from the browser. It resolves eligible members/server configuration, evaluates through the canonical pipeline, persists evidence, and freezes exact contributing issue facts into `jira_fact_snapshots`.
- Once an evaluation has Jira snapshots, reruns use the frozen snapshot set rather than mutable current Jira state. Existing recalculation policy blocks silent changes after Leader Review and later lifecycle states; PostgreSQL already makes `jira_fact_snapshots` immutable.
- System Evaluation now exposes `Run Jira evaluation` for COLLECTING/SYSTEM_EVALUATED periods.
- Final automated gate after T08-B: lint PASS, typecheck PASS, 28 test files / 128 tests PASS, Next.js 16.3.2 production build PASS including `/evaluate-jira`.
- Live T08-B API+DB proof now PASS: `npm run db:evaluate:jira-demo` creates a short-lived verifier identity with a random in-process password, evaluates 14/14 eligible members twice, persists 14 member evaluations and 84 contributing issue snapshots, deliberately mutates one Jira current-fact row, and verifies both snapshot digest and persisted evaluation scores remain unchanged on rerun. The script restores the mutated fact and removes the verifier identity in `finally` cleanup. Four seeded incomplete-data members remain CRITICAL as expected.
- Real Atlassian credentialed sync remains unverified and must be completed before production release; no Jira token is stored by the proof workflow.

## T09 completed checkpoint
- `audit_events` is tenant-scoped and append-only at the PostgreSQL boundary. Migration `0012_audit_history_authority.sql` adds organization ownership plus UPDATE/DELETE rejection; `0013_audit_actor_retention.sql` changes audited actor retention to `ON DELETE RESTRICT` so audit references cannot be nullified by a later hard-delete.
- Audit writes persist actor, request ID, action, entity type/id, before/after state, reason/metadata, and an actor identity snapshot. Request IDs are the same correlated IDs returned by the HTTP layer.
- Sensitive mutations now append audit events in the same transaction as the business write for review/finalize/lock, critical-quality resolution/waiver, KPI lifecycle/configuration, Team/Member/Membership/KPI Template changes, Jira connection/member mapping changes, and Evaluation Period creation/assignment/start-collection changes. If audit persistence fails, the business transaction cannot commit.
- Audited users are retained historically: hard-delete is blocked once referenced by audit; operational removal is deactivation/revocation instead. The audit actor reference and identity snapshot remain readable after deactivation.
- Audit Log and Historical Analytics UI routes are API-backed and PostgreSQL-authoritative rather than seed-backed.
- Historical analytics only aggregates valid FINALIZED/LOCKED evaluation values. Non-final persisted rows contribute to coverage denominator/state visibility but are never converted to zero or averaged as final outcomes.
- Live proof `npm run db:proof:audit-history` PASS: login 200; requestId correlation true; logically idempotent Jira mapping mutation true; audit UPDATE/DELETE blocked; audited-actor hard-delete blocked; actor reference/snapshot preserved after deactivation; historical organization score 8.72 from 14 valid / 28 total evaluations.
- Final T09 automated gate: lint PASS, typecheck PASS, 29 test files / 134 tests PASS, Next.js 16.3.2 production build PASS.

## T10 hardening checkpoint (in progress)
- T10-A: `output: "standalone"`, non-root multi-stage `Dockerfile`, `.dockerignore`, GitHub CI workflow, migration parity verification, `docs/OPERATIONS.md`, and `docs/RELEASE_CHECKLIST.md` are in repo. Local parity is 13/13 migrations; `npm audit --omit=dev` reports 0 vulnerabilities; standalone server boot returned `/api/health` 200 and `/api/ready` 200. Docker image build is not claimed because Docker CLI is absent in this environment.
- T10-B: `src/components/dashboard-workspace.tsx` replaced hard-coded executive dashboard numbers with role-scoped persisted History/Evaluation/Teams/Members APIs. Live proof: 6 teams, 14 members, 14 current evaluations, history score 8.72 and coverage 14/28.
- T10-C: Metric Library, Scoring Rules, Data Quality and Rank Schemes are API-backed through `src/components/configuration-insights-workspace.tsx`; `/kpi/rank-schemes` validates stored bands with the domain validator; Evaluation Period creation can persist a selected rank scheme. Live proof: 4 metrics, 1 scheme/7 bands, 8 persisted scoring rules and 3 persisted quality issues.
- T10-D: KPI configuration writes now carry actor/requestId and append audit in the same transaction for metric creation, version cloning, criterion create/update/delete, criterion metric binding and scoring-rule replacement. Live idempotent criterion proof correlated `KPI_CRITERION_UPDATED` to the HTTP request ID and confirmed actor retention.
- T10-E: `src/components/administration-workspace.tsx` is now the Administration Settings authority. It lists organization users, displays period-effective Department Head scope history, creates assignments, and closes active assignments without retroactively rewriting historical scope. Repeatable live proof correlated both create/close mutations to append-only audit request IDs while retaining the historical effective range.
- T10-F: Administrator onboarding provisions a new user + organization access + optional one-to-one member link atomically. `0014_user_onboarding.sql` adds `password_change_required`, `password_changed_at`, and a unique non-null member↔user index. Temporary sessions are blocked from organization APIs until `/api/auth/password` rotates the password; rotation revokes other sessions and appends non-secret `PASSWORD_CHANGED` audit events. Repeatable live proof verified provisioning/member-link/audit, no password material in audit, forced org-access block, successful rotation, old temporary-password rejection and new-password acceptance. Optional member linkage is serialized with a member-scoped PostgreSQL advisory transaction lock and a conditional `user_id IS NULL` update; Drizzle-wrapped PostgreSQL unique conflicts are normalized to HTTP 409.
- T10-G: `src/proxy.ts` injects request correlation/start metadata for `/api/*` without becoming an authorization boundary; `src/server/http.ts` emits structured request-completion telemetry and Prometheus request/error/latency metrics; `src/instrumentation.ts` captures uncaught framework request errors; readiness exports status metrics; `/api/metrics` is Prometheus-compatible and requires an independent `METRICS_TOKEN` in production. Route labels normalize UUID/numeric identifiers to bound cardinality. Local proof on port 3712 verified health/readiness correlation + `Server-Timing`, unauthenticated 401 error telemetry, and request/duration/error/readiness metric output.
- Structured logger redacts sensitive-key fields, bearer tokens and credential-bearing URLs before JSON emission, safely handles Error/circular values, and prevents caller fields from overriding the canonical timestamp/level/message/service envelope.
- Current full gate: lint PASS, typecheck PASS, 31 test files / 146 tests PASS, Next.js 16.3.2 production build PASS.

## Current next action
T10 remains in progress. Administration onboarding, Department Head assignment management, and repository/local observability hooks are complete. Remaining priorities are browser/E2E regression, real Atlassian credentialed sync, production/CI runtime validation (including Docker image build and backup restore rehearsal), and target-environment central log/metrics ingestion plus alert validation.

## Environment state
A local PostgreSQL 18 development database is now provisioned for this project. Migrations `0001`–`0014` were applied successfully on 2026-08-25; the initial reserved-keyword defect in migration `0001` for `team_memberships."primary"` was fixed before the fresh migration baseline completed. A local administrator was provisioned through `scripts/bootstrap-local-admin.mjs`, and live `/api/ready`, `/api/auth/login`, and authenticated `/api/organizations` calls returned HTTP 200.

Local persistent demo data is provisioned through `npm run db:seed:local` (`scripts/seed-local-demo.mjs`). Current seed contents: Backend Department; 6 teams (API/CMS/Ads/Payment/R&D/Database); 14 members including leaders; effective primary memberships/leadership; reusable metric definitions; Backend Engineering KPI v1 PUBLISHED plus editable v2 DRAFT with 5 criteria/scoring rules; Backend 2026 rank scheme; and 2026-09 period assignments to the published KPI. Authenticated API verification returned Teams=6, Members=14, Templates=1, versions `v2:DRAFT,v1:PUBLISHED`, and 5 v2 criteria.

Production-shaped local Jira demo evidence is provisioned through `npm run db:seed:jira-demo` (`scripts/seed-local-jira-demo.mjs`). It currently persists one demo Jira workspace, 14 explicit account mappings, 87 issues/current normalized fact rows (84 mapped, 3 intentionally unmapped), a successful demo sync-run, and controlled missing-field fixtures for Data Quality. No Jira token is stored. The full field/fact contract is in `docs/JIRA_DEMO_DATA.md`.

Secrets remain local-only in git-ignored `.env.local`; do not copy them into source, docs, logs, CI, or production. Local T07/T08 probes use short-lived verification identities/passwords only in process memory and clean them up after use. Production/CI database provisioning remains outstanding. Local production-style user onboarding is now implemented and live-proven through Administration Settings with forced first-login password rotation. Browser interaction/reload coverage remains environment-blocked while ChatCode browser capability is unavailable.
