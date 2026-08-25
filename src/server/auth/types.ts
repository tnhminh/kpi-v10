export type AppRole = "MEMBER" | "TEAM_LEADER" | "DEPARTMENT_HEAD" | "ADMINISTRATOR";

export type Permission =
  | "profile:read"
  | "organization:read"
  | "organization:manage"
  | "kpi:read"
  | "kpi:manage"
  | "kpi:approve"
  | "evaluation:run"
  | "evaluation:ingest"
  | "evaluation:self:read"
  | "evaluation:team:review"
  | "evaluation:department:review"
  | "evaluation:finalize"
  | "evaluation:lock"
  | "integration:manage"
  | "audit:read"
  | "admin:manage";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: AppRole;
  passwordChangeRequired: boolean;
}

export interface UserWithPassword extends AuthenticatedUser {
  active: boolean;
  passwordHash: string | null;
}
