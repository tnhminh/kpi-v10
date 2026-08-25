import type { AppRole, Permission } from "./types";

export const ALL_PERMISSIONS: readonly Permission[] = [
  "profile:read",
  "organization:read",
  "organization:manage",
  "kpi:read",
  "kpi:manage",
  "kpi:approve",
  "evaluation:run",
  "evaluation:ingest",
  "evaluation:self:read",
  "evaluation:team:review",
  "evaluation:department:review",
  "evaluation:finalize",
  "evaluation:lock",
  "integration:manage",
  "audit:read",
  "admin:manage",
] as const;

const ROLE_PERMISSIONS: Record<AppRole, readonly Permission[]> = {
  MEMBER: ["profile:read", "evaluation:self:read"],
  TEAM_LEADER: ["profile:read", "organization:read", "kpi:read", "evaluation:self:read", "evaluation:team:review"],
  DEPARTMENT_HEAD: [
    "profile:read",
    "organization:read",
    "kpi:read",
    "kpi:approve",
    "evaluation:run",
    "evaluation:self:read",
    "evaluation:team:review",
    "evaluation:department:review",
    "evaluation:finalize",
    "evaluation:lock",
    "audit:read",
  ],
  ADMINISTRATOR: ALL_PERMISSIONS,
};

export function permissionsForRole(role: AppRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: AppRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function canReviewTeam(role: AppRole, targetTeamId: string, ledTeamIds: readonly string[]): boolean {
  if (!hasPermission(role, "evaluation:team:review")) return false;
  if (role === "ADMINISTRATOR" || role === "DEPARTMENT_HEAD") return true;
  return role === "TEAM_LEADER" && ledTeamIds.includes(targetTeamId);
}

export function canReadMemberEvaluation(input: {
  role: AppRole;
  actorMemberId: string | null;
  targetMemberId: string;
  targetTeamId: string;
  ledTeamIds: readonly string[];
}): boolean {
  if (input.role === "ADMINISTRATOR" || input.role === "DEPARTMENT_HEAD") return true;
  if (input.role === "TEAM_LEADER") return input.ledTeamIds.includes(input.targetTeamId);
  return input.role === "MEMBER" && input.actorMemberId === input.targetMemberId;
}
