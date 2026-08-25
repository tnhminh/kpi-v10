import { describe, expect, it } from "vitest";
import { canReadMemberEvaluation, canReviewTeam, hasPermission, permissionsForRole } from "./rbac";

describe("server-side RBAC policy", () => {
  it("keeps members limited to self-service access", () => {
    expect(hasPermission("MEMBER", "evaluation:self:read")).toBe(true);
    expect(hasPermission("MEMBER", "evaluation:team:review")).toBe(false);
    expect(hasPermission("MEMBER", "kpi:manage")).toBe(false);
  });

  it("allows team leaders to review teams but not finalize departments", () => {
    expect(hasPermission("TEAM_LEADER", "evaluation:team:review")).toBe(true);
    expect(hasPermission("TEAM_LEADER", "evaluation:finalize")).toBe(false);
  });

  it("allows department heads to calibrate/finalize without administrator configuration rights", () => {
    expect(hasPermission("DEPARTMENT_HEAD", "evaluation:department:review")).toBe(true);
    expect(hasPermission("DEPARTMENT_HEAD", "evaluation:run")).toBe(true);
    expect(hasPermission("DEPARTMENT_HEAD", "evaluation:ingest")).toBe(false);
    expect(hasPermission("DEPARTMENT_HEAD", "evaluation:finalize")).toBe(true);
    expect(hasPermission("DEPARTMENT_HEAD", "kpi:approve")).toBe(true);
    expect(hasPermission("DEPARTMENT_HEAD", "kpi:manage")).toBe(false);
    expect(hasPermission("DEPARTMENT_HEAD", "admin:manage")).toBe(false);
  });

  it("grants administrators the complete permission set", () => {
    expect(permissionsForRole("ADMINISTRATOR")).toContain("admin:manage");
    expect(permissionsForRole("ADMINISTRATOR")).toContain("evaluation:lock");
    expect(permissionsForRole("ADMINISTRATOR")).toContain("evaluation:ingest");
    expect(permissionsForRole("ADMINISTRATOR")).toContain("integration:manage");
  });

  it("prevents team leaders from reviewing teams outside their resolved leadership scope", () => {
    expect(canReviewTeam("TEAM_LEADER", "team-api", ["team-api"])).toBe(true);
    expect(canReviewTeam("TEAM_LEADER", "team-payment", ["team-api"])).toBe(false);
    expect(canReviewTeam("DEPARTMENT_HEAD", "team-payment", [])).toBe(false);
    expect(canReviewTeam("DEPARTMENT_HEAD", "team-payment", ["team-payment"])).toBe(true);
  });

  it("limits member evaluation reads to self while honoring resolved team leadership", () => {
    expect(canReadMemberEvaluation({ role: "MEMBER", actorMemberId: "member-1", targetMemberId: "member-1", targetTeamId: "team-api", authorizedTeamIds: [] })).toBe(true);
    expect(canReadMemberEvaluation({ role: "MEMBER", actorMemberId: "member-1", targetMemberId: "member-2", targetTeamId: "team-api", authorizedTeamIds: [] })).toBe(false);
    expect(canReadMemberEvaluation({ role: "TEAM_LEADER", actorMemberId: "leader-1", targetMemberId: "member-2", targetTeamId: "team-api", authorizedTeamIds: ["team-api"] })).toBe(true);
    expect(canReadMemberEvaluation({ role: "TEAM_LEADER", actorMemberId: "leader-1", targetMemberId: "member-2", targetTeamId: "team-payment", authorizedTeamIds: ["team-api"] })).toBe(false);
    expect(canReadMemberEvaluation({ role: "DEPARTMENT_HEAD", actorMemberId: null, targetMemberId: "member-2", targetTeamId: "team-payment", authorizedTeamIds: [] })).toBe(false);
    expect(canReadMemberEvaluation({ role: "DEPARTMENT_HEAD", actorMemberId: null, targetMemberId: "member-2", targetTeamId: "team-payment", authorizedTeamIds: ["team-payment"] })).toBe(true);
  });
});
