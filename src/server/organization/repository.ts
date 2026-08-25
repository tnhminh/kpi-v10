import { and, asc, desc, eq, sql } from "drizzle-orm";
import { appendAuditEvent } from "@/server/audit/repository";
import { getDb } from "@/server/db/client";
import {
  departments,
  kpiTemplates,
  kpiVersions,
  members,
  teamLeadershipAssignments,
  teamMemberships,
  teams,
} from "@/server/db/schema";
import { ApiError } from "@/server/http";
import { mapUniqueViolation } from "@/server/db/errors";
import { assertNoPrimaryMembershipOverlap } from "./membership";

export async function listDepartments(organizationId: string) {
  return getDb()
    .select({
      id: departments.id,
      name: departments.name,
      code: departments.code,
      active: departments.active,
    })
    .from(departments)
    .where(and(eq(departments.organizationId, organizationId), eq(departments.active, true)))
    .orderBy(departments.name);
}

export async function listTeams(organizationId: string) {
  return getDb()
    .select({
      id: teams.id,
      name: teams.name,
      description: teams.description,
      effectiveFrom: teams.effectiveFrom,
      active: teams.active,
      departmentId: departments.id,
      departmentName: departments.name,
      leaderMemberId: teams.leaderMemberId,
    })
    .from(teams)
    .innerJoin(departments, eq(teams.departmentId, departments.id))
    .where(eq(departments.organizationId, organizationId))
    .orderBy(departments.name, teams.name);
}

export async function createTeam(input: {
  organizationId: string;
  departmentId: string;
  name: string;
  description?: string | null;
  effectiveFrom: string;
  leaderMemberId?: string | null;
  actorUserId: string;
  requestId?: string;
}) {
  try {
    return await getDb().transaction(async (tx) => {
    const department = await tx.select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.id, input.departmentId), eq(departments.organizationId, input.organizationId)))
      .limit(1);
    if (!department[0]) throw new ApiError(404, "DEPARTMENT_NOT_FOUND", "Department was not found in this organization.");

    if (input.leaderMemberId) {
      const leader = await tx.select({ id: members.id })
        .from(members)
        .where(and(eq(members.id, input.leaderMemberId), eq(members.organizationId, input.organizationId), eq(members.active, true)))
        .limit(1);
      if (!leader[0]) throw new ApiError(422, "INVALID_LEADER", "Team leader must be an active member of this organization.");
    }

    const created = await tx.insert(teams).values({
      departmentId: input.departmentId,
      name: input.name,
      description: input.description ?? null,
      effectiveFrom: input.effectiveFrom,
      leaderMemberId: input.leaderMemberId ?? null,
    }).returning();
    const team = created[0];

    if (team && input.leaderMemberId) {
      await tx.insert(teamLeadershipAssignments).values({
        teamId: team.id,
        leaderMemberId: input.leaderMemberId,
        effectiveFrom: input.effectiveFrom,
      });
    }
    if (!team) throw new ApiError(500, "CREATE_FAILED", "Team could not be created.");
    await appendAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: "TEAM_CREATED",
      entityType: "team",
      entityId: team.id,
      after: { name: team.name, departmentId: team.departmentId, description: team.description, effectiveFrom: team.effectiveFrom, leaderMemberId: team.leaderMemberId },
    });
      return team;
    });
  } catch (error) {
    mapUniqueViolation(error, "A team with this name already exists in the department.");
  }
}

export async function listMembers(organizationId: string) {
  return getDb()
    .select({ id: members.id, employeeId: members.employeeId, name: members.name, email: members.email, active: members.active })
    .from(members)
    .where(eq(members.organizationId, organizationId))
    .orderBy(members.name);
}

export async function createMember(input: { organizationId: string; actorUserId: string; requestId?: string; employeeId: string; name: string; email: string }) {
  try {
    return await getDb().transaction(async (tx) => {
      const created = await tx.insert(members).values({
        organizationId: input.organizationId,
        employeeId: input.employeeId,
        name: input.name,
        email: input.email.trim().toLowerCase(),
      }).returning();
      const member = created[0];
      if (!member) throw new ApiError(500, "CREATE_FAILED", "Member could not be created.");
      await appendAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        action: "MEMBER_CREATED",
        entityType: "member",
        entityId: member.id,
        after: { employeeId: member.employeeId, name: member.name, email: member.email, active: member.active },
      });
      return member;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    mapUniqueViolation(error, "A member with this employee ID or email already exists in the organization.");
  }
}

export async function assignMemberToTeam(input: {
  organizationId: string;
  memberId: string;
  teamId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  primary: boolean;
  actorUserId: string;
  requestId?: string;
}) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.memberId}))`);

    const member = await tx.select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, input.memberId), eq(members.organizationId, input.organizationId), eq(members.active, true)))
      .limit(1);
    if (!member[0]) throw new ApiError(404, "MEMBER_NOT_FOUND", "Member was not found in this organization.");

    const team = await tx.select({ id: teams.id })
      .from(teams)
      .innerJoin(departments, eq(teams.departmentId, departments.id))
      .where(and(eq(teams.id, input.teamId), eq(departments.organizationId, input.organizationId), eq(teams.active, true)))
      .limit(1);
    if (!team[0]) throw new ApiError(404, "TEAM_NOT_FOUND", "Team was not found in this organization.");

    if (input.primary) {
      const existing = await tx.select({ effectiveFrom: teamMemberships.effectiveFrom, effectiveTo: teamMemberships.effectiveTo })
        .from(teamMemberships)
        .where(and(eq(teamMemberships.memberId, input.memberId), eq(teamMemberships.primary, true)));
      try {
        assertNoPrimaryMembershipOverlap(
          { effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null },
          existing,
        );
      } catch {
        throw new ApiError(409, "MEMBERSHIP_OVERLAP", "Primary team membership overlaps an existing primary membership.");
      }
    }

    const created = await tx.insert(teamMemberships).values({
      memberId: input.memberId,
      teamId: input.teamId,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      primary: input.primary,
    }).returning();
    const membership = created[0];
    if (!membership) throw new ApiError(500, "CREATE_FAILED", "Team membership could not be created.");
    await appendAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: "TEAM_MEMBERSHIP_CREATED",
      entityType: "team_membership",
      entityId: membership.id,
      after: { memberId: membership.memberId, teamId: membership.teamId, effectiveFrom: membership.effectiveFrom, effectiveTo: membership.effectiveTo, primary: membership.primary },
      metadata: { memberId: input.memberId, teamId: input.teamId },
    });
    return membership;
  });
}

export async function listMemberMemberships(organizationId: string, memberId: string) {
  const member = await getDb().select({ id: members.id }).from(members)
    .where(and(eq(members.id, memberId), eq(members.organizationId, organizationId))).limit(1);
  if (!member[0]) throw new ApiError(404, "MEMBER_NOT_FOUND", "Member was not found in this organization.");

  return getDb()
    .select({
      id: teamMemberships.id,
      teamId: teams.id,
      teamName: teams.name,
      effectiveFrom: teamMemberships.effectiveFrom,
      effectiveTo: teamMemberships.effectiveTo,
      primary: teamMemberships.primary,
    })
    .from(teamMemberships)
    .innerJoin(teams, eq(teamMemberships.teamId, teams.id))
    .innerJoin(departments, eq(teams.departmentId, departments.id))
    .where(and(eq(teamMemberships.memberId, memberId), eq(departments.organizationId, organizationId)))
    .orderBy(desc(teamMemberships.effectiveFrom));
}

export async function listKpiTemplates(organizationId: string) {
  return getDb()
    .select({
      id: kpiTemplates.id,
      name: kpiTemplates.name,
      kpiGroup: kpiTemplates.kpiGroup,
      description: kpiTemplates.description,
      createdAt: kpiTemplates.createdAt,
    })
    .from(kpiTemplates)
    .where(eq(kpiTemplates.organizationId, organizationId))
    .orderBy(asc(kpiTemplates.name));
}

export async function createKpiTemplate(input: {
  organizationId: string;
  actorUserId: string;
  requestId?: string;
  name: string;
  kpiGroup?: string | null;
  description?: string | null;
}) {
  try {
    return await getDb().transaction(async (tx) => {
    const templates = await tx.insert(kpiTemplates).values({
      organizationId: input.organizationId,
      name: input.name,
      kpiGroup: input.kpiGroup ?? null,
      description: input.description ?? null,
      createdBy: input.actorUserId,
    }).returning();
    const template = templates[0];
    if (!template) throw new ApiError(500, "CREATE_FAILED", "KPI template could not be created.");

    const versions = await tx.insert(kpiVersions).values({
      templateId: template.id,
      version: 1,
      status: "DRAFT",
      totalMaxScore: "0",
      createdBy: input.actorUserId,
    }).returning();
    const version = versions[0];
    if (!version) throw new ApiError(500, "CREATE_FAILED", "Initial KPI version could not be created.");
    await appendAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: "KPI_TEMPLATE_CREATED",
      entityType: "kpi_template",
      entityId: template.id,
      after: { name: template.name, kpiGroup: template.kpiGroup, description: template.description, initialVersionId: version.id, initialVersion: version.version },
    });
      return { template, version };
    });
  } catch (error) {
    mapUniqueViolation(error, "A KPI template with this name already exists in the organization.");
  }
}
