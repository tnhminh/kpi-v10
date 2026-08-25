import { evaluateFormula, FormulaError } from "./formula";
import type {
  Confidence,
  CriterionScore,
  KpiAggregate,
  MetricValue,
  NumericCondition,
  NumericOperator,
  ScoreExplanationTrace,
  ScoreResult,
  ScoringRule,
} from "./types";

export class ScoringError extends Error {}

export function clampScore(value: number, maxScore: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maxScore) || maxScore < 0 || maxScore > 10) {
    throw new ScoringError("Score and maximum score must be finite and maximum must be within 0..10.");
  }
  return Math.min(maxScore, Math.max(0, value));
}

function compare(actual: number, operator: NumericOperator, expected: number): boolean {
  switch (operator) {
    case ">": return actual > expected;
    case ">=": return actual >= expected;
    case "<": return actual < expected;
    case "<=": return actual <= expected;
    case "==": return actual === expected;
    case "!=": return actual !== expected;
  }
}

function evaluated(value: number, maxScore: number): ScoreResult {
  return { status: "EVALUATED", value: clampScore(value, maxScore) };
}

function fallback(value: number | null | undefined, maxScore: number, reason: string): ScoreResult {
  return value === null || value === undefined
    ? { status: "NOT_EVALUATED", reason }
    : evaluated(value, maxScore);
}

function variablesFor(metric: MetricValue): Record<string, number> {
  const values: Record<string, number> = {};
  if (metric.value !== null) values.value = metric.value;
  for (const [key, value] of Object.entries(metric.variables ?? {})) {
    if (value !== null) values[key] = value;
  }
  return values;
}

function conditionValue(condition: NumericCondition, metric: MetricValue): number | null {
  if (condition.field === "value") return metric.value;
  return metric.variables?.[condition.field] ?? null;
}

export function scoreMetric(metric: MetricValue, rule: ScoringRule, maxScore: number): ScoreResult {
  if (maxScore < 0 || maxScore > 10) throw new ScoringError("Criterion maximum must be within 0..10.");

  if (rule.type === "THRESHOLD") {
    if (metric.value === null) return { status: "NOT_EVALUATED", reason: "Metric value is missing." };
    const band = rule.bands.find((candidate) => compare(metric.value as number, candidate.operator, candidate.value));
    return band ? evaluated(band.score, maxScore) : fallback(rule.fallback, maxScore, "No threshold rule matched.");
  }

  if (rule.type === "RANGE") {
    if (metric.value === null) return { status: "NOT_EVALUATED", reason: "Metric value is missing." };
    const band = rule.ranges.find((candidate) => {
      const minInclusive = candidate.minInclusive ?? true;
      const maxInclusive = candidate.maxInclusive ?? false;
      const lower = candidate.min === undefined || (minInclusive ? metric.value! >= candidate.min : metric.value! > candidate.min);
      const upper = candidate.max === undefined || (maxInclusive ? metric.value! <= candidate.max : metric.value! < candidate.max);
      return lower && upper;
    });
    return band ? evaluated(band.score, maxScore) : fallback(rule.fallback, maxScore, "No range rule matched.");
  }

  if (rule.type === "FORMULA") {
    try {
      const value = evaluateFormula(rule.expression, variablesFor(metric));
      return evaluated(value, maxScore);
    } catch (error) {
      if (error instanceof FormulaError) return { status: "NOT_EVALUATED", reason: error.message };
      throw error;
    }
  }

  const branch = rule.branches.find((candidate) => candidate.all.every((condition) => {
    const actual = conditionValue(condition, metric);
    return actual !== null && compare(actual, condition.operator, condition.value);
  }));
  return branch ? evaluated(branch.score, maxScore) : fallback(rule.fallback, maxScore, "No hybrid rule matched or required data is missing.");
}

export function buildScoreExplanation(input: {
  inputFacts: Record<string, number | string | boolean | null>;
  metric: MetricValue;
  metricLabel: string;
  rule: ScoringRule;
  maxScore: number;
  confidence: Confidence;
  evidence: string[];
}): ScoreExplanationTrace {
  const score = scoreMetric(input.metric, input.rule, input.maxScore);
  return {
    input: input.inputFacts,
    metric: { label: input.metricLabel, value: input.metric.value, variables: input.metric.variables },
    rule: { type: input.rule.type, description: describeRule(input.rule) },
    score,
    confidence: input.confidence,
    evidence: [...input.evidence],
  };
}

export function describeRule(rule: ScoringRule): string {
  switch (rule.type) {
    case "THRESHOLD": return `${rule.bands.length} ordered threshold band(s)`;
    case "RANGE": return `${rule.ranges.length} numeric range(s)`;
    case "FORMULA": return `Formula: ${rule.expression}`;
    case "HYBRID": return `${rule.branches.length} conditional branch(es)`;
  }
}

export function aggregateKpi(criteria: CriterionScore[], requireFullCoverage = true): KpiAggregate {
  for (const item of criteria) {
    if (!Number.isFinite(item.maxScore) || item.maxScore < 0 || item.maxScore > 10) throw new ScoringError(`Criterion '${item.criterionId}' has an invalid maximum score.`);
    if (item.result.status === "EVALUATED" && (!Number.isFinite(item.result.value) || item.result.value < 0 || item.result.value > item.maxScore)) {
      throw new ScoringError(`Criterion '${item.criterionId}' score is outside its configured maximum.`);
    }
  }
  const totalMaxScore = criteria.reduce((sum, item) => sum + item.maxScore, 0);
  if (totalMaxScore > 10.000001) throw new ScoringError("Configured KPI maximum exceeds 10.");

  const valid = criteria.filter((item) => item.result.status === "EVALUATED");
  const evaluatedMaxScore = valid.reduce((sum, item) => sum + item.maxScore, 0);
  const coverage = totalMaxScore === 0 ? 0 : evaluatedMaxScore / totalMaxScore;
  const total = valid.reduce((sum, item) => sum + (item.result.status === "EVALUATED" ? item.result.value : 0), 0);

  const missing = criteria.length - valid.length;
  const result: ScoreResult = requireFullCoverage && missing > 0
    ? { status: "NOT_EVALUATED", reason: `${missing} criterion/criteria are not evaluated.` }
    : { status: "EVALUATED", value: clampScore(total, 10) };

  return {
    result,
    evaluatedCriteria: valid.length,
    totalCriteria: criteria.length,
    evaluatedMaxScore,
    totalMaxScore,
    coverage,
  };
}
