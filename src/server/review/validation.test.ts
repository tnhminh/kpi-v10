import { describe, expect, it } from "vitest";
import { completeReviewSchema, qualityResolutionSchema, reviewQueueLayerSchema } from "./validation";

const criterionEvaluationId = "11111111-1111-4111-8111-111111111111";

describe("review validation", () => {
  it("accepts an empty unchanged review payload", () => {
    expect(completeReviewSchema.parse({})).toEqual({ adjustments: [] });
  });

  it("accepts a bounded score with an auditable reason", () => {
    expect(completeReviewSchema.parse({
      adjustments: [{ criterionEvaluationId, score: 2.5, reason: "Evidence supports the human override." }],
    })).toEqual({
      adjustments: [{ criterionEvaluationId, score: 2.5, reason: "Evidence supports the human override." }],
    });
  });

  it("rejects duplicate criterion changes and invalid score values", () => {
    expect(completeReviewSchema.safeParse({ adjustments: [
      { criterionEvaluationId, score: 1 },
      { criterionEvaluationId, score: 2 },
    ] }).success).toBe(false);
    expect(completeReviewSchema.safeParse({ adjustments: [{ criterionEvaluationId, score: Number.NaN }] }).success).toBe(false);
    expect(completeReviewSchema.safeParse({ adjustments: [{ criterionEvaluationId, score: 10.1 }] }).success).toBe(false);
  });

  it("allows only explicit review queue layers", () => {
    expect(reviewQueueLayerSchema.parse("LEADER")).toBe("LEADER");
    expect(reviewQueueLayerSchema.parse("DEPARTMENT_HEAD")).toBe("DEPARTMENT_HEAD");
    expect(reviewQueueLayerSchema.safeParse("ADMIN").success).toBe(false);
  });

  it("requires an explicit auditable quality disposition and reason", () => {
    expect(qualityResolutionSchema.parse({ disposition: "WAIVED", reason: "Verified source gap; Head accepts manual evidence." })).toEqual({
      disposition: "WAIVED",
      reason: "Verified source gap; Head accepts manual evidence.",
    });
    expect(qualityResolutionSchema.safeParse({ disposition: "RESOLVED", reason: "   " }).success).toBe(false);
    expect(qualityResolutionSchema.safeParse({ disposition: "IGNORED", reason: "x" }).success).toBe(false);
  });
});
