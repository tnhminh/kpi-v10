# Quality & Verification Log

## Quality gates
For each task, run all relevant gates:

- Static analysis / lint
- TypeScript typecheck
- Unit tests
- Integration tests when affected
- Production build
- Security/data-integrity review
- Documentation consistency review

## T00 — Governance and handoff baseline
**Status:** PASS

Verification:
- [x] Documentation files exist and agree on current status.
- [x] `npm run lint` passes (2026-08-24).
- [x] `npm run build` passes (2026-08-24, Next.js 16.3.2, TypeScript pass).
- [x] Documentation consistency review confirms the project remains marked NOT READY for production.

## T01 — Production foundation
**Status:** PASS

Verification:
- [x] Environment contract is runtime-validated without committing secrets.
- [x] Security headers/CSP are configured in `next.config.ts`.
- [x] `/api/health` and `/api/ready` exist.
- [x] Structured JSON logging and request IDs are available to server code.
- [x] Zod-backed request validation/API error helpers exist.
- [x] Lint/typecheck/tests/build pass.
- [x] Code/security/doc consistency review completed; no T01 blocker remains.

## T02 — PostgreSQL domain model
**Status:** PASS (code/offline verification)

Verification:
- [x] Schema covers organization, effective memberships/leadership, KPI versions, metrics/rules, periods/evaluations, reviews/adjustments, Jira facts/evidence, rank schemes, users/sessions, audit events, notifications, data quality, and historical snapshots.
- [x] Nullable score columns preserve NOT_EVALUATED separately from zero; score/date/reason constraints exist where feasible.
- [x] Migration SQL is explicit and reviewable.
- [x] Migration application + tracking are atomic per migration transaction.
- [x] Database client is lazy and does not connect during build.
- [x] `/api/ready` validates configuration then executes a DB ping when configuration is available.
- [x] npm audit returned 0 known vulnerabilities after removing vulnerable migration tooling at T02 checkpoint.
- [x] Local live migration execution (2026-08-25): PostgreSQL 18 `kpi_v10_dev` applied migrations `0001`–`0006` successfully. The initial reserved-keyword defect in `team_memberships.primary` was fixed to quoted `"primary"` before the fresh migration completed.

## T03 — Domain services and scoring engine
**Status:** PASS

Verification:
- [x] NOT_EVALUATED remains a first-class state and is never converted to score zero.
- [x] Threshold/range/formula/hybrid rules are deterministic; formula parser does not use dynamic code execution.
- [x] Criterion score bounds, KPI total bounds and malformed external criterion scores are rejected.
- [x] Rank schemes reject gaps/overlaps and rank/coefficient are resolved after aggregation.
- [x] Period-aware membership/KPI assignment resolution works and rejects ambiguous membership/assignment state.
- [x] ISO date validation rejects impossible calendar dates rather than allowing JS date normalization.
- [x] Recalculation/finalization/lock guards match policy.
- [x] Manual adjustment bounds/reason threshold are enforced and invalid thresholds are rejected.
- [x] Historical aggregation ignores only explicit N/A (`null`), rejects non-finite/invalid final values, reports coverage, then resolves rank.
- [x] Final lint PASS.
- [x] Final typecheck PASS.
- [x] Final unit suite PASS: 9 test files / 46 tests.
- [x] Final Next.js production build PASS.
- [x] Post-test code review found and fixed strict-date, non-finite historical-score and external criterion validation gaps; full tests/build rerun after fixes.
- [x] Documentation consistency review completed; project still correctly marked NOT READY.

## T04 — Authentication and RBAC
**Status:** PASS (code/offline verification)

Verification:
- [x] Password hashing uses fixed-cost scrypt `N=131072, r=8, p=1`, random salt and `timingSafeEqual`.
- [x] Malformed password hashes cannot request attacker-controlled KDF cost parameters; verifier accepts only the configured cost tuple.
- [x] Unknown-account login executes a real dummy scrypt verification path to reduce account-enumeration timing differences.
- [x] Raw session tokens are never persisted; only AUTH_SECRET-keyed HMAC hashes are stored.
- [x] Session cookie is HttpOnly, SameSite=Strict and Secure in production.
- [x] Session expiry, revocation and inactive-user checks are server-side.
- [x] Login failure throttling is persisted/shared in PostgreSQL and keyed by HMAC-normalized email rather than raw address.
- [x] `0002_auth_hardening.sql` adds case-insensitive email uniqueness to avoid ambiguous identities.
- [x] Client-supplied roles are never used as authority; identity/role come from the DB-backed session.
- [x] Permission policy covers privileged role actions and resource-scope helpers prevent Team Leader cross-team access when supplied resolved leadership scope.
- [x] Login/logout/me handlers expose no password/session hash material and use generic invalid-credential responses.
- [x] Browser mutation origin/Fetch Metadata guard exists in addition to Strict SameSite cookies.
- [x] Final lint PASS after security hardening.
- [x] Final typecheck PASS after security hardening.
- [x] Final unit suite PASS: 13 test files / 64 tests.
- [x] Final Next.js production build PASS with `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`.
- [x] Security review completed after initial green build; review led to stronger scrypt work factor and explicit resource-scope authorization helpers, then all gates were rerun.
- [x] Documentation updated to avoid claiming the prototype UI is authenticated.
- [x] Local live login/session integration (2026-08-25): `/api/ready` 200, credentialed `/api/auth/login` 200, session cookie accepted, and authenticated `/api/organizations` 200 for the provisioned local administrator.

## T05 — Organization + KPI APIs
**Status:** PASS — T05-A/T05-B/T05-C complete; code/offline gates passed at the original checkpoint and later local PostgreSQL/API integration was completed during T06/T07. Browser reload persistence remains a separate pending gate.

T05-A verification:
- [x] Explicit user-to-organization access scope exists with an organization-specific role.
- [x] Organization/Team/Member/Membership/KPI Template API queries are tenant-scoped through authenticated organization access.
- [x] Writes use server-side RBAC and do not trust client roles or arbitrary organization IDs.
- [x] Primary membership effective-date overlap is validated under a member-scoped transaction lock.
- [x] Case-insensitive uniqueness is enforced for member email, team name, and KPI template name at the DB boundary.
- [x] Expected uniqueness conflicts map to HTTP 409 instead of leaking as generic 500 responses.
- [x] Unit/static contract tests cover tenant-role policy, membership overlap, migration scope contract, and DB conflict mapping.
- [x] Lint PASS.
- [x] Typecheck PASS.
- [x] Unit suite PASS: 16 test files / 73 tests.
- [x] Production build PASS with Organization/Team/Member/Membership/KPI Template dynamic routes.
- [x] Security/data-integrity review completed and hardening rerun through all gates.

T05-B verification:
- [x] KPI Version/Criteria/Metric/Scoring routes are authenticated, organization-scoped, Zod-validated, and configuration-driven.
- [x] Version cloning is serialized per template and transactionally copies criteria, metric configurations, and scoring rules without mutating the source version.
- [x] Criterion maximums cannot exceed KPI total 10 during editing; submission requires an exact total of 10.
- [x] AUTO/ASSISTED criteria require metric configuration and at least one valid scoring rule before submit.
- [x] Required-evidence criteria require at least one configured evidence source.
- [x] Formula rules and custom metric formulas use the repository-owned parser for syntax validation before persistence; no dynamic code execution is used.
- [x] Lifecycle order is enforced as submit → approve → publish → retire; Department Head/Admin approval is separated through `kpi:approve` from configuration authority `kpi:manage`.
- [x] Submitted KPI configuration is frozen in application services and again through PostgreSQL triggers on criteria/metric/rule mutations and lifecycle timestamps/state.
- [x] Criterion mutations serialize against lifecycle transitions with a version advisory lock and re-read authoritative state after acquiring the lock, preventing stale submit-vs-edit races.
- [x] Draft criterion deletion remains valid through cascades while submitted direct child mutations remain guarded.
- [x] Case-insensitive criterion-name/metric-key uniqueness and nonnegative ordering/version constraints are present in explicit migrations.
- [x] Three post-green code/data-integrity reviews were performed; discovered formula syntax, total>10 mapping, DB immutability, cascade, lifecycle monotonicity, and lock-order gaps were fixed before PASS.
- [x] Final pre-doc lint PASS, typecheck PASS, unit suite PASS: 18 test files / 85 tests, production build PASS.
- [x] Local migration execution verified through `0006` on PostgreSQL 18. Trigger definitions are now installed locally; full mutation-trigger behavior and browser/API persistence regression coverage remain separate T06+ integration work.

T05-C verification:
- [x] Product shell is session-gated; 401 renders login and backend/configuration failures do not silently fall back to seeded production data.
- [x] Authenticated organization access drives organization selection and the displayed organization role; the client demo role switcher is removed as authority.
- [x] Teams, Members, and KPI Templates load/mutate through authenticated tenant-scoped APIs.
- [x] KPI Builder uses protected APIs for templates, versions, criteria, metric configuration, scoring rules, version cloning, and lifecycle transitions.
- [x] Submitted drafts render read-only and require cloning before configuration changes; server/DB immutability remains authoritative.
- [x] Builder state revalidates selected template/version IDs against current organization-scoped results to avoid stale cross-scope selection.
- [x] Multi-source evidence is preserved, and editing a threshold rule preserves unrelated RANGE/FORMULA/HYBRID rules.
- [x] Client transport/state tests cover KPI endpoint methods/payloads, correlated API errors, and builder selection behavior.
- [x] Final lint PASS.
- [x] Final typecheck PASS.
- [x] Final unit suite PASS: 20 test files / 92 tests.
- [x] Final Next.js 16.3.2 production build PASS with authenticated organization/KPI UI and protected API routes.
- [x] Final T05 code/data-integrity/security/documentation review completed.
- [x] Local persistent demo-seed smoke test (2026-08-25): seed script syntax and ESLint PASS; authenticated API reads returned Teams=6, Members=14, Templates=1; KPI versions `v2:DRAFT,v1:PUBLISHED`; v2 detail contains 5 criteria.
- [ ] High-value UI mutations persist across browser reload against the credentialed local migrated DB: environment is now available; browser persistence regression is still pending.
- [ ] Live database integration/trigger behavior coverage: migrations execute locally, but trigger mutation cases and broader protected API integration tests still need explicit coverage.

## T06 — Evaluation pipeline
**Status:** PASS (code + live local PostgreSQL/API integration; browser smoke environment-blocked)

Verification:
- [x] Period, assignment, collection lifecycle, evaluation execution and evaluation-result APIs are authenticated and organization-scoped.
- [x] Effective primary membership and period KPI assignment are resolved server-side; exact membership/team/KPI version are persisted with each member evaluation.
- [x] System scores are derived by the canonical evaluation pipeline from metric inputs + configured rules; clients do not submit authoritative scores.
- [x] MANUAL criteria remain system NOT_EVALUATED and missing/critical input never becomes zero.
- [x] Ordered scoring-rule fallback, custom-formula inputs, evidence source validation, required fields/evidence and critical data-quality behavior are unit-covered.
- [x] Evidence and data-quality issues persist at criterion/member evaluation scope.
- [x] `evaluation:run` is separated from privileged trusted-input `evaluation:ingest`; Department Head does not gain raw fact-ingestion authority.
- [x] Recalculation is blocked after human review begins; System Evaluation UI does not expose an unsafe empty-payload rerun action.
- [x] Migration `0007` freezes semantics of metric definitions referenced by submitted KPI versions and freezes assignments once collection starts.
- [x] Migration `0008` covers assignment INSERT/UPDATE/DELETE/move shapes after collection start and requires exact resolved membership for new/touched member evaluations.
- [x] Live PostgreSQL trigger probes block semantic metric edits, assignment UPDATE/DELETE, null resolved membership, and mismatched membership; probes use transaction rollback.
- [x] Live local batch: 14 eligible members sent/persisted, 14 completed, 55 criterion scores persisted, one deliberately critical-data member preserved as review-required/NOT_EVALUATED; period reached SYSTEM_EVALUATED.
- [x] Final lint PASS.
- [x] Final typecheck PASS.
- [x] Final unit suite PASS: 22 test files / 106 tests.
- [x] Final Next.js 16.3.2 production build PASS with evaluation routes.
- [ ] Browser click-through for Evaluation Periods/System Evaluation: environment-blocked because ChatCode browser capability reports unavailable; no false PASS recorded.

## T07 — Human review, finalization, and lock
**Status:** PASS (code + live local PostgreSQL/API integration; browser smoke environment-blocked)

Verification:
- [x] Leader Review and Department Head Calibration use persisted protected APIs rather than seeded score authority.
- [x] Team Leader scope is effective-period team leadership; Department Head scope is effective-period `department_head_assignments`; Administrator is the explicit broader bypass.
- [x] Live scope proof: Department Head queue returned 0 evaluations without assignment, 14 with an effective assignment to the resolved department, and 0 again after assignment removal.
- [x] Review is layered system → leader → head → final; system values/evidence are preserved rather than destructively overwritten.
- [x] Criterion changes persist append-only adjustment records with actor/reason and are bounded by configured criterion maximums/domain adjustment policy.
- [x] CRITICAL quality issues block finalization until explicitly RESOLVED or WAIVED with disposition, non-empty reason, actor and timestamp.
- [x] Resolved/waived quality records are immutable at PostgreSQL boundary.
- [x] Finalization requires complete Head scores and derives aggregate final score plus configured rank/coefficient.
- [x] Lock creates a canonical historical snapshot with SHA-256 checksum before transitioning evaluation state to LOCKED.
- [x] `0009_review_finalization_lock.sql` enforces monotonic review/final lifecycle, final/locked result immutability, append-only adjustments, evidence/quality freeze and immutable historical snapshots.
- [x] `0010_review_scope_quality_resolution.sql` adds Department Head effective scope and auditable quality-resolution integrity.
- [x] Live end-to-end proof advanced a critical-data member through human review → quality waiver → finalization → LOCKED with final score/rank and persisted checksum snapshot.
- [x] Live DB mutation probes blocked LOCKED evaluation rewrite, historical-snapshot rewrite and resolved-quality rewrite.
- [x] Client transport contract covers Leader/Head review, quality resolution, finalize and lock routes/payloads without client authority fields.
- [x] Final lint PASS.
- [x] Final typecheck PASS.
- [x] Final unit suite PASS: 24 test files / 116 tests.
- [x] Final Next.js 16.3.2 production build PASS with review/quality/finalize/lock dynamic routes.
- [ ] Browser click-through for Leader Review/Calibration: environment-blocked because ChatCode browser capability reports unavailable; no false PASS recorded.

## T08 — Jira integration boundary
**Status:** PASS — code + live local PostgreSQL/API snapshot-integrity proof; real Atlassian credentialed sync and browser click-through remain production/integration gates

Verification:
- [x] Migration `0011_jira_sync_foundation.sql` applied to local PostgreSQL.
- [x] Jira connection stores only a secret reference; API/client contracts do not accept or return a Jira token/password.
- [x] Jira member attribution is explicit through connection-scoped member↔account mappings with tenant DB guards.
- [x] Sync runs persist RUNNING/SUCCEEDED/FAILED state, counts and retryability/error metadata.
- [x] Raw Jira issue payload and mutable normalized current facts are separated from immutable `jira_fact_snapshots`.
- [x] Admin-only Jira Control Center reads persisted connections, mappings, runs and normalized facts rather than `src/lib/kpi.ts`.
- [x] `npm run db:seed:jira-demo` is syntax/ESLint-clean, disabled in production, idempotent for issue/fact rows and demo sync state, and stores no credential material.
- [x] Live local Jira demo seed: 14 mappings, 87 Jira-shaped issues/facts, 84 mapped + 3 intentional unmapped, 5 missing completion-date observations, 3 missing story points and 4 missing resolution minutes.
- [x] Demo facts cover current KPI adaptation signals for on-time completion, reopen rate, incident resolution time and proactive detection plus future quality/SLA/rework/time-tracking fields.
- [x] T08-A/demo-evidence closeout full gate: lint PASS, typecheck PASS, 27 test files / 124 tests PASS, Next.js 16.3.2 production build PASS with Jira connection/mapping/sync/run/fact routes.
- [ ] Real Atlassian credentialed connector sync has not yet been integration-tested.
- [x] T08-B server-owned `JiraMetricInputProvider` aggregates period/member facts for on-time completion, reopen rate, median incident resolution time and proactive detections; required missing observations surface CRITICAL/REVIEW_REQUIRED rather than zero.
- [x] `/evaluate-jira` requires `evaluation:run`, accepts only optional member IDs, resolves server-owned facts/configuration, and persists canonical pipeline evidence/results without browser-supplied facts/scores.
- [x] Exact contributing issues are inserted into immutable `jira_fact_snapshots`; an existing evaluation with snapshots reuses those frozen facts instead of mutable Jira current state, while lifecycle recalculation guards still block review/final/locked rewrite.
- [x] Jira provider unit coverage PASS: period/issue filtering, aggregation, missing required facts, median duration, frozen snapshot reuse.
- [x] T08-B automated closeout: lint PASS, typecheck PASS, 28 test files / 128 tests PASS, Next.js 16.3.2 production build PASS with `/evaluate-jira`.
- [x] Local API+DB T08-B proof PASS: `npm run db:evaluate:jira-demo` authenticated a short-lived verifier, evaluated 14/14 eligible members twice, persisted 14 member evaluations and 84 distinct contributing issue snapshots, then deliberately mutated a current Jira fact; snapshot digest and persisted evaluation scores remained unchanged on rerun. The current fact and verifier identity were restored/removed in cleanup.
- [ ] Browser click-through remains environment-blocked while ChatCode browser capability is unavailable.

## T09 — Audit and historical analytics
**Status:** PASS — code + live local PostgreSQL/API integrity proof

Verification:
- [x] `audit_events` is organization-scoped; API queries cannot read another tenant's audit rows.
- [x] Migration `0012_audit_history_authority.sql` installs PostgreSQL guards rejecting UPDATE and DELETE against audit rows.
- [x] Migration `0013_audit_actor_retention.sql` prevents audited actors from being hard-deleted; deactivation/revocation is the supported retention-safe path.
- [x] Audit events persist actor, actor identity snapshot, request ID, action, entity type/id, before/after state, and reason/metadata where applicable.
- [x] HTTP request IDs correlate exactly with the audit event request ID.
- [x] Sensitive review/finalize/lock, quality disposition, KPI lifecycle/configuration, Team/Member/Membership/KPI Template, Jira configuration, and Evaluation Period/assignment/lifecycle mutations append audit in the same business transaction.
- [x] Audit Log UI is API/PostgreSQL-backed rather than seed-backed.
- [x] Historical Analytics UI is API/PostgreSQL-backed rather than seed-backed.
- [x] Historical aggregation accepts only authoritative FINALIZED/LOCKED outcome values; non-final evaluations are visible in coverage but are not treated as zero/final performance.
- [x] Live proof `npm run db:proof:audit-history` PASS: login 200, request ID correlation true, logically idempotent Jira mapping mutation true, audit UPDATE blocked, audit DELETE blocked, audited actor hard-delete blocked, actor deactivation supported, actor reference and actor snapshot preserved.
- [x] Live historical result: organization score 8.72 from 14 valid finalized/locked evaluations out of 28 total persisted evaluations; coverage reports `14 / 28 valid evaluations`.
- [x] Final lint PASS.
- [x] Final typecheck PASS.
- [x] Final unit suite PASS: 29 test files / 134 tests.
- [x] Final Next.js 16.3.2 production build PASS with `/api/organizations/[organizationId]/audit` and `/analytics/history`.
- [ ] Browser click-through remains environment-blocked while ChatCode browser capability is unavailable; no false PASS recorded.

## T10 — Production hardening
**Status:** IN PROGRESS — T10-A/B/C/D/E/F/G repository/local gates PASS; external production/E2E/monitoring-backend gates remain open

Verification to date:
- [x] Next.js standalone production output enabled and production build PASS.
- [x] Multi-stage non-root Dockerfile and `.dockerignore` added; Docker build itself is environment-blocked because the local host has no Docker CLI.
- [x] CI workflow added for install, verify, PostgreSQL migration smoke/parity and production dependency audit; no remote CI execution is claimed yet.
- [x] Migration parity proof PASS: 14/14 migrations, latest `0014_user_onboarding`.
- [x] `npm audit --omit=dev` reports 0 vulnerabilities.
- [x] Standalone production server boot proof: `/api/health` 200 and `/api/ready` 200 with PostgreSQL connectivity.
- [x] Operations and release docs cover migration ordering, backup/restore, rollback, readiness and release checks.
- [x] Executive Dashboard is API-backed and role-scoped; live proof returned 6 teams, 14 members, 14 current evaluations, history score 8.72 and 14/28 coverage.
- [x] Active component tree has no `@/lib/kpi` import.
- [x] Metric Library, Scoring Rules, Data Quality and Rank Schemes are API-backed; live proof returned 4 metrics, 1 rank scheme/7 validated bands, 8 scoring rules and 3 persisted quality issues.
- [x] Evaluation-period creation can persist an explicit rank scheme instead of always writing null.
- [x] KPI metric/version/criterion/metric-binding/scoring-rule mutations append same-transaction audit with actor/requestId. Live proof correlated `KPI_CRITERION_UPDATED` to the HTTP request ID and retained actor reference/snapshot.
- [x] T10-E Administration Settings is API-backed for organization users and period-effective Department Head scope. Repeatable live create/close proof preserved historical effective dates and correlated both mutations to append-only audit request IDs.
- [x] T10-F Administrator onboarding provisions user + organization access + optional one-to-one member link atomically; `0014_user_onboarding.sql` enforces forced first-login password rotation metadata and unique non-null member↔user linkage.
- [x] Temporary-password sessions are blocked from organization APIs with `PASSWORD_CHANGE_REQUIRED` until `/api/auth/password` succeeds; password rotation revokes other sessions and emits non-secret audit events.
- [x] Repeatable live onboarding proof uses an isolated temporary Member fixture and verified provision/member-link/audit, no password/hash material in audit, temporary org-access denial, successful password rotation, old temporary-password rejection, and new-password acceptance.
- [x] Member linkage is concurrency-hardened with a member-scoped advisory transaction lock plus a conditional `user_id IS NULL` update; nested Drizzle PostgreSQL unique violations map to HTTP 409 and have regression coverage.
- [x] T10-G request telemetry is centralized through Proxy correlation metadata plus `src/server/http.ts`; success and error responses record normalized route/status/error counters, duration histograms and structured completion logs without request bodies or credentials.
- [x] `/api/metrics` exposes Prometheus-compatible process-local metrics; production access requires a dedicated timing-safe bearer token (`METRICS_TOKEN`) and route labels normalize UUID/numeric identifiers to prevent high-cardinality IDs.
- [x] `src/instrumentation.ts` captures uncaught Next.js request errors; readiness exports explicit state/outcome metrics; health/readiness responses include request correlation and `Server-Timing`.
- [x] Live observability proof on port 3712 PASS: health 200, readiness 200, unauthenticated `/api/auth/me` 401, metrics 200, request/duration/error/readiness signals present.
- [x] Structured logger boundary redacts sensitive-key fields, bearer values and credential-bearing URLs before emission, safely serializes Error/circular values, and preserves canonical timestamp/level/message/service fields against caller override.
- [x] Current full automated gate: lint PASS, typecheck PASS, 31 test files / 146 tests PASS, production build PASS.
- [ ] Browser click/reload E2E regression remains environment-blocked by unavailable ChatCode browser capability.
- [ ] Real Atlassian credentialed sync remains unverified.
- [ ] Production Docker build/deploy, CI execution, backup restore rehearsal, secrets distribution and observability backend integration remain external release gates.

## Review checklist
- Does the implementation enforce domain rules server-side where required?
- Are mutable and historical entities clearly separated?
- Can a user bypass RBAC or tenant/resource scope through client-side manipulation?
- Can finalized/locked data be overwritten?
- Can missing data accidentally become zero?
- Are manual adjustments bounded and reasoned?
- Are score calculations deterministic and test-covered?
- Do docs describe what the code actually does rather than intended future behavior?
