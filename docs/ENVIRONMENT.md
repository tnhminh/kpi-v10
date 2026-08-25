# Environment Contract

Secrets must be supplied by the deployment environment or secret manager. Do not commit real credentials or `.env*` files.

## Required server variables

| Variable | Requirement | Example shape |
| --- | --- | --- |
| `APP_URL` | Absolute application URL | `https://kpi.example.internal` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:password@db:5432/kpi` |
| `AUTH_SECRET` | Random secret, minimum 32 characters | generated per environment |
| `NODE_ENV` | `development`, `test`, or `production` | `production` |
| `LOG_LEVEL` | `debug`, `info`, `warn`, or `error` | `info` |
| `METRICS_TOKEN` | Bearer token for `/api/metrics`; minimum 32 characters and required when `NODE_ENV=production` | generated per environment |

## Local development bootstrap
For local development, `.env.local` is git-ignored and may contain development-only credentials. The repository provides `scripts/bootstrap-local-admin.mjs`; it never embeds a default password in source and refuses to run when `NODE_ENV=production`.

After a local PostgreSQL database has been created and migrations have been applied, provision/reset the local administrator with a password supplied only through the process environment:

```powershell
$env:DEV_ADMIN_PASSWORD = '<local password, minimum 12 characters>'
npm run db:bootstrap-local-admin
```

The default local administrator email is `admin@kpi.local`; override it with `DEV_ADMIN_EMAIL` when needed. Restart the Next.js dev server after changing `.env.local` so server-only environment values are reloaded.

## Operational rule
`/api/ready` returns 503 while required configuration is invalid. `/api/health` only proves the application process is alive. `/api/metrics` exposes Prometheus-compatible per-process telemetry. Local development may scrape it without a token; production requires `Authorization: Bearer <METRICS_TOKEN>`.

## Secret handling
- Never expose `DATABASE_URL` or `AUTH_SECRET` to client components.
- Never log secret values.
- Rotate production secrets through the deployment platform, not source control.
- Each environment must use independent credentials.
