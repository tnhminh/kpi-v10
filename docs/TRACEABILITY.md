# Requirement Traceability

Last updated: 2026-08-25

This matrix links production requirements to implementation, task ownership, verification and release gates. A requirement is not considered production-verified when only code exists without runtime/environment evidence.

| Requirement | Task | Implementation | Verification / Evidence | Gate |
|---|---|---|---|---|
| REQ-AUTH-01 Secure credential verification | T04 | `src/server/auth/password.ts`, auth service | auth/password/session tests; local login proof | G2 |
| REQ-AUTH-02 Revocable opaque sessions | T04 | `src/server/auth/session.ts`, session DB model | session tests; live login/session | G2 |
| REQ-AUTH-03 Login abuse throttling | T04/T10-G | DB throttle state, auth metrics | RBAC/auth tests; `kpi_auth_login_throttled_total` | G2/G8 |
| REQ-AUTH-04 Tenant access must be server-resolved | T04/T05 | `user_organization_access`, `requireOrganizationPermission` | organization/access tests; protected API proofs | G2 |
| REQ-AUTH-05 Department Head limited to effective department scope | T07/T12 | `department_head_assignments`, review/analytics scope | T07 scope proof; T12 administration/history proof | G2/G5 |
| REQ-DATA-01 Explicit PostgreSQL source of truth | T02 | schema + migrations `0001`–`0014` | migration parity, readiness | G1 |
| REQ-DATA-02 Effective membership/team history | T02/T06 | membership/leadership tables + evaluation resolved IDs | T06 DB integrity proof | G1/G4 |
| REQ-DATA-03 Final historical state immutable | T07/T09 | DB triggers + `historical_snapshots` | locked mutation probes, snapshot checksum | G5 |
| REQ-KPI-01 Deterministic scoring | T03 | `src/domain/kpi/*` | domain unit tests | G3 |
| REQ-KPI-02 Missing data != zero | T03/T06/T08 | NOT_EVALUATED semantics/providers | scoring/evaluation/Jira provider tests; live critical-data proof | G3/G4/G6 |
| REQ-KPI-03 Config versioning/freeze | T05 | KPI version lifecycle + DB triggers | KPI config tests + trigger proofs | G3 |
| REQ-KPI-04 Server-owned authoritative score | T06 | canonical pipeline + trusted provider boundary | T06 batch proof | G4 |
| REQ-REVIEW-01 Layered Leader/Head review | T07 | review repository/UI | T07 live review proof | G5 |
| REQ-REVIEW-02 Auditable human adjustment | T07/T09 | `adjustments`, audit writes | review tests + audit proof | G5 |
| REQ-REVIEW-03 Quality disposition explicit | T07 | quality resolve/waive metadata + DB guards | T07 finalization proof | G5 |
| REQ-REVIEW-04 Finalize/lock separated | T07 | finalize + snapshot + lock APIs | end-to-end lock proof | G5 |
| REQ-JIRA-01 Jira credentials never persisted directly | T08/T14 | `secretRef`, env resolver | code/tests; real proof must remain secret-redacted | G6/G12 |
| REQ-JIRA-02 Mutable sync facts separated from evaluation history | T08 | current facts vs `jira_fact_snapshots` | `db:evaluate:jira-demo` mutation/rerun proof | G6 |
| REQ-JIRA-03 Real Atlassian credentialed sync | T14 | real Jira proof harness | external credentialed run | G6 |
| REQ-AUDIT-01 Tenant-scoped append-only audit | T09 | audit repository + DB guards | `db:proof:audit-history` | G5/G12 |
| REQ-AUDIT-02 Audit request correlation | T09/T10-D/E/F | request IDs in same transaction | audit/config/admin/onboarding proofs | G8 |
| REQ-HISTORY-01 Only FINALIZED/LOCKED values enter score | T09 | analytics history domain/repository | history unit + DB proof | G5 |
| REQ-HISTORY-02 Department Head historical view is assignment-scoped | T12 | analytics EXISTS effective assignment predicate | `db:proof:administration` | G2/G5 |
| REQ-UI-01 Active shell must not use seed authority | T05/T10-B/C | API-backed workspaces | active import audit; browser E2E | G7 |
| REQ-UI-02 High-value mutation persists across reload | T10-H | real Chrome Playwright proof | `npm run proof:browser-e2e` | G7 |
| REQ-UI-03 Production copy is encoding-clean and free of internal task/migration labels | T10-J | production components + UI-copy regression guard | `ui-copy.test.ts`; 15-surface Chrome rendered-copy scan | G7 |
| REQ-UI-04 Critical surfaces are responsive, operable and accessibility-labeled | T10-K | responsive shell/workspaces + browser audit harness | `npm run proof:ui-ux-audit`; 16 desktop + 16 mobile surfaces, 0 findings | G7 |
| REQ-OBS-01 Correlated structured request telemetry | T10-G | Proxy + HTTP helpers + instrumentation | logger/metrics tests; observability proof | G8 |
| REQ-OBS-02 Bounded-cardinality Prometheus metrics | T10-G | route normalization + `/api/metrics` | metrics tests; observability proof | G8 |
| REQ-OBS-03 Production metric scrape protected | T10-G/T17 | `METRICS_TOKEN` auth | local behavior + target collector evidence | G8/G12 |
| REQ-OBS-04 Central logs/alerts operational | T17 | target infrastructure | production ingestion + alert-delivery evidence | G8/G15 |
| REQ-OPS-01 Standalone production runtime | T10-A | Next standalone output | standalone health/readiness proof | G11 |
| REQ-OPS-02 Non-root container image | T10-A/T16 | `Dockerfile` | real container build/runtime evidence | G11 |
| REQ-OPS-03 Backup/restore is proven | T10-I | restore proof + runbook | `npm run proof:restore` | G9 |
| REQ-OPS-04 Production pre-migration backup | T17 | operations runbook | target backup evidence | G9/G13 |
| REQ-CI-01 Clean install/static/test/build gates | T13/T15 | npm scripts + GitHub workflow | local aggregate + remote Actions | G10 |
| REQ-CI-02 Dependency high-severity audit | T10-A/T13/T15 | npm audit step | local/remote audit | G10 |
| REQ-SEC-01 CSRF/origin protection | T04 | mutation guard | CSRF tests | G2/G12 |
| REQ-SEC-02 Sensitive logs are redacted | T10-G | structured logger sanitizer | logger tests; log review | G12 |
| REQ-SEC-03 Production secrets externalized | T10-A/T17 | env contract/container runtime | target secret-manager evidence | G12 |
| REQ-DR-01 Restore boots the application | T10-I | isolated restore + standalone boot | `proof:restore` readiness 200 | G9 |
| REQ-DEPLOY-01 Reviewed immutable release artifact | T13/T16/T17 | Git commit + image digest | release identifier + container evidence | G10/G11/G13 |
| REQ-DEPLOY-02 HTTPS/domain/ingress operational | T17 | target platform | target smoke | G13/G14 |
| REQ-DEPLOY-03 Rollback path verified | T17 | previous image + runbook | operator evidence | G13 |
| REQ-GO-01 No unresolved P0/P1 defects | T18 | final adversarial review | final release audit | G15 |
| REQ-GO-02 Environment-specific checklist complete | T18 | `RELEASE_CHECKLIST.md` | release owner evidence | G15 |

## Coverage rules
1. `Code exists` is implementation evidence, not runtime evidence.
2. Localhost/browser/temporary-DB proof may close repository/local gates, but not target production infrastructure gates.
3. External secrets, production hostnames, tokens, image digests and sensitive evidence should be linked from the release system rather than committed to this repository.
4. Any new P0 requirement must be added here and mapped to `docs/TASKS.md` plus `docs/RELEASE_GATES.md` before Production GO.
