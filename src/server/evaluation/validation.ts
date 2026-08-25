import { z } from "zod";

const factValue = z.union([z.number().finite(), z.string().max(4000), z.boolean(), z.null()]);
const evidenceSource = z.enum(["JIRA", "MANUAL", "CUSTOM"]);
const confidence = z.enum(["HIGH", "MEDIUM", "LOW", "REVIEW_REQUIRED"]);

export const createEvaluationPeriodSchema = z.object({
  key: z.string().trim().min(2).max(80),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  rankSchemeId: z.string().uuid().nullable().optional(),
}).superRefine((value, context) => {
  if (value.endsOn < value.startsOn) context.addIssue({ code: "custom", path: ["endsOn"], message: "endsOn must be on or after startsOn." });
});

const assignmentSchema = z.object({ teamId: z.string().uuid(), kpiVersionId: z.string().uuid() });

export const replacePeriodAssignmentsSchema = z.object({ assignments: z.array(assignmentSchema).max(500) }).superRefine((value, context) => {
  const ids = new Set<string>();
  value.assignments.forEach((assignment, index) => {
    if (ids.has(assignment.teamId)) context.addIssue({ code: "custom", path: ["assignments", index, "teamId"], message: "Each team can have only one KPI assignment per period." });
    ids.add(assignment.teamId);
  });
});

export const evaluationPeriodActionSchema = z.object({ action: z.literal("START_COLLECTION") });

const collectedEvidenceSchema = z.object({
  type: evidenceSource,
  sourceRef: z.string().trim().max(500).nullable().optional(),
  title: z.string().trim().min(1).max(500),
  payload: z.record(z.string(), z.unknown()).default({}),
});

const collectedCriterionSchema = z.object({
  criterionId: z.string().uuid(),
  inputFacts: z.record(z.string(), factValue).default({}),
  metric: z.object({ value: z.number().finite().nullable(), variables: z.record(z.string(), z.number().finite().nullable()).optional() }).optional(),
  confidence: confidence.optional(),
  evidence: z.array(collectedEvidenceSchema).max(500).default([]),
});

export const jiraEvaluationSchema = z.object({
  memberIds: z.array(z.string().uuid()).max(500).default([]),
}).superRefine((value, context) => {
  const ids = new Set<string>();
  value.memberIds.forEach((memberId, index) => {
    if (ids.has(memberId)) context.addIssue({ code: "custom", path: ["memberIds", index], message: "Each member may appear only once per Jira evaluation request." });
    ids.add(memberId);
  });
});

export const evaluatePeriodSchema = z.object({
  members: z.array(z.object({ memberId: z.string().uuid(), criteria: z.array(collectedCriterionSchema).max(500) })).min(1).max(500),
}).superRefine((value, context) => {
  const memberIds = new Set<string>();
  value.members.forEach((member, memberIndex) => {
    if (memberIds.has(member.memberId)) context.addIssue({ code: "custom", path: ["members", memberIndex, "memberId"], message: "Each member may appear only once per evaluation request." });
    memberIds.add(member.memberId);
  });
});
