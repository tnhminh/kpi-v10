# Production Release Checklist

A release is not production-ready until every required item is checked with environment-specific evidence.

## Repository/local preflight evidence
These checks do not substitute for the production-specific boxes below.
- [x] Clean `npm ci` from lockfile PASS on 2026-08-25.
- [x] `npm run proof:release-local` PASS on 2026-08-25: verify, production dependency audit, 14/14 migration parity, critical DB/API proofs, observability, real system-Chrome E2E, and isolated backup/restore.
- [x] Real Jira verifier harness fails closed without credentials and does not print credential values; credentialed Jira execution remains external.
- [x] Remote GitHub Actions PASS for reviewed commit `c9274f8` after CI-only metrics-auth environment isolation was fixed and rerun.

## Build and supply chain
- [ ] Reviewed commit/release identifier recorded.
- [ ] `npm ci` completed from lockfile.
- [ ] `npm run lint` PASS.
- [ ] `npm run typecheck` PASS.
- [ ] `npm run test` PASS.
- [ ] `npm run build` PASS.
- [ ] `npm audit --omit=dev --audit-level=high` PASS or approved exception documented.
- [ ] Container image built from the reviewed commit and immutable digest recorded.

## Database
- [ ] Backup created before release migration and stored outside the application host.
- [ ] Backup/restore drill is within accepted RPO/RTO window.
- [ ] `node scripts/db-migrate.mjs` completed successfully against the target database.
- [ ] `node scripts/verify-migrations.mjs` reports no missing/unknown migrations.
- [ ] `/api/ready` confirms database connectivity after rollout.

## Security and secrets
- [ ] `NODE_ENV=production`.
- [ ] `APP_URL` exactly matches the externally served origin used by mutation-origin checks.
- [ ] `AUTH_SECRET` is production-unique, secret-managed, and at least 32 characters.
- [ ] Database, Jira, and `METRICS_TOKEN` credentials are secret-managed and not present in image/source/logs.
- [ ] TLS is terminated by an approved ingress/proxy and HTTP is redirected/blocked as required.
- [ ] Production administrator/onboarding process is approved; no local demo credential is used.

## Functional smoke
- [ ] `/api/health` HTTP 200.
- [ ] `/api/ready` HTTP 200.
- [ ] Authorized login/session flow works.
- [ ] Organization-scoped read works without cross-tenant leakage.
- [ ] Representative KPI/evaluation/review workflow reads load correctly.
- [ ] Audit Log and Historical Analytics load authoritative persisted data.
- [ ] Real Jira connector sync is verified if Jira-backed production evaluation is enabled.

## Operations
- [ ] Central log ingestion is receiving structured JSON logs including `api_request_completed` and uncaught framework error events.
- [ ] Production scraper can authenticate to `/api/metrics` with `METRICS_TOKEN` and is collecting request/error/latency/readiness/auth-throttle metrics from every replica.
- [ ] Alerts exist for readiness failures, elevated 5xx/error rate, database unavailability, high request latency, uncaught framework errors, and repeated login throttling.
- [ ] On-call owner and rollback decision-maker are identified.
- [ ] Previous application image remains available for rollback.
- [ ] Migration/restore runbook is accessible to operators.
- [ ] Browser interaction/reload regression suite or documented manual acceptance has passed in the target environment.

## Approval
- [ ] Remaining known blockers in `docs/STATUS.md` are closed or explicitly accepted by release owner.
- [ ] Release owner records final GO decision and evidence links outside the repository if they contain sensitive infrastructure data.
