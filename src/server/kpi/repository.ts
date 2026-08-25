import { and, asc, desc, eq, sql } from "drizzle-orm";
import { appendAuditEvent } from "@/server/audit/repository";
import type { ScoringRule } from "@/domain/kpi/types";
import { getDb } from "@/server/db/client";
import { mapUniqueViolation } from "@/server/db/errors";
import {
  criteria,
  kpiTemplates,
  kpiVersions,
  metricConfigurations,
  metricDefinitions,
  scoringRules,
} from "@/server/db/schema";
import { ApiError } from "@/server/http";
import {
  assertConfiguredKpiTotal,
  assertLifecycleAction,
  assertRuleValidForCriterion,
  assertVersionConfigurationMutable,
  KpiConfigurationError,
  type VersionLifecycleSnapshot,
} from "./configuration";
import { scoringRuleSchema } from "./validation";

function configurationConflict(error: unknown): never {
  if (error instanceof KpiConfigurationError) throw new ApiError(409, "KPI_CONFIGURATION_CONFLICT", error.message);
  throw error;
}

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function findCriterionVersionScope(tx: DbTransaction, organizationId: string, criterionId: string) {
  const rows = await tx.select({
    versionId: kpiVersions.id,
    status: kpiVersions.status,
    submittedAt: kpiVersions.submittedAt,
    maxScore: criteria.maxScore,
  }).from(criteria)
    .innerJoin(kpiVersions, eq(criteria.kpiVersionId, kpiVersions.id))
    .innerJoin(kpiTemplates, eq(kpiVersions.templateId, kpiTemplates.id))
    .where(and(eq(criteria.id, criterionId), eq(kpiTemplates.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

async function lockAndRefreshCriterionScope(tx: DbTransaction, organizationId: string, criterionId: string) {
  const initial = await findCriterionVersionScope(tx, organizationId, criterionId);
  if (!initial) throw new ApiError(404, "CRITERION_NOT_FOUND", "Criterion was not found in this organization.");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${initial.versionId}))`);
  const refreshed = await findCriterionVersionScope(tx, organizationId, criterionId);
  if (!refreshed) throw new ApiError(404, "CRITERION_NOT_FOUND", "Criterion was not found in this organization.");
  return refreshed;
}

async function recalculateVersionTotal(tx: DbTransaction, versionId: string) {
  const rows = await tx.select({ maxScore: criteria.maxScore }).from(criteria).where(eq(criteria.kpiVersionId, versionId));
  const total = rows.reduce((sum, row) => sum + Number(row.maxScore), 0);
  try {
    assertConfiguredKpiTotal(total);
  } catch (error) {
    if (error instanceof KpiConfigurationError) throw new ApiError(422, "KPI_MAX_EXCEEDED", error.message);
    throw error;
  }
  await tx.update(kpiVersions).set({ totalMaxScore: String(total), updatedAt: new Date() }).where(eq(kpiVersions.id, versionId));
  return total;
}

function deserializeRule(type: "THRESHOLD" | "RANGE" | "FORMULA" | "HYBRID", config: Record<string, unknown>): ScoringRule {
  const parsed = scoringRuleSchema.safeParse({ type, ...config });
  if (!parsed.success) throw new KpiConfigurationError("Stored scoring-rule configuration is invalid.");
  return parsed.data;
}

function serializeRule(rule: ScoringRule): Record<string, unknown> {
  const { type: _type, ...config } = rule;
  void _type;
  return config;
}

export async function listMetricDefinitions(organizationId: string) {
  return getDb().select({
    id: metricDefinitions.id,
    key: metricDefinitions.key,
    name: metricDefinitions.name,
    description: metricDefinitions.description,
    formulaKind: metricDefinitions.formulaKind,
    formula: metricDefinitions.formula,
    requiredFields: metricDefinitions.requiredFields,
    supportedIssueTypes: metricDefinitions.supportedIssueTypes,
    dataQualityRequirements: metricDefinitions.dataQualityRequirements,
    active: metricDefinitions.active,
  }).from(metricDefinitions)
    .where(eq(metricDefinitions.organizationId, organizationId))
    .orderBy(asc(metricDefinitions.name));
}

export async function createMetricDefinition(input: {
  organizationId: string;
  actorUserId: string;
  requestId?: string;
  key: string;
  name: string;
  description?: string | null;
  formulaKind: string;
  formula?: string | null;
  requiredFields: string[];
  supportedIssueTypes: string[];
  dataQualityRequirements: Record<string, unknown>;
}) {
  try {
    return await getDb().transaction(async (tx) => {
      const rows = await tx.insert(metricDefinitions).values({
        organizationId: input.organizationId,
        key: input.key.trim().toLowerCase(),
        name: input.name,
        description: input.description ?? null,
        formulaKind: input.formulaKind,
        formula: input.formula ?? null,
        requiredFields: input.requiredFields,
        supportedIssueTypes: input.supportedIssueTypes,
        dataQualityRequirements: input.dataQualityRequirements,
      }).returning();
      const created = rows[0];
      if (!created) throw new ApiError(500, "CREATE_FAILED", "Metric definition could not be created.");
      await appendAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        action: "METRIC_DEFINITION_CREATED",
        entityType: "metric_definition",
        entityId: created.id,
        after: { key: created.key, name: created.name, formulaKind: created.formulaKind, requiredFields: created.requiredFields, supportedIssueTypes: created.supportedIssueTypes, active: created.active },
      });
      return created;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    mapUniqueViolation(error, "A metric definition with this key already exists in the organization.");
  }
}

export async function listKpiVersions(organizationId: string, templateId: string) {
  const template = await getDb().select({ id: kpiTemplates.id }).from(kpiTemplates)
    .where(and(eq(kpiTemplates.id, templateId), eq(kpiTemplates.organizationId, organizationId))).limit(1);
  if (!template[0]) throw new ApiError(404, "KPI_TEMPLATE_NOT_FOUND", "KPI template was not found in this organization.");
  return getDb().select({
    id: kpiVersions.id,
    version: kpiVersions.version,
    status: kpiVersions.status,
    totalMaxScore: kpiVersions.totalMaxScore,
    submittedAt: kpiVersions.submittedAt,
    approvedAt: kpiVersions.approvedAt,
    publishedAt: kpiVersions.publishedAt,
    retiredAt: kpiVersions.retiredAt,
    createdAt: kpiVersions.createdAt,
  }).from(kpiVersions).where(eq(kpiVersions.templateId, templateId)).orderBy(desc(kpiVersions.version));
}

export async function createKpiVersion(input: { organizationId: string; templateId: string; actorUserId: string; requestId?: string; sourceVersionId?: string | null }) {
  try {
    return await getDb().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.templateId}))`);
      const template = await tx.select({ id: kpiTemplates.id }).from(kpiTemplates)
        .where(and(eq(kpiTemplates.id, input.templateId), eq(kpiTemplates.organizationId, input.organizationId))).limit(1);
      if (!template[0]) throw new ApiError(404, "KPI_TEMPLATE_NOT_FOUND", "KPI template was not found in this organization.");

      const existing = await tx.select({ id: kpiVersions.id, version: kpiVersions.version, totalMaxScore: kpiVersions.totalMaxScore })
        .from(kpiVersions).where(eq(kpiVersions.templateId, input.templateId)).orderBy(desc(kpiVersions.version));
      const nextVersion = (existing[0]?.version ?? 0) + 1;
      const sourceVersionId = input.sourceVersionId ?? existing[0]?.id ?? null;
      let sourceTotal = "0";
      if (sourceVersionId) {
        const source = existing.find((row) => row.id === sourceVersionId);
        if (!source) throw new ApiError(422, "INVALID_SOURCE_VERSION", "Source KPI version must belong to the selected template.");
        sourceTotal = source.totalMaxScore;
      }

      const createdRows = await tx.insert(kpiVersions).values({
        templateId: input.templateId,
        version: nextVersion,
        status: "DRAFT",
        totalMaxScore: sourceTotal,
        createdBy: input.actorUserId,
      }).returning();
      const created = createdRows[0];
      if (!created) throw new ApiError(500, "CREATE_FAILED", "KPI version could not be created.");

      if (sourceVersionId) {
        const sourceCriteria = await tx.select().from(criteria).where(eq(criteria.kpiVersionId, sourceVersionId)).orderBy(asc(criteria.position));
        for (const sourceCriterion of sourceCriteria) {
          const inserted = await tx.insert(criteria).values({
            kpiVersionId: created.id,
            name: sourceCriterion.name,
            description: sourceCriterion.description,
            position: sourceCriterion.position,
            maxScore: sourceCriterion.maxScore,
            method: sourceCriterion.method,
            evidencePolicy: sourceCriterion.evidencePolicy,
            reviewRequired: sourceCriterion.reviewRequired,
            requiredEvidence: sourceCriterion.requiredEvidence,
            adjustmentPolicy: sourceCriterion.adjustmentPolicy,
          }).returning({ id: criteria.id });
          const newCriterion = inserted[0];
          if (!newCriterion) throw new ApiError(500, "CLONE_FAILED", "Criterion could not be cloned.");

          const metric = await tx.select().from(metricConfigurations).where(eq(metricConfigurations.criterionId, sourceCriterion.id)).limit(1);
          if (metric[0]) await tx.insert(metricConfigurations).values({
            criterionId: newCriterion.id,
            metricDefinitionId: metric[0].metricDefinitionId,
            parameters: metric[0].parameters,
          });

          const rules = await tx.select().from(scoringRules).where(eq(scoringRules.criterionId, sourceCriterion.id)).orderBy(asc(scoringRules.position));
          if (rules.length) await tx.insert(scoringRules).values(rules.map((rule) => ({
            criterionId: newCriterion.id,
            type: rule.type,
            position: rule.position,
            config: rule.config,
          })));
        }
      }
      await appendAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        action: "KPI_VERSION_CREATED",
        entityType: "kpi_version",
        entityId: created.id,
        after: { templateId: input.templateId, version: created.version, status: created.status, sourceVersionId },
      });
      return created;
    });
  } catch (error) {
    mapUniqueViolation(error, "A conflicting KPI version or cloned criterion already exists.");
  }
}

export async function getKpiVersionDetail(organizationId: string, versionId: string) {
  const versionRows = await getDb().select({
    id: kpiVersions.id,
    templateId: kpiTemplates.id,
    templateName: kpiTemplates.name,
    version: kpiVersions.version,
    status: kpiVersions.status,
    totalMaxScore: kpiVersions.totalMaxScore,
    submittedAt: kpiVersions.submittedAt,
    approvedAt: kpiVersions.approvedAt,
    publishedAt: kpiVersions.publishedAt,
    retiredAt: kpiVersions.retiredAt,
  }).from(kpiVersions).innerJoin(kpiTemplates, eq(kpiVersions.templateId, kpiTemplates.id))
    .where(and(eq(kpiVersions.id, versionId), eq(kpiTemplates.organizationId, organizationId))).limit(1);
  const version = versionRows[0];
  if (!version) throw new ApiError(404, "KPI_VERSION_NOT_FOUND", "KPI version was not found in this organization.");

  const criterionRows = await getDb().select().from(criteria).where(eq(criteria.kpiVersionId, versionId)).orderBy(asc(criteria.position));
  const result = [];
  for (const criterion of criterionRows) {
    const metric = await getDb().select({
      id: metricConfigurations.id,
      metricDefinitionId: metricConfigurations.metricDefinitionId,
      metricKey: metricDefinitions.key,
      metricName: metricDefinitions.name,
      parameters: metricConfigurations.parameters,
    }).from(metricConfigurations)
      .innerJoin(metricDefinitions, eq(metricConfigurations.metricDefinitionId, metricDefinitions.id))
      .where(eq(metricConfigurations.criterionId, criterion.id)).limit(1);
    const ruleRows = await getDb().select().from(scoringRules).where(eq(scoringRules.criterionId, criterion.id)).orderBy(asc(scoringRules.position));
    result.push({
      ...criterion,
      metricConfiguration: metric[0] ?? null,
      rules: ruleRows.map((row) => ({ id: row.id, position: row.position, ...deserializeRule(row.type, row.config) })),
    });
  }
  return { ...version, criteria: result };
}

export async function addCriterion(input: {
  organizationId: string;
  versionId: string;
  actorUserId: string;
  requestId?: string;
  name: string;
  description?: string | null;
  position: number;
  maxScore: number;
  method: "AUTO" | "ASSISTED" | "MANUAL";
  evidencePolicy: { sources: ("JIRA" | "MANUAL" | "CUSTOM")[]; config?: Record<string, unknown> };
  reviewRequired: boolean;
  requiredEvidence: boolean;
  adjustmentPolicy: Record<string, unknown>;
}) {
  try {
    return await getDb().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.versionId}))`);
      const scope = await tx.select({ status: kpiVersions.status, submittedAt: kpiVersions.submittedAt }).from(kpiVersions)
        .innerJoin(kpiTemplates, eq(kpiVersions.templateId, kpiTemplates.id))
        .where(and(eq(kpiVersions.id, input.versionId), eq(kpiTemplates.organizationId, input.organizationId))).limit(1);
      if (!scope[0]) throw new ApiError(404, "KPI_VERSION_NOT_FOUND", "KPI version was not found in this organization.");
      try { assertVersionConfigurationMutable(scope[0]); } catch (error) { configurationConflict(error); }

      const rows = await tx.insert(criteria).values({
        kpiVersionId: input.versionId,
        name: input.name,
        description: input.description ?? null,
        position: input.position,
        maxScore: String(input.maxScore),
        method: input.method,
        evidencePolicy: input.evidencePolicy,
        reviewRequired: input.reviewRequired,
        requiredEvidence: input.requiredEvidence,
        adjustmentPolicy: input.adjustmentPolicy,
      }).returning();
      const created = rows[0];
      if (!created) throw new ApiError(500, "CREATE_FAILED", "Criterion could not be created.");
      const totalMaxScore = await recalculateVersionTotal(tx, input.versionId);
      await appendAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        action: "KPI_CRITERION_CREATED",
        entityType: "criterion",
        entityId: created.id,
        after: { versionId: input.versionId, name: created.name, position: created.position, maxScore: created.maxScore, method: created.method, totalMaxScore },
      });
      return created;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    mapUniqueViolation(error, "Criterion name or position conflicts with another criterion in this KPI version.");
  }
}

export async function updateCriterion(input: {
  organizationId: string;
  criterionId: string;
  actorUserId: string;
  requestId?: string;
  patch: Partial<{
    name: string; description: string | null; position: number; maxScore: number; method: "AUTO" | "ASSISTED" | "MANUAL";
    evidencePolicy: { sources: ("JIRA" | "MANUAL" | "CUSTOM")[]; config?: Record<string, unknown> };
    reviewRequired: boolean; requiredEvidence: boolean; adjustmentPolicy: Record<string, unknown>;
  }>;
}) {
  try {
    return await getDb().transaction(async (tx) => {
      const scope = await lockAndRefreshCriterionScope(tx, input.organizationId, input.criterionId);
      try { assertVersionConfigurationMutable(scope); } catch (error) { configurationConflict(error); }
      const beforeRows = await tx.select({
        name: criteria.name,
        description: criteria.description,
        position: criteria.position,
        maxScore: criteria.maxScore,
        method: criteria.method,
        evidencePolicy: criteria.evidencePolicy,
        reviewRequired: criteria.reviewRequired,
        requiredEvidence: criteria.requiredEvidence,
        adjustmentPolicy: criteria.adjustmentPolicy,
      }).from(criteria).where(eq(criteria.id, input.criterionId)).limit(1);
      const before = beforeRows[0];
      if (!before) throw new ApiError(404, "CRITERION_NOT_FOUND", "Criterion was not found in this organization.");
      const values: Record<string, unknown> = { ...input.patch, updatedAt: new Date() };
      if (input.patch.maxScore !== undefined) values.maxScore = String(input.patch.maxScore);
      const rows = await tx.update(criteria).set(values).where(eq(criteria.id, input.criterionId)).returning();
      const updated = rows[0];
      if (!updated) throw new ApiError(500, "UPDATE_FAILED", "Criterion could not be updated.");
      const totalMaxScore = await recalculateVersionTotal(tx, scope.versionId);
      await appendAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        action: "KPI_CRITERION_UPDATED",
        entityType: "criterion",
        entityId: input.criterionId,
        before,
        after: { name: updated.name, description: updated.description, position: updated.position, maxScore: updated.maxScore, method: updated.method, evidencePolicy: updated.evidencePolicy, reviewRequired: updated.reviewRequired, requiredEvidence: updated.requiredEvidence, adjustmentPolicy: updated.adjustmentPolicy, totalMaxScore },
      });
      return updated;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    mapUniqueViolation(error, "Criterion name or position conflicts with another criterion in this KPI version.");
  }
}

export async function deleteCriterion(input: { organizationId: string; criterionId: string; actorUserId: string; requestId?: string }) {
  return getDb().transaction(async (tx) => {
    const scope = await lockAndRefreshCriterionScope(tx, input.organizationId, input.criterionId);
    try { assertVersionConfigurationMutable(scope); } catch (error) { configurationConflict(error); }
    const beforeRows = await tx.select({
      name: criteria.name,
      position: criteria.position,
      maxScore: criteria.maxScore,
      method: criteria.method,
    }).from(criteria).where(eq(criteria.id, input.criterionId)).limit(1);
    const before = beforeRows[0];
    if (!before) throw new ApiError(404, "CRITERION_NOT_FOUND", "Criterion was not found in this organization.");
    await tx.delete(criteria).where(eq(criteria.id, input.criterionId));
    const totalMaxScore = await recalculateVersionTotal(tx, scope.versionId);
    await appendAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: "KPI_CRITERION_DELETED",
      entityType: "criterion",
      entityId: input.criterionId,
      before: { ...before, versionId: scope.versionId },
      after: { deleted: true, totalMaxScore },
    });
    return { deleted: true };
  });
}

export async function setCriterionMetricConfiguration(input: { organizationId: string; criterionId: string; actorUserId: string; requestId?: string; metricDefinitionId: string; parameters: Record<string, unknown> }) {
  return getDb().transaction(async (tx) => {
    const scope = await lockAndRefreshCriterionScope(tx, input.organizationId, input.criterionId);
    try { assertVersionConfigurationMutable(scope); } catch (error) { configurationConflict(error); }

    const metric = await tx.select({ id: metricDefinitions.id }).from(metricDefinitions)
      .where(and(eq(metricDefinitions.id, input.metricDefinitionId), eq(metricDefinitions.organizationId, input.organizationId), eq(metricDefinitions.active, true))).limit(1);
    if (!metric[0]) throw new ApiError(422, "INVALID_METRIC_DEFINITION", "Metric definition must be active and belong to this organization.");

    const existing = await tx.select({ id: metricConfigurations.id, metricDefinitionId: metricConfigurations.metricDefinitionId, parameters: metricConfigurations.parameters })
      .from(metricConfigurations).where(eq(metricConfigurations.criterionId, input.criterionId)).limit(1);
    const rows = existing[0]
      ? await tx.update(metricConfigurations).set({ metricDefinitionId: input.metricDefinitionId, parameters: input.parameters, updatedAt: new Date() })
        .where(eq(metricConfigurations.id, existing[0].id)).returning()
      : await tx.insert(metricConfigurations).values({ criterionId: input.criterionId, metricDefinitionId: input.metricDefinitionId, parameters: input.parameters }).returning();
    const updated = rows[0];
    if (!updated) throw new ApiError(500, "METRIC_CONFIGURATION_PERSIST_FAILED", "Metric configuration could not be persisted.");
    await appendAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: "KPI_CRITERION_METRIC_SET",
      entityType: "criterion",
      entityId: input.criterionId,
      before: existing[0] ? { metricDefinitionId: existing[0].metricDefinitionId, parameters: existing[0].parameters } : null,
      after: { metricDefinitionId: updated.metricDefinitionId, parameters: updated.parameters, versionId: scope.versionId },
    });
    return updated;
  });
}

export async function replaceCriterionScoringRules(input: { organizationId: string; criterionId: string; actorUserId: string; requestId?: string; rules: ScoringRule[] }) {
  return getDb().transaction(async (tx) => {
    const scope = await lockAndRefreshCriterionScope(tx, input.organizationId, input.criterionId);
    try { assertVersionConfigurationMutable(scope); } catch (error) { configurationConflict(error); }
    try { input.rules.forEach((rule) => assertRuleValidForCriterion(rule, Number(scope.maxScore))); }
    catch (error) {
      if (error instanceof KpiConfigurationError) throw new ApiError(422, "INVALID_SCORING_RULE", error.message);
      throw error;
    }
    const beforeRows = await tx.select({ id: scoringRules.id, type: scoringRules.type, position: scoringRules.position, config: scoringRules.config })
      .from(scoringRules).where(eq(scoringRules.criterionId, input.criterionId)).orderBy(asc(scoringRules.position));
    await tx.delete(scoringRules).where(eq(scoringRules.criterionId, input.criterionId));
    const rows = await tx.insert(scoringRules).values(input.rules.map((rule, position) => ({
      criterionId: input.criterionId,
      type: rule.type,
      position,
      config: serializeRule(rule),
    }))).returning();
    const result = rows.map((row) => ({ id: row.id, position: row.position, ...deserializeRule(row.type, row.config) }));
    await appendAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: "KPI_CRITERION_SCORING_RULES_REPLACED",
      entityType: "criterion",
      entityId: input.criterionId,
      before: { rules: beforeRows.map((row) => ({ id: row.id, type: row.type, position: row.position, config: row.config })) },
      after: { rules: result, versionId: scope.versionId },
    });
    return result;
  });
}

async function lifecycleSnapshot(tx: DbTransaction, organizationId: string, versionId: string): Promise<VersionLifecycleSnapshot> {
  const versionRows = await tx.select({ status: kpiVersions.status, submittedAt: kpiVersions.submittedAt, approvedAt: kpiVersions.approvedAt })
    .from(kpiVersions).innerJoin(kpiTemplates, eq(kpiVersions.templateId, kpiTemplates.id))
    .where(and(eq(kpiVersions.id, versionId), eq(kpiTemplates.organizationId, organizationId))).limit(1);
  const version = versionRows[0];
  if (!version) throw new ApiError(404, "KPI_VERSION_NOT_FOUND", "KPI version was not found in this organization.");
  const criterionRows = await tx.select().from(criteria).where(eq(criteria.kpiVersionId, versionId)).orderBy(asc(criteria.position));
  const snapshots = [];
  for (const criterion of criterionRows) {
    const metric = await tx.select({ id: metricConfigurations.id }).from(metricConfigurations).where(eq(metricConfigurations.criterionId, criterion.id)).limit(1);
    const ruleRows = await tx.select().from(scoringRules).where(eq(scoringRules.criterionId, criterion.id)).orderBy(asc(scoringRules.position));
    snapshots.push({
      id: criterion.id,
      position: criterion.position,
      maxScore: Number(criterion.maxScore),
      method: criterion.method,
      requiredEvidence: criterion.requiredEvidence,
      evidenceSources: criterion.evidencePolicy.sources,
      hasMetricConfiguration: Boolean(metric[0]),
      rules: ruleRows.map((row) => deserializeRule(row.type, row.config)),
    });
  }
  return { ...version, criteria: snapshots };
}

export async function transitionKpiVersion(input: { organizationId: string; versionId: string; actorUserId: string; requestId?: string; action: "SUBMIT" | "APPROVE" | "PUBLISH" | "RETIRE" }) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.versionId}))`);
    let snapshot: VersionLifecycleSnapshot;
    try {
      snapshot = await lifecycleSnapshot(tx, input.organizationId, input.versionId);
      assertLifecycleAction(snapshot, input.action);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      configurationConflict(error);
    }
    const now = new Date();
    const patch = input.action === "SUBMIT"
      ? { submittedAt: now, updatedAt: now }
      : input.action === "APPROVE"
        ? { approvedAt: now, approvedBy: input.actorUserId, updatedAt: now }
        : input.action === "PUBLISH"
          ? { status: "PUBLISHED" as const, publishedAt: now, updatedAt: now }
          : { status: "RETIRED" as const, retiredAt: now, updatedAt: now };
    const rows = await tx.update(kpiVersions).set(patch).where(eq(kpiVersions.id, input.versionId)).returning();
    const updated = rows[0];
    if (!updated) throw new ApiError(500, "KPI_LIFECYCLE_PERSIST_FAILED", "KPI lifecycle transition could not be persisted.");
    await appendAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: `KPI_VERSION_${input.action}`,
      entityType: "kpi_version",
      entityId: input.versionId,
      before: { status: snapshot.status, submittedAt: snapshot.submittedAt, approvedAt: snapshot.approvedAt },
      after: { status: updated.status, submittedAt: updated.submittedAt, approvedAt: updated.approvedAt, publishedAt: updated.publishedAt, retiredAt: updated.retiredAt },
      metadata: { templateId: updated.templateId, version: updated.version },
    });
    return updated;
  });
}
