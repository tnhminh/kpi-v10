import type {
  EvaluationEvidenceInput,
  EvaluationQualityIssueInput,
  MetricInputBundle,
  MetricInputContext,
  MetricInputProvider,
} from "@/server/evaluation/pipeline";

export interface JiraEvaluationFact {
  jiraIssueId: string;
  issueKey: string;
  summary: string;
  workspaceUrl: string;
  facts: Record<string, unknown>;
  attribution: Record<string, unknown>;
  sourceUpdatedAt: Date | string | null;
  issueCreatedAt?: string | null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function dateInPeriod(value: string | Date | null | undefined, startsOn: string, endsOn: string): boolean {
  if (!value) return false;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const start = Date.parse(`${startsOn}T00:00:00.000Z`);
  const end = Date.parse(`${endsOn}T23:59:59.999Z`);
  return parsed >= start && parsed <= end;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function configuredIssueTypes(context: MetricInputContext): string[] {
  const parameterTypes = Array.isArray(context.parameters.issueTypes)
    ? context.parameters.issueTypes.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  if (parameterTypes.length) return parameterTypes;
  if (context.metricDefinition.supportedIssueTypes?.length) return context.metricDefinition.supportedIssueTypes;
  switch (context.metricDefinition.key) {
    case "on_time_completion_rate": return ["Story", "Task", "Bug"];
    case "reopen_rate": return ["Bug"];
    case "resolution_time_minutes": return ["Incident"];
    default: return [];
  }
}

function issueType(row: JiraEvaluationFact): string | null {
  return stringValue(row.facts.issueType);
}

function evidenceFor(row: JiraEvaluationFact, metricKey: string): EvaluationEvidenceInput {
  return {
    type: "JIRA",
    sourceRef: `${row.workspaceUrl}#${row.issueKey}`,
    title: `${row.issueKey} · ${row.summary}`,
    payload: {
      jiraIssueId: row.jiraIssueId,
      issueKey: row.issueKey,
      workspaceUrl: row.workspaceUrl,
      metricKey,
      sourceUpdatedAt: row.sourceUpdatedAt instanceof Date ? row.sourceUpdatedAt.toISOString() : row.sourceUpdatedAt,
    },
  };
}

function completeFieldsRequired(context: MetricInputContext): boolean {
  return context.metricDefinition.dataQualityRequirements.requireCompleteFields === true;
}

function confidenceFor(missing: number, total: number): "HIGH" | "MEDIUM" | "LOW" | "REVIEW_REQUIRED" {
  if (total <= 0) return "REVIEW_REQUIRED";
  if (missing === 0) return "HIGH";
  const coverage = (total - missing) / total;
  if (coverage >= 0.9) return "MEDIUM";
  if (coverage >= 0.7) return "LOW";
  return "REVIEW_REQUIRED";
}

export class JiraMetricInputProvider implements MetricInputProvider {
  private readonly usedIssueIds = new Set<string>();

  constructor(
    private readonly rows: JiraEvaluationFact[],
    private readonly frozenSnapshot = false,
  ) {}

  contributingIssueIds(): string[] {
    return [...this.usedIssueIds];
  }

  contributingFacts(): JiraEvaluationFact[] {
    return this.rows.filter((row) => this.usedIssueIds.has(row.jiraIssueId));
  }

  private periodRows(context: MetricInputContext): JiraEvaluationFact[] {
    if (this.frozenSnapshot) return this.rows;
    return this.rows.filter((row) => {
      if (row.issueCreatedAt && dateInPeriod(row.issueCreatedAt, context.period.startsOn, context.period.endsOn)) return true;
      const updated = stringValue(row.facts.updatedAt) ?? row.sourceUpdatedAt;
      return dateInPeriod(updated, context.period.startsOn, context.period.endsOn);
    });
  }

  private eligibleRows(context: MetricInputContext): JiraEvaluationFact[] {
    const types = configuredIssueTypes(context).map((value) => value.toLowerCase());
    const rows = this.periodRows(context);
    if (!types.length) return rows;
    return rows.filter((row) => {
      const value = issueType(row);
      return value ? types.includes(value.toLowerCase()) : false;
    });
  }

  private finalize(context: MetricInputContext, rows: JiraEvaluationFact[], inputFacts: Record<string, number | string | boolean | null>, metricValue: number | null, missing: number, issues: EvaluationQualityIssueInput[]): MetricInputBundle {
    rows.forEach((row) => this.usedIssueIds.add(row.jiraIssueId));
    if (!rows.length) {
      issues.push({
        code: "JIRA_PERIOD_FACTS_MISSING",
        affectedMetric: context.metricDefinition.name,
        severity: "CRITICAL",
        message: `No Jira facts are available for '${context.metricDefinition.name}' in period ${context.period.key}.`,
      });
    }
    if (completeFieldsRequired(context) && missing > 0) {
      issues.push({
        code: "JIRA_REQUIRED_FACTS_INCOMPLETE",
        affectedMetric: context.metricDefinition.name,
        severity: "CRITICAL",
        message: `${missing} Jira observation(s) required by '${context.metricDefinition.name}' are incomplete.`,
      });
    }
    return {
      inputFacts,
      metric: { value: metricValue },
      confidence: issues.some((issue) => issue.severity === "CRITICAL") ? "REVIEW_REQUIRED" : confidenceFor(missing, rows.length),
      evidence: rows.map((row) => evidenceFor(row, context.metricDefinition.key)),
      qualityIssues: issues,
    };
  }

  async collect(context: MetricInputContext): Promise<MetricInputBundle> {
    const rows = this.eligibleRows(context);
    const issues: EvaluationQualityIssueInput[] = [];

    switch (context.metricDefinition.key) {
      case "on_time_completion_rate": {
        const committedRows = rows.filter((row) => finiteNumber(row.facts.committed) === 1);
        const observed = committedRows.map((row) => finiteNumber(row.facts.completedOnTime)).filter((value): value is number => value !== null);
        const completedOnTime = observed.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0);
        const missing = committedRows.length - observed.length;
        const value = observed.length ? completedOnTime / observed.length * 100 : null;
        return this.finalize(context, committedRows, {
          committed: committedRows.length,
          completedOnTime,
          completionObservations: observed.length,
          missingCompletionDates: missing,
        }, value, missing, issues);
      }
      case "reopen_rate": {
        const resolvedRows = rows.filter((row) => finiteNumber(row.facts.completed) === 1);
        const reopenValues = resolvedRows.map((row) => finiteNumber(row.facts.reopened));
        const observed = reopenValues.filter((value): value is number => value !== null);
        const reopened = observed.reduce((sum, value) => sum + Math.max(0, value), 0);
        const missing = resolvedRows.length - observed.length;
        const value = resolvedRows.length && observed.length ? reopened / resolvedRows.length * 100 : null;
        return this.finalize(context, resolvedRows, {
          resolved: resolvedRows.length,
          reopened,
          reopenObservations: observed.length,
          missingReopenFacts: missing,
        }, value, missing, issues);
      }
      case "resolution_time_minutes": {
        const durations = rows.map((row) => finiteNumber(row.facts.resolutionMinutes));
        const observed = durations.filter((value): value is number => value !== null && value >= 0);
        const missing = rows.length - observed.length;
        const value = median(observed);
        return this.finalize(context, rows, {
          incidentCount: rows.length,
          resolutionObservations: observed.length,
          missingResolutionMinutes: missing,
          periodStartsOn: context.period.startsOn,
          periodEndsOn: context.period.endsOn,
        }, value, missing, issues);
      }
      case "proactive_detection_count": {
        const values = rows.map((row) => finiteNumber(row.facts.detections));
        const observed = values.filter((value): value is number => value !== null);
        const missing = rows.length - observed.length;
        const detections = observed.reduce((sum, value) => sum + Math.max(0, value), 0);
        return this.finalize(context, rows, {
          detections,
          detectionObservations: observed.length,
          missingDetectionFacts: missing,
        }, rows.length ? detections : null, missing, issues);
      }
      default:
        return {
          inputFacts: {},
          metric: { value: null },
          confidence: "REVIEW_REQUIRED",
          evidence: [],
          qualityIssues: [{
            code: "JIRA_METRIC_UNSUPPORTED",
            affectedMetric: context.metricDefinition.name,
            severity: "CRITICAL",
            message: `Metric '${context.metricDefinition.key}' has no Jira aggregation strategy configured.`,
          }],
        };
    }
  }
}
