import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { appendAuditEvent } from "@/server/audit/repository";
import { getDb, getSqlClient } from "@/server/db/client";
import { authLoginAttempts, sessions, userOrganizationAccess, users } from "@/server/db/schema";
import type { AuthenticatedUser, UserWithPassword } from "./types";

export async function findUserForLogin(normalizedEmail: string): Promise<UserWithPassword | null> {
  const rows = await getDb()
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      active: users.active,
      passwordHash: users.passwordHash,
      passwordChangeRequired: users.passwordChangeRequired,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`)
    .limit(1);
  return rows[0] ?? null;
}

export async function persistSession(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await tx.insert(sessions).values({ userId: input.userId, tokenHash: input.tokenHash, expiresAt: input.expiresAt });
    await tx.update(users).set({ lastLoginAt: now, updatedAt: now }).where(eq(users.id, input.userId));
  });
}

export async function resolveSession(tokenHash: string, now = new Date()): Promise<AuthenticatedUser | null> {
  const rows = await getDb()
    .select({ id: users.id, email: users.email, displayName: users.displayName, role: users.role, passwordChangeRequired: users.passwordChangeRequired })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), eq(users.active, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function revokeSession(tokenHash: string): Promise<void> {
  await getDb()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
}

export async function isLoginBlocked(keyHash: string, now = new Date()): Promise<boolean> {
  const rows = await getDb()
    .select({ blockedUntil: authLoginAttempts.blockedUntil })
    .from(authLoginAttempts)
    .where(eq(authLoginAttempts.keyHash, keyHash))
    .limit(1);
  return Boolean(rows[0]?.blockedUntil && rows[0].blockedUntil > now);
}

export async function recordLoginFailure(keyHash: string): Promise<void> {
  const client = getSqlClient();
  await client`
    INSERT INTO auth_login_attempts (key_hash, failed_count, window_started_at, blocked_until, updated_at)
    VALUES (${keyHash}, 1, now(), NULL, now())
    ON CONFLICT (key_hash) DO UPDATE SET
      failed_count = CASE
        WHEN auth_login_attempts.window_started_at < now() - interval '15 minutes' THEN 1
        ELSE auth_login_attempts.failed_count + 1
      END,
      window_started_at = CASE
        WHEN auth_login_attempts.window_started_at < now() - interval '15 minutes' THEN now()
        ELSE auth_login_attempts.window_started_at
      END,
      blocked_until = CASE
        WHEN (CASE
          WHEN auth_login_attempts.window_started_at < now() - interval '15 minutes' THEN 1
          ELSE auth_login_attempts.failed_count + 1
        END) >= 5 THEN now() + interval '15 minutes'
        ELSE NULL
      END,
      updated_at = now()
  `;
}

export async function clearLoginFailures(keyHash: string): Promise<void> {
  await getDb().delete(authLoginAttempts).where(eq(authLoginAttempts.keyHash, keyHash));
}

export async function changePasswordAndRevokeOtherSessions(input: { userId: string; passwordHash: string; currentTokenHash: string; requestId?: string }): Promise<void> {
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await tx.update(users).set({
      passwordHash: input.passwordHash,
      passwordChangeRequired: false,
      passwordChangedAt: now,
      updatedAt: now,
    }).where(eq(users.id, input.userId));
    await tx.update(sessions).set({ revokedAt: now }).where(sql`${sessions.userId} = ${input.userId} and ${sessions.tokenHash} <> ${input.currentTokenHash} and ${sessions.revokedAt} is null`);
    const accessRows = await tx.select({ organizationId: userOrganizationAccess.organizationId }).from(userOrganizationAccess)
      .where(and(eq(userOrganizationAccess.userId, input.userId), eq(userOrganizationAccess.active, true)));
    for (const access of accessRows) {
      await appendAuditEvent(tx, {
        organizationId: access.organizationId,
        actorUserId: input.userId,
        requestId: input.requestId,
        action: "PASSWORD_CHANGED",
        entityType: "user",
        entityId: input.userId,
        after: { passwordChangeRequired: false, otherSessionsRevoked: true },
      });
    }
  });
}
