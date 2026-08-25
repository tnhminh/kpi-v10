# Architecture Decision Log

## ADR-001 — Preserve the prototype UI during productionization
**Status:** Accepted

The existing UI is retained as the product shell while authority is moved from local seeded state to server-side services and persistent storage. This avoids a costly visual rewrite and lets backend work be validated through the existing workflows.

## ADR-002 — Production truth must live server-side
**Status:** Accepted

Client-side role state, seeded score data, and local component mutations are demonstration behavior only. Production mutations, authorization, scoring, finalization, locking, and audit events must be enforced on the server and persistence layer.

## ADR-003 — History is modeled explicitly, not reconstructed from mutable current state
**Status:** Accepted

Team memberships, team leadership, KPI versions, Jira facts, reviews, and final results require effective-period/version references or immutable snapshots. A historical KPI must remain reproducible when current organization or Jira data changes.

## ADR-004 — Task completion requires code and documentation verification
**Status:** Accepted

A task is complete only after implementation, automated checks, code review, documentation update, documentation consistency review, and final verification pass.

## ADR-005 — PostgreSQL runtime uses Drizzle ORM; migrations stay explicit SQL
**Status:** Accepted

Runtime persistence uses `drizzle-orm` + `postgres`. Migration files are explicit SQL and are applied transactionally by a small repository-owned migration runner. `drizzle-kit` was evaluated but removed after its dev-tool dependency chain introduced moderate npm advisories in this environment. This keeps the runtime dependency set auditable and migration changes human-reviewable.

Migration tracking is committed in the same transaction as each migration body so a schema change cannot be committed without its migration ID being recorded.

## ADR-006 — Never infer or store database credentials
**Status:** Accepted

Database credentials come only from the authorized deployment environment/secret manager. Local PostgreSQL availability does not authorize guessing roles or passwords. Build/test workflows must remain useful without secrets; live migration/integration checks are separately recorded when credentials are available.

## ADR-007 — Use opaque server-side sessions; never persist bearer tokens
**Status:** Accepted

Authentication uses random opaque session tokens held only by the browser cookie. The database stores only an HMAC-SHA256 digest keyed by `AUTH_SECRET`. Session lookup always checks expiry, revocation, and active-user state. Cookie lifetime is eight hours, HttpOnly, SameSite=Strict, and Secure in production.

This design permits explicit revocation and role/account changes to take effect on subsequent requests without trusting signed client claims.

## ADR-008 — Passwords use fixed-cost scrypt and login paths avoid obvious account enumeration
**Status:** Accepted

Password hashes use Node scrypt with `N=131072`, `r=8`, `p=1`, random 16-byte salts, and 64-byte derived keys. Verification accepts only this configured cost tuple so a malicious stored/malformed hash cannot trigger attacker-selected KDF resource usage. Unknown accounts verify against a valid dummy hash before returning the same invalid-credential response.

## ADR-009 — Authentication throttling is shared state and avoids raw identity storage
**Status:** Accepted

Failed-login throttling lives in PostgreSQL so it works across application replicas. The throttle key is an HMAC of the normalized email rather than the raw address. Five failed attempts in the active 15-minute window block further attempts for 15 minutes. This is a baseline brute-force control; IP/device risk signals can be added later without changing auth identity semantics.

## ADR-010 — RBAC must be combined with tenant and resource scope
**Status:** Accepted

A coarse permission such as `evaluation:team:review` never authorizes an arbitrary object by itself. APIs must first resolve the authenticated user's organization access and resource relationship (for example effective team leadership), then apply resource-scope policy. Team Leaders may review only teams they actually lead; Members may read only their own evaluation unless a higher role/scope grants access.

T05 therefore begins by adding explicit user-to-organization access before exposing persisted organization/KPI APIs.

## ADR-011 — KPI approval substate uses immutable timestamps while published use uses lifecycle status
**Status:** Accepted

The existing KPI lifecycle enum remains `DRAFT`, `PUBLISHED`, `IN_USE`, `RETIRED`. Submission and approval are represented by immutable `submittedAt` and `approvedAt/approvedBy` fields while the version remains `DRAFT`; publishing is the transition to `PUBLISHED`. This avoids an enum-breaking migration while still making submit/approve order explicit and auditable. A submitted draft is frozen; changes require cloning a new draft version.

## ADR-012 — KPI configuration immutability is defense in depth and serialized with lifecycle
**Status:** Accepted

Application services use KPI-version PostgreSQL advisory transaction locks for both configuration mutations and lifecycle transitions. When a mutation begins from a criterion ID, it resolves the version, acquires the version lock, then re-reads authoritative status before writing. This prevents a stale edit from racing a concurrent submit.

PostgreSQL triggers independently reject criteria, metric-configuration, or scoring-rule mutations after submission and enforce monotonic lifecycle timestamps/status. The database boundary is therefore a final guard even if a future code path bypasses repository checks. Draft parent deletion/cascades remain allowed; submitted configuration does not.

## ADR-013 — KPI configuration authority and approval authority are separate permissions
**Status:** Accepted

`kpi:manage` controls configuration changes, cloning, submission, publication, and retirement. `kpi:approve` controls approval. Department Head receives approval authority without configuration-edit authority, while Administrator has both. Client role selectors never grant either permission; organization-scoped server access remains authoritative.

## ADR-014 — Evaluation execution has one canonical server path and freezes historical inputs
**Status:** Accepted

System scoring is produced only by `src/server/evaluation/pipeline.ts` through a `MetricInputProvider`; transport callers never submit authoritative KPI/criterion scores. `CollectedMetricInputProvider` is the current trusted ingestion adapter and is separated from ordinary evaluation operation through `evaluation:ingest` versus `evaluation:run`.

Historical reproducibility is protected before review starts: the evaluated row stores the exact effective membership/team/KPI version, period KPI assignments become immutable once collection starts, and metric-definition semantics become immutable once referenced by a submitted KPI version. Missing or critical data remains NOT_EVALUATED/REVIEW_REQUIRED rather than zero.

## ADR-015 — Human review is layered; lock requires a checksum snapshot and database immutability
**Status:** Accepted

T07 review values are layered rather than destructive: system → leader → Department Head → final. A reviewer changes criterion-layer values and appends an `adjustments` record with before/after/reason/actor; system evidence and score are never overwritten. Material changes use the domain adjustment threshold and require a reason.

Finalization derives criterion final values and aggregate final KPI/rank only after required reviews and critical-quality policy pass. Locking is a separate transition: it serializes the evaluation, creates a complete canonical historical snapshot, stores a SHA-256 checksum, then transitions the evaluation to LOCKED. PostgreSQL guards reject mutation of finalized/locked evaluation outcomes and historical snapshots even if future application code bypasses service checks.

## ADR-016 — Department review scope and critical-quality disposition are explicit historical facts
**Status:** Accepted

A `DEPARTMENT_HEAD` role is not organization-wide review or historical-analytics authority. Department review and Department Head historical analytics resolve period-effective `department_head_assignments`; an unassigned Department Head receives no department queue and no department historical rows. Administrator remains the explicit broader administrative bypass. This mirrors period-effective Team Leader scope and prevents a coarse organization role from silently widening authority.

A CRITICAL data-quality issue may block finalization, but the workflow must not become permanently unfinishable. Department Head/Admin may explicitly mark an issue `RESOLVED` or `WAIVED` only with a non-empty reason, actor and timestamp. Once resolved/waived, that disposition is immutable and is included in the locked historical snapshot, so the exception itself remains reproducible and auditable.

## ADR-017 — Jira evaluation is server-owned and freezes contributing facts on first use
**Status:** Accepted

Jira current facts are mutable integration state and therefore cannot be read directly by review/finalization history. T08-B introduces a server-owned `JiraMetricInputProvider`: the browser may request a Jira-backed evaluation but cannot submit Jira facts, metric values, or system scores. The server resolves eligible members, period configuration, Jira attribution and metric aggregation, then runs the same canonical evaluation pipeline used by other trusted providers.

When Jira facts first contribute to a member evaluation, the transaction persists the exact contributing issue facts in `jira_fact_snapshots`. Subsequent system-stage reruns prefer those snapshots rather than mutable current Jira rows; after human review begins, the existing lifecycle recalculation policy blocks silent rewrites entirely. This deliberately favors historical reproducibility over implicit refresh. Any future product requirement to refresh an already snapshotted Jira evaluation must introduce an explicit versioned refresh model rather than mutating existing snapshots.

## ADR-018 — Audit is tenant-scoped append-only history; audited actors are retained
**Status:** Accepted

Audit events are historical records, not mutable operational rows. Every event is organization-scoped and stores the correlated request ID, action/entity identity, actor reference, actor identity snapshot, before/after state and reason/metadata where applicable. Sensitive business mutations append their audit event inside the same PostgreSQL transaction as the business write so an unaudited successful mutation cannot be committed.

PostgreSQL rejects UPDATE and DELETE on `audit_events`. Because an `ON DELETE SET NULL` actor foreign key would itself require mutating an existing audit row, audited actors use retention semantics instead: once referenced by audit, a user cannot be hard-deleted and must be deactivated/revoked operationally. This preserves both the actor foreign-key reference and the event-time actor snapshot. Historical analytics likewise reads only authoritative FINALIZED/LOCKED outcomes; non-final rows may affect coverage but never become implicit zero/final values.

## ADR-019 — Administrator onboarding uses forced first-login password rotation
**Status:** Accepted

Administrator provisioning creates the user, organization access, optional one-to-one member link, and non-secret audit record atomically. Optional member linking acquires a member-scoped PostgreSQL advisory transaction lock and conditionally updates only an unlinked member row, preserving the one-to-one invariant under concurrent provisioning. The administrator supplies a temporary password that is immediately scrypt-hashed; plaintext or hash material is never returned from the API or written to audit metadata.

A provisioned account starts with `password_change_required=true`. The resulting authenticated session is intentionally restricted from organization APIs until the user rotates the password through `/api/auth/password`; `/api/auth/me`, logout, and password rotation remain available so the user can complete onboarding. Rotation stores a new scrypt hash, clears the required-change flag, records `password_changed_at`, revokes other sessions, and appends non-secret `PASSWORD_CHANGED` audit events for active organization access in the same transaction. This makes temporary credentials operationally single-use without turning the client into an authorization boundary.

## ADR-020 — Observability is vendor-neutral, bounded-cardinality, and scrape-protected
**Status:** Accepted

The application owns a small vendor-neutral observability boundary instead of coupling domain code to one monitoring vendor. Next.js Proxy injects request correlation and an internal start timestamp for `/api/*` only; it is metadata plumbing and never grants authentication or authorization. Central API response helpers record structured completion events, request/error counters and latency histograms, while Next.js instrumentation captures uncaught request errors outside the normal API helper path. The structured logger recursively redacts sensitive keys and credential-bearing strings, handles non-JSON-safe Error/circular values, and writes canonical timestamp/level/message/service fields after sanitized caller data so the event envelope cannot be spoofed.

Prometheus-compatible metrics are exposed per application process through `/api/metrics`. Dynamic UUID and numeric path segments are normalized before becoming labels so tenant/member/evaluation IDs cannot create unbounded metric cardinality. Production scrape access requires an independent `METRICS_TOKEN`; it is not reused from `AUTH_SECRET` and is never logged. The metrics endpoint intentionally does not count its own scrape traffic. Aggregation across replicas, durable retention, dashboards and alert delivery remain infrastructure responsibilities of the target environment rather than in-process application state.

## ADR-021 — Browser release evidence uses installed system Chrome when connector browser capability is unavailable
**Status:** Accepted

Repository/local browser acceptance is produced by Playwright Core against the installed system Chrome rather than depending on the ChatCode browser engine. The proof logs in through the real UI, performs a persisted Team mutation, verifies PostgreSQL persistence, reloads the browser, checks the mutation remains visible, navigates critical workspaces, and fails on page errors or visible authoritative-data load failures. This is repository/local release evidence only; target-production browser smoke is still required after deployment.

## ADR-022 — Restore rehearsal uses an isolated temporary PostgreSQL cluster with ephemeral ports
**Status:** Accepted

The application development DB role intentionally does not require database-creation privileges. The restore proof therefore dumps the authorized local source DB, initializes a separate temporary PostgreSQL cluster, allocates ephemeral loopback ports for PostgreSQL and the restored standalone app, restores the dump there, verifies migration parity/data/integrity triggers, and boots the standalone runtime against the restored database. Temporary cluster/dump artifacts are removed after the proof. Ephemeral ports avoid false failures from fixed-port collisions and keep the rehearsal isolated from the active development database.

## ADR-023 — Production closure tasks use an explicit implement-test-review repair loop
**Status:** Accepted

Every remaining production task follows IMPLEMENT → TEST → REVIEW. Any failure returns to FIX → TEST AGAIN → REVIEW AGAIN until green. A task is marked DONE only after objective verification and documentation/handoff reconciliation; unavailable external credentials or infrastructure are recorded as BLOCKED_EXTERNAL rather than treated as implementation success or failure.
