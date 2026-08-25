import { describe, expect, it } from "vitest";
import { createMetricDefinitionSchema } from "./validation";

const base = {
  key: "delivery.ratio",
  name: "Delivery ratio",
  description: null,
  requiredFields: [],
  supportedIssueTypes: [],
  dataQualityRequirements: {},
};

describe("KPI API validation", () => {
  it("requires a syntactically valid formula for custom metrics", () => {
    expect(createMetricDefinitionSchema.safeParse({ ...base, formulaKind: "CUSTOM_FORMULA" }).success).toBe(false);
    expect(createMetricDefinitionSchema.safeParse({ ...base, formulaKind: "CUSTOM_FORMULA", formula: "value +" }).success).toBe(false);
    expect(createMetricDefinitionSchema.safeParse({ ...base, formulaKind: "CUSTOM_FORMULA", formula: "done / total" }).success).toBe(true);
  });

  it("does not require a formula for built-in metric kinds", () => {
    expect(createMetricDefinitionSchema.safeParse({ ...base, formulaKind: "RATIO" }).success).toBe(true);
  });
});
