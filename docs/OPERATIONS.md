# Production Operations Runbook

## Runtime model
The production application is built as a Next.js standalone Node.js image. The image runs as a non-root `nextjs` user and exposes port 3000. `/api/health` is the liveness endpoint; `/api/ready` validates runtime configuration and database connectivity and is the readiness endpoint.

Do not run database migrations automatically in application startup. Run migrations as a separate release step before shifting traffic to the new application revision.

## Required environment
Supply `APP_URL`, `DATABASE_URL`, `AUTH_SECRET`, `METRICS_TOKEN`, `NODE_ENV=production`, and `LOG_LEVEL` through the deployment platform or secret manager. Never bake `.env` files or credentials into the image. `METRICS_TOKEN` must be independent from `AUTH_SECRET` and at least 32 characters.

## Repository/local release preflight
Before creating a release checkpoint, run:

```bash
npm ci
npm run proof:release-local
npm run proof:jira-real
```

`proof:release-local` is a cross-platform Node orchestrator. It sequentially runs static/unit/build verification, production dependency audit, migration parity, critical DB/API proofs, observability, real system-Chrome E2E, and isolated backup/restore. It intentionally excludes real Jira, remote CI, container-runtime and target-production gates.

`proof:jira-real` is a separate credentialed integration gate. If the required approved Jira workspace, bounded JQL and secret are unavailable, the verifier returns `BLOCKED_EXTERNAL`; that result is expected blocker evidence and is not a production PASS.

Do not invoke the aggregate local-release orchestrator with an outer `--env-file=.env.local`: `.env.local` is development-scoped and may contain `NODE_ENV=development`, while the nested production build must be allowed to establish its production environment. DB/runtime proof scripts load `.env.local` individually where required.

## Release sequence
1. Build one immutable image from the reviewed commit and record its digest/tag.
2. Run CI gates: `npm ci`, lint, typecheck, unit tests, production build, clean-database migration smoke, migration-state verification, and production dependency audit.
3. Create and validate a database backup before migrations that could affect production data.
4. Run the release image as a one-off migration job with production secrets and execute `node scripts/db-migrate.mjs`.
5. Run `node scripts/verify-migrations.mjs` against the same database. It must report `status: ok` and the expected latest migration.
6. Deploy the application image without changing its contents.
7. Require `/api/health` HTTP 200 for liveness and `/api/ready` HTTP 200 before adding instances to traffic.
8. Smoke-test login and one read-only organization workflow with an authorized production test account.
9. Watch structured application logs and database health before completing rollout.

## Production user onboarding
1. Sign in with an approved Administrator account and open Administration Settings for the intended organization.
2. Provision the user with the minimum required organization role. Link a Member only when the account represents that Member; the normalized user and Member emails must match, and each Member may be linked to at most one user.
3. Deliver the temporary password through an organization-approved secure channel. Never place it in tickets, documentation, application logs, chat transcripts, or audit metadata.
4. Require the user to sign in and rotate the temporary password immediately. Until `/api/auth/password` succeeds, the temporary session is restricted to `/api/auth/me`, password rotation, and logout; organization APIs must return `PASSWORD_CHANGE_REQUIRED`.
5. Confirm request-correlated `ORGANIZATION_USER_PROVISIONED` and `PASSWORD_CHANGED` events in Audit Log and verify that neither event contains password or hash material.
6. If access must be removed, deactivate the user and revoke active sessions. Do not hard-delete an audit-referenced user; actor-retention constraints intentionally preserve historical audit references and snapshots.

Concurrent provisioning of the same Member is serialized in PostgreSQL and must surface a conflict rather than silently replacing an existing link. Treat HTTP 409 as an operator correction case; do not retry it blindly.

## Container commands
Build locally or in CI:

```bash
docker build -t kpi-performance-studio:<version> .
```

Run the application with secrets injected by the runtime rather than copied into the image:

```bash
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e APP_URL=https://kpi.example.internal \
  -e DATABASE_URL=<secret> \
  -e AUTH_SECRET=<secret> \
  -e METRICS_TOKEN=<secret> \
  -e LOG_LEVEL=info \
  kpi-performance-studio:<version>
```

Run migrations using the exact same release image:

```bash
docker run --rm \
  -e DATABASE_URL=<secret> \
  --entrypoint node \
  kpi-performance-studio:<version> scripts/db-migrate.mjs
```

Then verify migration parity:

```bash
docker run --rm \
  -e DATABASE_URL=<secret> \
  --entrypoint node \
  kpi-performance-studio:<version> scripts/verify-migrations.mjs
```

## PostgreSQL backup
Use a database role authorized for backup and a secret supplied outside shell history where possible. Prefer PostgreSQL custom format so restore can be selective and parallelized.

```bash
pg_dump --format=custom --no-owner --no-acl --file=kpi-<timestamp>.dump "$DATABASE_URL"
```

Required controls:
- encrypt backups at rest and in transit;
- store them outside the application host;
- restrict access independently from application credentials;
- retain according to organization policy;
- record PostgreSQL major version and backup timestamp;
- periodically prove restore, not only backup creation.

## Restore drill
Restore into a new empty database first. Never overwrite the active production database as a routine test.

```bash
createdb <restore_target>
pg_restore --clean --if-exists --no-owner --no-acl --dbname=<restore_target> kpi-<timestamp>.dump
```

After restore:
1. run `node scripts/verify-migrations.mjs` against the restored database;
2. start the application against the restored database in an isolated environment;
3. verify `/api/ready` returns 200;
4. validate representative organization, KPI, evaluation, audit, and history reads;
5. record the restore duration and any manual steps.

## Rollback policy
Application rollback is preferred when the new schema remains backward compatible. SQL migrations are forward-only; do not improvise destructive down migrations during an incident. If a schema/data change makes the prior application incompatible, choose between a forward fix and a restore based on incident severity, RPO/RTO, and data written after migration. A restore can discard newer production writes and therefore requires explicit incident authorization.

## Observability minimum
- ingest JSON stdout/stderr logs centrally; API responses emit correlated `api_request_completed` events with normalized route, status and application duration, while `instrumentation.ts` captures uncaught Next.js request errors;
- index `timestamp`, `level`, `service`, `requestId`, normalized `route`, error `code`, HTTP status, and `durationMs` where present;
- scrape `GET /api/metrics` from every application instance with `Authorization: Bearer <METRICS_TOKEN>` in production. Metrics are Prometheus text format and are process-local, so the collector is responsible for aggregation across replicas;
- collect `kpi_http_requests_total`, `kpi_http_request_duration_seconds`, `kpi_http_errors_total`, `kpi_framework_request_errors_total`, `kpi_readiness_status`, `kpi_readiness_checks_total`, and `kpi_auth_login_throttled_total`;
- alert on `/api/ready` failures or `kpi_readiness_status == 0`, elevated 5xx/error rate, database-unavailable readiness outcomes, high p95 request latency, uncaught framework errors, and repeated authentication throttling;
- keep liveness and readiness probes distinct. The metrics scrape itself is intentionally excluded from application request counters to avoid scrape self-noise;
- never log or expose password, session token, `AUTH_SECRET`, `METRICS_TOKEN`, `DATABASE_URL`, Jira credentials, or raw secret references.
