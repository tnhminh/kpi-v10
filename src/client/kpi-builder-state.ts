import type { ScoringRuleDto, ScoringRuleInput } from "./api";

export function stripScoringRuleMetadata(rule: ScoringRuleDto): ScoringRuleInput {
  if (rule.type === "THRESHOLD") return { type: "THRESHOLD", bands: rule.bands, fallback: rule.fallback ?? null };
  if (rule.type === "RANGE") return { type: "RANGE", ranges: rule.ranges, fallback: rule.fallback ?? null };
  if (rule.type === "FORMULA") return { type: "FORMULA", expression: rule.expression };
  return { type: "HYBRID", branches: rule.branches, fallback: rule.fallback ?? null };
}

export function mergeThresholdRule(rules: ScoringRuleDto[], threshold: Extract<ScoringRuleInput, { type: "THRESHOLD" }>): ScoringRuleInput[] {
  const current = rules.map(stripScoringRuleMetadata);
  const index = current.findIndex((rule) => rule.type === "THRESHOLD");
  if (index < 0) return [...current, threshold];
  return current.map((rule, ruleIndex) => ruleIndex === index ? threshold : rule);
}

export function nextCriterionMaxScore(totalMaxScore: number): number | null {
  if (!Number.isFinite(totalMaxScore)) return null;
  const remaining = 10 - totalMaxScore;
  if (remaining <= 0) return null;
  return Math.min(1, Number(remaining.toFixed(10)));
}
