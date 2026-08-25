import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { appendAuditEvent } from "@/server/audit/repository";
import { hashPassword } from "@/server/auth/password";
import type { AppRole } from "@/server/auth/types";
import { getDb } from "@/server/db/client";
import { mapUniqueViolation } from "@/server/db/errors";
import { departmentHeadAssignments, departments, members, userOrganizationAccess, users } from "@/server/db/schema";
import { ApiError } from "@/server/http";

export async function listOrganizationUsers(organizationId: string) {
  return getDb().select({
    userId: users.id,
    displayName: users.displayName,
    email: users.email,
    userActive: users.active,
    role: userOrganizationAccess.role,
    accessActive: userOrganizationAccess.active,
    passwordChangeRequired: users.passwordChangeRequired,
    memberId: members.id,
    memberName: members.name,
  }).from(userOrganizationAccess)
    .innerJoin(users, eq(userOrganizationAccess.userId, users.id))
    .leftJoin(members, and(eq(members.userId, users.id), eq(members.organizationId, organizationId)))
    .where(eq(userOrganizationAccess.organizationId, organizationId))
    .orderBy(asc(users.displayName));
}

export async function provisionOrganizationUser(input: {
  organizationId: string;
  email: string;
  displayName: string;
  role: AppRole;
  temporaryPassword: string;
  memberId?: string | null;
  actorUserId: string;
  requestId?: string;
}) {
  const requiresMember = input.role === "MEMBER" || input.role === "TEAM_LEADER";
  if (requiresMember && !input.memberId) throw new ApiError(422, "MEMBER_LINK_REQUIRED", "Member and Team Leader accounts must be linked to an organization member.");
  const passwordHash = await hashPassword(input.temporaryPassword);
  try {
    return await getDb().transaction(async (tx) => {
      let member: { id: string; name: string; email: string; userId: string | null } | null = null;
      if (input.memberId) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.memberId}))`);
        const memberRows = await tx.select({ id: members.id, name: members.name, email: members.email, userId: members.userId }).from(members)
          .where(and(eq(members.id, input.memberId), eq(members.organizationId, input.organizationId), eq(members.active, true))).limit(1);
        member = memberRows[0] ?? null;
        if (!member) throw new ApiError(404, "MEMBER_NOT_FOUND", "Linked member was not found or is inactive in this organization.");
        if (member.userId) throw new ApiError(409, "MEMBER_ALREADY_LINKED", "This member is already linked to a user account.");
        if (member.email.trim().toLowerCase() !== input.email.trim().toLowerCase()) throw new ApiError(422, "MEMBER_EMAIL_MISMATCH", "Provisioned account email must match the linked member email.");
      }

      const createdRows = await tx.insert(users).values({
        email: input.email.trim(),
        displayName: input.displayName.trim(),
        passwordHash,
        passwordChangeRequired: true,
        role: input.role,
        active: true,
      }).returning({ id: users.id, email: users.email, displayName: users.displayName, role: users.role, active: users.active, passwordChangeRequired: users.passwordChangeRequired });
      const created = createdRows[0];
      if (!created) throw new ApiError(500, "USER_PROVISION_FAILED", "User account could not be provisioned.");
      await tx.insert(userOrganizationAccess).values({ userId: created.id, organizationId: input.organizationId, role: input.role, active: true });
      if (member) {
        const linkedRows = await tx.update(members).set({ userId: created.id, updatedAt: new Date() })
          .where(and(eq(members.id, member.id), isNull(members.userId)))
          .returning({ id: members.id });
        if (linkedRows.length !== 1) throw new ApiError(409, "MEMBER_ALREADY_LINKED", "This member is already linked to a user account.");
      }

      await appendAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        action: "ORGANIZATION_USER_PROVISIONED",
        entityType: "user",
        entityId: created.id,
        after: { email: created.email, displayName: created.displayName, role: created.role, memberId: member?.id ?? null, passwordChangeRequired: true },
      });
      return { userId: created.id, displayName: created.displayName, email: created.email, userActive: created.active, role: created.role, accessActive: true, passwordChangeRequired: true, memberId: member?.id ?? null, memberName: member?.name ?? null };
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    mapUniqueViolation(error, "A user with this email already exists or the selected member is already linked.");
  }
}

export async function listDepartmentHeadAssignments(organizationId: string) {
  return getDb().select({
    id: departmentHeadAssignments.id,
    departmentId: departments.id,
    departmentName: departments.name,
    userId: users.id,
    userDisplayName: users.displayName,
    userEmail: users.email,
    effectiveFrom: departmentHeadAssignments.effectiveFrom,
    effectiveTo: departmentHeadAssignments.effectiveTo,
    createdAt: departmentHeadAssignments.createdAt,
  }).from(departmentHeadAssignments)
    .innerJoin(departments, eq(departmentHeadAssignments.departmentId, departments.id))
    .innerJoin(users, eq(departmentHeadAssignments.userId, users.id))
    .where(eq(departments.organizationId, organizationId))
    .orderBy(asc(departments.name), asc(departmentHeadAssignments.effectiveFrom), asc(users.displayName));
}

export async function createDepartmentHeadAssignment(input: {
  organizationId: string;
  departmentId: string;
  userId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  actorUserId: string;
  requestId?: string;
}) {
  try {
    return await getDb().transaction(async (tx) => {
      const departmentRows = await tx.select({ id: departments.id, name: departments.name }).from(departments)
        .where(and(eq(departments.id, input.departmentId), eq(departments.organizationId, input.organizationId), eq(departments.active, true)))
        .limit(1);
      const department = departmentRows[0];
      if (!department) throw new ApiError(404, "DEPARTMENT_NOT_FOUND", "Department was not found or is inactive in this organization.");

      const userRows = await tx.select({
        userId: users.id,
        displayName: users.displayName,
        email: users.email,
        userActive: users.active,
        role: userOrganizationAccess.role,
        accessActive: userOrganizationAccess.active,
      }).from(userOrganizationAccess)
        .innerJoin(users, eq(userOrganizationAccess.userId, users.id))
        .where(and(eq(userOrganizationAccess.organizationId, input.organizationId), eq(userOrganizationAccess.userId, input.userId)))
        .limit(1);
      const target = userRows[0];
      if (!target || !target.userActive || !target.accessActive || target.role !== "DEPARTMENT_HEAD") {
        throw new ApiError(422, "INVALID_DEPARTMENT_HEAD", "Assignment target must be an active DEPARTMENT_HEAD user with active organization access.");
      }

      const createdRows = await tx.insert(departmentHeadAssignments).values({
        departmentId: input.departmentId,
        userId: input.userId,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
      }).returning();
      const created = createdRows[0];
      if (!created) throw new ApiError(500, "CREATE_FAILED", "Department Head assignment could not be created.");

      await appendAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        action: "DEPARTMENT_HEAD_ASSIGNMENT_CREATED",
        entityType: "department_head_assignment",
        entityId: created.id,
        after: {
          departmentId: created.departmentId,
          departmentName: department.name,
          userId: created.userId,
          userDisplayName: target.displayName,
          userEmail: target.email,
          effectiveFrom: created.effectiveFrom,
          effectiveTo: created.effectiveTo,
        },
      });
      return created;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    mapUniqueViolation(error, "This Department Head assignment already exists for the same department, user and effective-from date.");
  }
}

export async function closeDepartmentHeadAssignment(input: {
  organizationId: string;
  assignmentId: string;
  effectiveTo: string;
  actorUserId: string;
  requestId?: string;
}) {
  return getDb().transaction(async (tx) => {
    const rows = await tx.select({
      id: departmentHeadAssignments.id,
      departmentId: departmentHeadAssignments.departmentId,
      userId: departmentHeadAssignments.userId,
      effectiveFrom: departmentHeadAssignments.effectiveFrom,
      effectiveTo: departmentHeadAssignments.effectiveTo,
    }).from(departmentHeadAssignments)
      .innerJoin(departments, eq(departmentHeadAssignments.departmentId, departments.id))
      .where(and(eq(departmentHeadAssignments.id, input.assignmentId), eq(departments.organizationId, input.organizationId)))
      .limit(1);
    const assignment = rows[0];
    if (!assignment) throw new ApiError(404, "DEPARTMENT_HEAD_ASSIGNMENT_NOT_FOUND", "Department Head assignment was not found in this organization.");
    if (input.effectiveTo < assignment.effectiveFrom) throw new ApiError(422, "INVALID_EFFECTIVE_RANGE", "effectiveTo must be on or after effectiveFrom.");
    const today = new Date().toISOString().slice(0, 10);
    if (input.effectiveTo < today) {
      throw new ApiError(422, "RETROACTIVE_SCOPE_REWRITE_FORBIDDEN", "Department Head scope cannot be closed with a past date. Use today or a future date so historical review scope is preserved.");
    }
    if (assignment.effectiveTo && input.effectiveTo > assignment.effectiveTo) {
      throw new ApiError(409, "ASSIGNMENT_ALREADY_CLOSED", "A closed Department Head assignment cannot be extended in place; create a new effective-dated assignment instead.");
    }

    const updatedRows = await tx.update(departmentHeadAssignments).set({ effectiveTo: input.effectiveTo })
      .where(eq(departmentHeadAssignments.id, input.assignmentId)).returning();
    const updated = updatedRows[0];
    if (!updated) throw new ApiError(500, "UPDATE_FAILED", "Department Head assignment could not be closed.");
    await appendAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: "DEPARTMENT_HEAD_ASSIGNMENT_CLOSED",
      entityType: "department_head_assignment",
      entityId: input.assignmentId,
      before: { effectiveFrom: assignment.effectiveFrom, effectiveTo: assignment.effectiveTo, departmentId: assignment.departmentId, userId: assignment.userId },
      after: { effectiveFrom: updated.effectiveFrom, effectiveTo: updated.effectiveTo, departmentId: updated.departmentId, userId: updated.userId },
    });
    return updated;
  });
}
