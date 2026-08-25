# Target Production Architecture

## Current state
The repository is transitioning from a frontend-heavy prototype to a server-authoritative application. The shell is session-gated by `src/components/app-gateway.tsx`; authenticated organization context drives `src/components/studio.tsx`. Teams, Members, KPI Templates, KPI Builder, Metric Library, Scoring Rules, Rank Schemes, Evaluation Periods, System Evaluation, Leader Review, Department Head Calibration, Data Quality, Executive Dashboard, Jira Control Center, Audit Log, and Historical Analytics use protected organization-scoped APIs. Active production components no longer import `src/lib/kpi.ts`; Jira demo evidence is persisted separately in PostgreSQL through `scripts/seed-local-jira-demo.mjs`.

## Target boundaries

```text
Browser / Next.js UI
        |
        v
Authentication + request protection
  - HttpOnly opaque session
  - Origin / Fetch Metadata guard
        |
        v
Validated Route Handlers / Server Actions
        |
        +--> Tenant scope (organization access)
        +--> RBAC permission
        +--> Resource scope (self / led team / department)
        |
        v
Application Services
  - Organization
  - KPI Configuration & Versioning
  - Metric Engine
  - Scoring Engine
  - Evaluation
  - Review / Calibration
  - Snapshot / Lock
  - Jira Sync
  - Audit
        |
        v
Repository Layer
        |
        v
PostgreSQL
```

## Authentication and authorization boundary
Authentication is server-side and database-backed. Passwords use fixed-cost scrypt. Login creates a random opaque session token; only an `AUTH_SECRET`-keyed HMAC of that token is stored in `sessions`. `/api/auth/me` resolves current identity from the session record and active user row, rather than from client role state.

Authorization is deliberately layered:
1. authenticated identity;
2. organization/tenant access;
3. coarse role permission;
4. resource relationship, such as effective team leadership or member-self identity;
5. domain/lifecycle invariant for the requested mutation.

The former UI role selector has been removed as authority. T05 introduced explicit organization access rows, protected tenant-scoped APIs, authenticated organization selection, and an API-backed KPI Builder. Subsequent workflow APIs must continue this same layered authorization pattern; UI visibility checks are convenience only and never replace server authorization.

## Cross-cutting concerns
- Authentication + secure sessions
- Server-side RBAC + tenant/resource scope
- Browser mutation/CSRF protections
- Input validation
- Structured logs and request correlation IDs
- Audit events for sensitive mutations
- Transaction boundaries for multi-record lifecycle changes
- Idempotency for sync/evaluation operations where appropriate
- Health/readiness endpoints
- Observability and operational runbooks

## Persistence layer
PostgreSQL is the production system of record. Runtime access uses `drizzle-orm` with `postgres`; migrations are explicit SQL files applied by an atomic migration runner. The DB client is lazy so builds/tests do not require production credentials. Readiness includes a DB ping only after environment validation succeeds.

The schema includes effective TeamMembership and TeamLeadershipAssignment histories, KPI template/version/criteria/metric/rule configuration, period assignments, member/criterion evaluations, adjustments, Jira current facts and evaluation snapshots, historical lock snapshots, rank schemes, users/sessions, shared login-attempt state, data-quality issues, audit events, and notifications. T05 added explicit authenticated-user organization scope and made Organization/KPI configuration APIs authoritative for their migrated UI workflows.

## Historical data strategy
Mutable current-state entities and historical facts are separate. T06 persists the exact effective TeamMembership and KpiVersion used by every evaluation; PostgreSQL freezes period assignments once collection starts and freezes metric-definition semantics once referenced by a submitted KPI version. T07 layers human scores without erasing system provenance, persists reasoned adjustments, and requires auditable disposition of CRITICAL quality issues. Finalization derives final criterion/KPI/rank values; locking serializes the complete resolved evaluation into a canonical historical payload, stores a SHA-256 checksum, then transitions to LOCKED. PostgreSQL independently freezes finalized/locked outcomes, adjustments, resolved quality records, evidence and historical snapshots.

## UI migration strategy
Keep the existing product shell, then replace one local-state workflow at a time with typed server APIs. T05 migrated authentication/organization context, Teams, Members, KPI Templates, and KPI Builder; T06 migrated Evaluation Periods and System Evaluation; T07 migrated Leader Review and Department Head Calibration; T08 migrated the Jira Control Center plus Jira-backed evaluation/snapshot authority; T09 migrated Audit Log and Historical Analytics; T10 migrated Executive Dashboard, Metric Library, Scoring Rules, Data Quality and Rank Schemes and removed seed imports from the active shell. Remaining T10 risk is operational/E2E rather than client seed authority.

A workflow is code-migrated only when reads/mutations use protected APIs and server-side tenant/RBAC/domain rules are authoritative. A credentialed local PostgreSQL environment now exists and T06 has live API/DB integration evidence. Browser interaction/reload regression remains a separate environment gate while the ChatCode browser engine is unavailable.
