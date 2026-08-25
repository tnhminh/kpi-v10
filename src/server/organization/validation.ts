import { z } from "zod";
import { ApiError } from "@/server/http";

export const uuidSchema = z.string().uuid();

export function parseUuidParam(value: string, label: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "INVALID_ID", `${label} must be a valid UUID.`);
  return parsed.data;
}

export const createTeamSchema = z.object({
  departmentId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  effectiveFrom: z.iso.date(),
  leaderMemberId: z.string().uuid().nullable().optional(),
});

export const createMemberSchema = z.object({
  employeeId: z.string().trim().min(1).max(80),
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
});

export const createMembershipSchema = z.object({
  teamId: z.string().uuid(),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().nullable().optional(),
  primary: z.boolean().default(true),
}).superRefine((value, context) => {
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    context.addIssue({ code: "custom", path: ["effectiveTo"], message: "effectiveTo must be on or after effectiveFrom." });
  }
});

export const provisionOrganizationUserSchema = z.object({
  email: z.string().trim().email().max(254),
  displayName: z.string().trim().min(2).max(160),
  role: z.enum(["MEMBER", "TEAM_LEADER", "DEPARTMENT_HEAD", "ADMINISTRATOR"]),
  temporaryPassword: z.string().min(12).max(256),
  memberId: z.string().uuid().nullable().optional(),
});

export const createDepartmentHeadAssignmentSchema = z.object({
  departmentId: z.string().uuid(),
  userId: z.string().uuid(),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().nullable().optional(),
}).superRefine((value, context) => {
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    context.addIssue({ code: "custom", path: ["effectiveTo"], message: "effectiveTo must be on or after effectiveFrom." });
  }
});

export const closeDepartmentHeadAssignmentSchema = z.object({
  effectiveTo: z.iso.date(),
});

export const createKpiTemplateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  kpiGroup: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});
