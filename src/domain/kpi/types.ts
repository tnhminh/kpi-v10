export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "REVIEW_REQUIRED";
export type EvaluationStatus = "PENDING" | "SYSTEM_EVALUATED" | "LEADER_REVIEW" | "HEAD_REVIEW" | "FINALIZED" | "LOCKED";

export type ScoreResult =
  | { status: "EVALUATED"; value: number }
  | { status: "NOT_EVALUATED"; reason: string };

export interface MetricValue {
  value: number | null;
  label?: string;
  variables?: Record<string, number | null>;
}

export type NumericOperator = ">" | ">=" | "<" | "<=" | "==" | "!=";

export interface NumericCondition {
  field: string;
  operator: NumericOperator;
  value: number;
}

export interface ThresholdRule {
  type: "THRESHOLD";
  bands: Array<{ operator: NumericOperator; value: number; score: number }>;
  fallback?: number | null;
}

export interface RangeRule {
  type: "RANGE";
  ranges: Array<{
    min?: number;
    max?: number;
    minInclusive?: boolean;
    maxInclusive?: boolean;
    score: number;
  }>;
  fallback?: number | null;
}

export interface FormulaRule {
  type: "FORMULA";
  expression: string;
}

export interface HybridRule {
  type: "HYBRID";
  branches: Array<{ all: NumericCondition[]; score: number }>;
  fallback?: number | null;
}

export type ScoringRule = ThresholdRule | RangeRule | FormulaRule | HybridRule;

export interface ScoreExplanationTrace {
  input: Record<string, number | string | boolean | null>;
  metric: { label: string; value: number | null; variables?: Record<string, number | null> };
  rule: { type: ScoringRule["type"]; description: string };
  score: ScoreResult;
  confidence: Confidence;
  evidence: string[];
}

export interface CriterionScore {
  criterionId: string;
  maxScore: number;
  result: ScoreResult;
}

export interface KpiAggregate {
  result: ScoreResult;
  evaluatedCriteria: number;
  totalCriteria: number;
  evaluatedMaxScore: number;
  totalMaxScore: number;
  coverage: number;
}

export interface RankBand {
  rank: string;
  coefficient: number;
  minScore: number | null;
  maxScore: number | null;
  minInclusive: boolean;
  maxInclusive: boolean;
}

export interface RankResolution {
  rank: string;
  coefficient: number;
}

export interface EffectiveMembership {
  id: string;
  memberId: string;
  teamId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  primary: boolean;
}

export interface KpiAssignment {
  periodId: string;
  teamId: string;
  kpiVersionId: string;
}

export interface HistoricalAggregate {
  score: number | null;
  validCount: number;
  totalCount: number;
  coverageLabel: string;
  rank: RankResolution | null;
}
