import { aggregateKpi, describeRule, scoreMetric } from "@/domain/kpi/scoring";
import type { Confidence, CriterionScore, MetricValue, ScoreExplanationTrace, ScoreResult, ScoringRule } from "@/domain/kpi/types";

export type EvaluationMethod = "AUTO" | "ASSISTED" | "MANUAL";
export type EvidenceType = "JIRA" | "MANUAL" | "CUSTOM";
export type QualitySeverity = "INFO" | "WARNING" | "CRITICAL";

export interface EvaluationEvidenceInput {
  type: EvidenceType;
  sourceRef?: string | null;
  title: string;
  payload?: Record<string, unknown>;
}

export interface EvaluationQualityIssueInput {
  code: string;
  missingField?: string | null;
  affectedMetric?: string | null;
  severity: QualitySeverity;
  message: string;
}

export interface MetricInputBundle {
  inputFacts: Record<string, number | string | boolean | null>;
  metric: MetricValue;
  confidence: Confidence;
  evidence: EvaluationEvidenceInput[];
  qualityIssues: EvaluationQualityIssueInput[];
}

export interface MetricInputContext {
  organizationId: string;
  memberId: string;
  period: { id: string; key: string; startsOn: string; endsOn: string };
  criterion: {
    id: string;
    name: string;
    method: EvaluationMethod;
    requiredEvidence: boolean;
    evidenceSources: EvidenceType[];
  };
  metricDefinition: {
    id: string;
    key: string;
    name: string;
    formulaKind: string;
    formula: string | null;
    requiredFields: string[];
    supportedIssueTypes?: string[];
    dataQualityRequirements: Record<string, unknown>;
  };
  parameters: Record<string, unknown>;
}

export interface MetricInputProvider {
  collect(context: MetricInputContext): Promise<MetricInputBundle>;
}

export class UnavailableMetricInputProvider implements MetricInputProvider {
  async collect(context: MetricInputContext): Promise<MetricInputBundle> {
    return {
      inputFacts: {},
      metric: { value: null },
      confidence: "REVIEW_REQUIRED",
      evidence: [],
      qualityIssues: [{
        code: "METRIC_INPUT_UNAVAILABLE",
        affectedMetric: context.metricDefinition.name,
        severity: "WARNING",
        message: "No metric input provider is configured for this evaluation source yet.",
      }],
    };
  }
}

export interface PipelineCriterion {
  id: string;
  name: string;
  maxScore: number;
  method: EvaluationMethod;
  requiredEvidence: boolean;
  evidenceSources: EvidenceType[];
  metricConfiguration: null | {
    metricDefinitionId: string;
    parameters: Record<string, unknown>;
  };
  metricDefinition: null | MetricInputContext["metricDefinition"];
  rules: ScoringRule[];
}

export interface CriterionPipelineResult {
  criterionId: string;
  maxScore: number;
  result: ScoreResult;
  confidence: Confidence;
  metricValue: MetricValue | null;
  explanationTrace: ScoreExplanationTrace | Record<string, unknown>;
  evidence: EvaluationEvidenceInput[];
  qualityIssues: EvaluationQualityIssueInput[];
}

function lowerConfidence(left: Confidence, right: Confidence): Confidence {
  const order: Confidence[] = ["HIGH", "MEDIUM", "LOW", "REVIEW_REQUIRED"];
  return order[Math.max(order.indexOf(left), order.indexOf(right))] ?? "REVIEW_REQUIRED";
}

export function aggregateConfidence(results: CriterionPipelineResult[]): Confidence {
  if (results.length === 0) return "REVIEW_REQUIRED";
  return results.reduce<Confidence>((value, row) => lowerConfidence(value, row.confidence), "HIGH");
}

function scoreWithOrderedRules(metric: MetricValue, rules: ScoringRule[], maxScore: number): { result: ScoreResult; rule: ScoringRule | null; attempts: Array<{ type: ScoringRule["type"]; result: ScoreResult }> } {
  const attempts: Array<{ type: ScoringRule["type"]; result: ScoreResult }> = [];
  for (const rule of rules) {
    const result = scoreMetric(metric, rule, maxScore);
    attempts.push({ type: rule.type, result });
    if (result.status === "EVALUATED") return { result, rule, attempts };
  }
  return {
    result: attempts.at(-1)?.result ?? { status: "NOT_EVALUATED", reason: "No scoring rule is configured." },
    rule: rules.at(-1) ?? null,
    attempts,
  };
}

export async function evaluateCriterion(input: {
  organizationId: string;
  memberId: string;
  period: MetricInputContext["period"];
  criterion: PipelineCriterion;
  provider: MetricInputProvider;
}): Promise<CriterionPipelineResult> {
  const { criterion } = input;
  if (criterion.method === "MANUAL") {
    return {
      criterionId: criterion.id,
      maxScore: criterion.maxScore,
      result: { status: "NOT_EVALUATED", reason: "Manual criterion requires human review." },
      confidence: "REVIEW_REQUIRED",
      metricValue: null,
      explanationTrace: { method: "MANUAL", reason: "Manual criterion requires human review." },
      evidence: [],
      qualityIssues: [],
    };
  }

  if (!criterion.metricConfiguration || !criterion.metricDefinition) {
    return {
      criterionId: criterion.id,
      maxScore: criterion.maxScore,
      result: { status: "NOT_EVALUATED", reason: "Metric configuration is missing." },
      confidence: "REVIEW_REQUIRED",
      metricValue: null,
      explanationTrace: { method: criterion.method, reason: "Metric configuration is missing." },
      evidence: [],
      qualityIssues: [{ code: "METRIC_CONFIGURATION_MISSING", affectedMetric: criterion.name, severity: "CRITICAL", message: "AUTO/ASSISTED criterion has no metric configuration." }],
    };
  }

  const bundle = await input.provider.collect({
    organizationId: input.organizationId,
    memberId: input.memberId,
    period: input.period,
    criterion: {
      id: criterion.id,
      name: criterion.name,
      method: criterion.method,
      requiredEvidence: criterion.requiredEvidence,
      evidenceSources: criterion.evidenceSources,
    },
    metricDefinition: criterion.metricDefinition,
    parameters: criterion.metricConfiguration.parameters,
  });

  const issues = [...bundle.qualityIssues];
  let confidence = bundle.confidence;
  if (criterion.requiredEvidence && bundle.evidence.length === 0) {
    issues.push({ code: "REQUIRED_EVIDENCE_MISSING", affectedMetric: criterion.metricDefinition.name, severity: "CRITICAL", message: "Required evidence is missing for this criterion." });
    confidence = "REVIEW_REQUIRED";
  }

  if (criterion.rules.length === 0) {
    issues.push({ code: "SCORING_RULE_MISSING", affectedMetric: criterion.metricDefinition.name, severity: "CRITICAL", message: "AUTO/ASSISTED criterion has no scoring rule." });
  }
  const hasCriticalIssue = issues.some((issue) => issue.severity === "CRITICAL");
  const scored = hasCriticalIssue
    ? { result: { status: "NOT_EVALUATED", reason: "Critical data-quality issues prevent system scoring." } as ScoreResult, rule: criterion.rules[0] ?? null, attempts: [] as Array<{ type: ScoringRule["type"]; result: ScoreResult }> }
    : scoreWithOrderedRules(bundle.metric, criterion.rules, criterion.maxScore);
  if (hasCriticalIssue || scored.result.status === "NOT_EVALUATED") confidence = "REVIEW_REQUIRED";

  const explanationTrace: ScoreExplanationTrace | Record<string, unknown> = scored.rule ? {
    input: bundle.inputFacts,
    metric: { label: criterion.metricDefinition.name, value: bundle.metric.value, variables: bundle.metric.variables },
    rule: { type: scored.rule.type, description: describeRule(scored.rule) },
    score: scored.result,
    confidence,
    evidence: bundle.evidence.map((item) => item.sourceRef ?? item.title),
    ruleAttempts: scored.attempts,
  } : {
    input: bundle.inputFacts,
    metric: { label: criterion.metricDefinition.name, value: bundle.metric.value, variables: bundle.metric.variables },
    score: scored.result,
    confidence,
    evidence: bundle.evidence.map((item) => item.sourceRef ?? item.title),
    ruleAttempts: scored.attempts,
  };

  return {
    criterionId: criterion.id,
    maxScore: criterion.maxScore,
    result: scored.result,
    confidence,
    metricValue: bundle.metric,
    explanationTrace,
    evidence: bundle.evidence,
    qualityIssues: issues,
  };
}

export function aggregateEvaluation(results: CriterionPipelineResult[]) {
  const scores: CriterionScore[] = results.map((row) => ({ criterionId: row.criterionId, maxScore: row.maxScore, result: row.result }));
  return {
    aggregate: aggregateKpi(scores, true),
    confidence: aggregateConfidence(results),
  };
}
