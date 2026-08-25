import { z } from "zod";

const reviewAdjustmentSchema = z.object({
  criterionEvaluationId: z.string().uuid(),
  score: z.number().finite().min(0).max(10),
  reason: z.string().trim().min(1).max(4000).optional(),
});

export const completeReviewSchema = z.object({
  adjustments: z.array(reviewAdjustmentSchema).max(500).default([]),
}).superRefine((value, context) => {
  const ids = new Set<string>();
  value.adjustments.forEach((adjustment, index) => {
    if (ids.has(adjustment.criterionEvaluationId)) {
      context.addIssue({ code: "custom", path: ["adjustments", index, "criterionEvaluationId"], message: "Each criterion may be adjusted only once per review request." });
    }
    ids.add(adjustment.criterionEvaluationId);
  });
});

export const reviewQueueLayerSchema = z.enum(["LEADER", "DEPARTMENT_HEAD"]);

export const qualityResolutionSchema = z.object({
  disposition: z.enum(["RESOLVED", "WAIVED"]),
  reason: z.string().trim().min(1).max(4000),
});
