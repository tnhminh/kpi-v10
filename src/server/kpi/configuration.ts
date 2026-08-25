import { FormulaError, validateFormulaSyntax } from "@/domain/kpi/formula";
import type { ScoringRule } from "@/domain/kpi/types";

export class KpiConfigurationError extends Error {}

export interface CriterionConfigurationSnapshot {
  id: string;
  position: number;
  maxScore: number;
  method: "AUTO" | "ASSISTED" | "MANUAL";
  requiredEvidence: boolean;
  evidenceSources: readonly ("JIRA" | "MANUAL" | "CUSTOM")[];
  hasMetricConfiguration: boolean;
  rules: readonly ScoringRule[];
}

export interface VersionLifecycleSnapshot {
  status: "DRAFT" | "PUBLISHED" | "IN_USE" | "RETIRED";
  submittedAt: Date | null;
  approvedAt: Date | null;
  criteria: readonly CriterionConfigurationSnapshot[];
}

const EPSILON = 0.000001;

export function assertConfiguredKpiTotal(total: number): void {
  if (!Number.isFinite(total) || total < 0) throw new KpiConfigurationError("Configured KPI maximum must be a finite non-negative number.");
  if (total > 10 + EPSILON) throw new KpiConfigurationError(`Configured KPI maximum cannot exceed 10; current total is ${total}.`);
}

export function assertVersionConfigurationMutable(version: Pick<VersionLifecycleSnapshot, "status" | "submittedAt">): void {
  if (version.status !== "DRAFT") throw new KpiConfigurationError("Only a draft KPI version can be edited.");
  if (version.submittedAt) throw new KpiConfigurationError("A submitted KPI version is frozen. Clone a new draft to make changes.");
}

function assertScore(score: number, maxScore: number, label: string): void {
  if (!Number.isFinite(score) || score < 0 || score > maxScore) {
    throw new KpiConfigurationError(`${label} score must be within 0..criterion max score.`);
  }
}

export function assertRuleValidForCriterion(rule: ScoringRule, maxScore: number): void {
  if (!Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 10) throw new KpiConfigurationError("Criterion max score must be within (0, 10].");

  if (rule.type === "THRESHOLD") {
    if (rule.bands.length === 0) throw new KpiConfigurationError("Threshold scoring requires at least one band.");
    rule.bands.forEach((band) => {
      if (!Number.isFinite(band.value)) throw new KpiConfigurationError("Threshold values must be finite.");
      assertScore(band.score, maxScore, "Threshold band");
    });
    if (rule.fallback !== undefined && rule.fallback !== null) assertScore(rule.fallback, maxScore, "Threshold fallback");
    return;
  }

  if (rule.type === "RANGE") {
    if (rule.ranges.length === 0) throw new KpiConfigurationError("Range scoring requires at least one range.");
    rule.ranges.forEach((range) => {
      if (range.min !== undefined && !Number.isFinite(range.min)) throw new KpiConfigurationError("Range minimum must be finite.");
      if (range.max !== undefined && !Number.isFinite(range.max)) throw new KpiConfigurationError("Range maximum must be finite.");
      if (range.min !== undefined && range.max !== undefined && range.min > range.max) throw new KpiConfigurationError("Range minimum cannot exceed maximum.");
      assertScore(range.score, maxScore, "Range");
    });
    if (rule.fallback !== undefined && rule.fallback !== null) assertScore(rule.fallback, maxScore, "Range fallback");
    return;
  }

  if (rule.type === "FORMULA") {
    if (!rule.expression.trim()) throw new KpiConfigurationError("Formula expression cannot be empty.");
    try {
      validateFormulaSyntax(rule.expression);
    } catch (error) {
      if (error instanceof FormulaError) throw new KpiConfigurationError(`Formula syntax is invalid: ${error.message}`);
      throw error;
    }
    return;
  }

  if (rule.branches.length === 0) throw new KpiConfigurationError("Hybrid scoring requires at least one branch.");
  rule.branches.forEach((branch) => {
    if (branch.all.length === 0) throw new KpiConfigurationError("Hybrid branches require at least one condition.");
    branch.all.forEach((condition) => {
      if (!condition.field.trim() || !Number.isFinite(condition.value)) throw new KpiConfigurationError("Hybrid conditions require a field and finite value.");
    });
    assertScore(branch.score, maxScore, "Hybrid branch");
  });
  if (rule.fallback !== undefined && rule.fallback !== null) assertScore(rule.fallback, maxScore, "Hybrid fallback");
}

export function assertVersionReadyForSubmission(snapshot: VersionLifecycleSnapshot): void {
  if (snapshot.status !== "DRAFT") throw new KpiConfigurationError("Only a draft KPI version can be submitted.");
  if (snapshot.criteria.length === 0) throw new KpiConfigurationError("A KPI version must contain at least one criterion.");

  const positions = new Set<number>();
  let total = 0;
  for (const criterion of snapshot.criteria) {
    if (!Number.isInteger(criterion.position) || criterion.position < 0) throw new KpiConfigurationError("Criterion positions must be non-negative integers.");
    if (positions.has(criterion.position)) throw new KpiConfigurationError("Criterion positions must be unique.");
    positions.add(criterion.position);
    if (!Number.isFinite(criterion.maxScore) || criterion.maxScore <= 0 || criterion.maxScore > 10) throw new KpiConfigurationError("Criterion max score must be within (0, 10].");
    total += criterion.maxScore;

    if ((criterion.method === "AUTO" || criterion.method === "ASSISTED") && !criterion.hasMetricConfiguration) {
      throw new KpiConfigurationError(`${criterion.method} criteria require a metric configuration.`);
    }
    if ((criterion.method === "AUTO" || criterion.method === "ASSISTED") && criterion.rules.length === 0) {
      throw new KpiConfigurationError(`${criterion.method} criteria require at least one scoring rule.`);
    }
    criterion.rules.forEach((rule) => assertRuleValidForCriterion(rule, criterion.maxScore));
    if (criterion.requiredEvidence && criterion.evidenceSources.length === 0) {
      throw new KpiConfigurationError("Criteria requiring evidence must configure at least one evidence source.");
    }
  }

  assertConfiguredKpiTotal(total);
  if (Math.abs(total - 10) > EPSILON) throw new KpiConfigurationError(`KPI criterion maximums must total exactly 10; current total is ${total}.`);
}

export function assertLifecycleAction(snapshot: VersionLifecycleSnapshot, action: "SUBMIT" | "APPROVE" | "PUBLISH" | "RETIRE"): void {
  if (action === "SUBMIT") {
    if (snapshot.submittedAt) throw new KpiConfigurationError("KPI version has already been submitted.");
    assertVersionReadyForSubmission(snapshot);
    return;
  }
  if (action === "APPROVE") {
    if (snapshot.status !== "DRAFT" || !snapshot.submittedAt) throw new KpiConfigurationError("Only a submitted draft can be approved.");
    if (snapshot.approvedAt) throw new KpiConfigurationError("KPI version has already been approved.");
    assertVersionReadyForSubmission(snapshot);
    return;
  }
  if (action === "PUBLISH") {
    if (snapshot.status !== "DRAFT" || !snapshot.submittedAt || !snapshot.approvedAt) throw new KpiConfigurationError("KPI version must be submitted and approved before publishing.");
    assertVersionReadyForSubmission(snapshot);
    return;
  }
  if (snapshot.status !== "PUBLISHED" && snapshot.status !== "IN_USE") throw new KpiConfigurationError("Only a published or in-use KPI version can be retired.");
}
