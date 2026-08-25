import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { auditEvents, users } from "@/server/db/schema";

export type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export interface AuditEventInput {
  organizationId: string;
  actorUserId?: string | null;
  requestId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export async function appendAuditEvent(tx: DbTransaction, input: AuditEventInput) {
  const actorRows = input.actorUserId
    ? await tx.select({ displayName: users.displayName, email: users.email }).from(users).where(eq(users.id, input.actorUserId)).limit(1)
    : [];
  const actor = actorRows[0] ?? null;
  const rows = await tx.insert(auditEvents).values({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    requestId: input.requestId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason?.trim() || null,
    metadata: {
      ...(input.metadata ?? {}),
      actor: actor ? { displayName: actor.displayName, email: actor.email } : null,
    },
  }).returning({ id: auditEvents.id, occurredAt: auditEvents.occurredAt });
  return rows[0]!;
}

export async function listAuditEvents(input: { organizationId: string; limit?: number }) {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 250));
  return getDb().select({
    id: auditEvents.id,
    occurredAt: auditEvents.occurredAt,
    actorUserId: auditEvents.actorUserId,
    actorDisplayName: users.displayName,
    actorEmail: users.email,
    requestId: auditEvents.requestId,
    action: auditEvents.action,
    entityType: auditEvents.entityType,
    entityId: auditEvents.entityId,
    before: auditEvents.before,
    after: auditEvents.after,
    reason: auditEvents.reason,
    metadata: auditEvents.metadata,
  }).from(auditEvents)
    .leftJoin(users, eq(auditEvents.actorUserId, users.id))
    .where(and(eq(auditEvents.organizationId, input.organizationId)))
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(limit);
}
