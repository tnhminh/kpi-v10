import { evaluateFormula, FormulaError } from "@/domain/kpi/formula";
import type { Confidence, MetricValue } from "@/domain/kpi/types";
import type {
  EvaluationEvidenceInput,
  EvaluationQualityIssueInput,
  MetricInputBundle,
  MetricInputContext,
  MetricInputProvider,
} from "./pipeline";

export interface CollectedCriterionPayload {
  criterionId: string;
  inputFacts?: Record<string, number | string | boolean | null>;
  metric?: MetricValue;
  confidence?: Confidence;
  evidence?: EvaluationEvidenceInput[];
}

export class CollectedInputError extends Error {}

export class CollectedMetricInputProvider implements MetricInputProvider {
  private readonly inputs: Map<string, CollectedCriterionPayload>;

  constructor(inputs: CollectedCriterionPayload[]) {
    this.inputs = new Map();
    for (const input of inputs) {
      if (this.inputs.has(input.criterionId)) throw new CollectedInputError(`Duplicate collected input for criterion '${input.criterionId}'.`);
      this.inputs.set(input.criterionId, input);
    }
  }

  criterionIds(): string[] {
    return [...this.inputs.keys()];
  }

  async collect(context: MetricInputContext): Promise<MetricInputBundle> {
    const input = this.inputs.get(context.criterion.id) ?? { criterionId: context.criterion.id };
    const inputFacts = input.inputFacts ?? {};
    const evidence = input.evidence ?? [];
    const qualityIssues: EvaluationQualityIssueInput[] = [];

    for (const item of evidence) {
      if (!context.criterion.evidenceSources.includes(item.type)) {
        throw new CollectedInputError(`Evidence source '${item.type}' is not configured for criterion '${context.criterion.id}'.`);
      }
    }

    for (const field of context.metricDefinition.requiredFields) {
      if (!(field in inputFacts) || inputFacts[field] === null) {
        qualityIssues.push({
          code: "REQUIRED_METRIC_FIELD_MISSING",
          missingField: field,
          affectedMetric: context.metricDefinition.name,
          severity: "CRITICAL",
          message: `Required field '${field}' is missing for metric '${context.metricDefinition.name}'.`,
        });
      }
    }

    let metric = input.metric ?? { value: null };
    if (context.metricDefinition.formulaKind === "CUSTOM_FORMULA") {
      const expression = context.metricDefinition.formula?.trim();
      if (!expression) {
        qualityIssues.push({
          code: "METRIC_FORMULA_MISSING",
          affectedMetric: context.metricDefinition.name,
          severity: "CRITICAL",
          message: `Custom metric '${context.metricDefinition.name}' has no formula.`,
        });
        metric = { value: null, variables: input.metric?.variables };
      } else {
        const variables: Record<string, number> = {};
        for (const [key, value] of Object.entries(inputFacts)) if (typeof value === "number" && Number.isFinite(value)) variables[key] = value;
        for (const [key, value] of Object.entries(context.parameters)) if (typeof value === "number" && Number.isFinite(value)) variables[key] = value;
        for (const [key, value] of Object.entries(input.metric?.variables ?? {})) if (typeof value === "number" && Number.isFinite(value)) variables[key] = value;
        try {
          metric = { value: evaluateFormula(expression, variables), variables: input.metric?.variables };
        } catch (error) {
          if (!(error instanceof FormulaError)) throw error;
          qualityIssues.push({
            code: "METRIC_FORMULA_NOT_EVALUATED",
            affectedMetric: context.metricDefinition.name,
            severity: "CRITICAL",
            message: error.message,
          });
          metric = { value: null, variables: input.metric?.variables };
        }
      }
    }

    if (metric.value === null && !qualityIssues.some((issue) => issue.code === "METRIC_FORMULA_MISSING" || issue.code === "METRIC_FORMULA_NOT_EVALUATED")) {
      qualityIssues.push({
        code: "METRIC_VALUE_MISSING",
        affectedMetric: context.metricDefinition.name,
        severity: "CRITICAL",
        message: `Metric '${context.metricDefinition.name}' has no collected value.`,
      });
    }

    return {
      inputFacts,
      metric,
      confidence: input.confidence ?? "REVIEW_REQUIRED",
      evidence,
      qualityIssues,
    };
  }
}
