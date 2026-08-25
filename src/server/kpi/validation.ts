import { FormulaError, validateFormulaSyntax } from "@/domain/kpi/formula";
import { z } from "zod";

const finite = z.number().finite();
const score = finite.min(0).max(10);
const operator = z.enum([">", ">=", "<", "<=", "==", "!="]);

export const createMetricDefinitionSchema = z.object({
  key: z.string().trim().min(2).max(100).regex(/^[a-z][a-z0-9_.-]*$/),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  formulaKind: z.enum(["COUNT", "RATIO", "DURATION", "CUSTOM_FORMULA"]),
  formula: z.string().trim().max(2000).nullable().optional(),
  requiredFields: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  supportedIssueTypes: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  dataQualityRequirements: z.record(z.string(), z.unknown()).default({}),
}).superRefine((value, ctx) => {
  if (value.formulaKind !== "CUSTOM_FORMULA") return;
  if (!value.formula) {
    ctx.addIssue({ code: "custom", path: ["formula"], message: "CUSTOM_FORMULA metrics require a formula." });
    return;
  }
  try {
    validateFormulaSyntax(value.formula);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      path: ["formula"],
      message: error instanceof FormulaError ? `Invalid formula syntax: ${error.message}` : "Invalid formula syntax.",
    });
  }
});

export const createVersionSchema = z.object({ sourceVersionId: z.string().uuid().nullable().optional() });

export const criterionInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  position: z.number().int().min(0).max(999),
  maxScore: z.number().finite().gt(0).max(10),
  method: z.enum(["AUTO", "ASSISTED", "MANUAL"]),
  evidencePolicy: z.object({
    sources: z.array(z.enum(["JIRA", "MANUAL", "CUSTOM"])).max(3).default([]),
    config: z.record(z.string(), z.unknown()).optional(),
  }).default({ sources: [] }),
  reviewRequired: z.boolean().default(true),
  requiredEvidence: z.boolean().default(false),
  adjustmentPolicy: z.object({ meaningfulDelta: z.number().finite().min(0).max(10).optional() }).catchall(z.unknown()).default({}),
});

export const updateCriterionSchema = criterionInputSchema.partial().refine((value) => Object.keys(value).length > 0, { message: "At least one field is required." });

export const metricConfigurationSchema = z.object({
  metricDefinitionId: z.string().uuid(),
  parameters: z.record(z.string(), z.unknown()).default({}),
});

const thresholdRule = z.object({
  type: z.literal("THRESHOLD"),
  bands: z.array(z.object({ operator, value: finite, score })).min(1).max(100),
  fallback: score.nullable().optional(),
});
const rangeRule = z.object({
  type: z.literal("RANGE"),
  ranges: z.array(z.object({ min: finite.optional(), max: finite.optional(), minInclusive: z.boolean().optional(), maxInclusive: z.boolean().optional(), score }).refine((v) => v.min === undefined || v.max === undefined || v.min <= v.max, { message: "min cannot exceed max" })).min(1).max(100),
  fallback: score.nullable().optional(),
});
const formulaRule = z.object({ type: z.literal("FORMULA"), expression: z.string().trim().min(1).max(2000) });
const hybridRule = z.object({
  type: z.literal("HYBRID"),
  branches: z.array(z.object({
    all: z.array(z.object({ field: z.string().trim().min(1).max(120), operator, value: finite })).min(1).max(50),
    score,
  })).min(1).max(100),
  fallback: score.nullable().optional(),
});

export const scoringRuleSchema = z.discriminatedUnion("type", [thresholdRule, rangeRule, formulaRule, hybridRule]);
export const replaceScoringRulesSchema = z.object({ rules: z.array(scoringRuleSchema).min(1).max(20) });
export const lifecycleActionSchema = z.object({ action: z.enum(["SUBMIT", "APPROVE", "PUBLISH", "RETIRE"]) });
