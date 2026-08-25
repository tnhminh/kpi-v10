import { and, asc, eq, sql } from "drizzle-orm";
import { appendAuditEvent } from "@/server/audit/repository";
import { resolveEvaluationConfiguration, ResolutionError } from "@/domain/kpi/resolution";
import { recalculationPolicy } from "@/domain/kpi/lifecycle";
import type { EffectiveMembership, KpiAssignment, ScoringRule } from "@/domain/kpi/types";
import { getDb } from "@/server/db/client";
import { mapUniqueViolation } from "@/server/db/errors";
import {
  criteria,
  criterionEvaluations,
  dataQualityIssues,
  departments,
  evaluationPeriods,
  evidence,
  jiraConnections,
  jiraFactSnapshots,
  jiraIssueFacts,
  jiraIssues,
  kpiTemplates,
  kpiVersions,
  memberEvaluations,
  members,
  metricConfigurations,
  metricDefinitions,
  periodKpiAssignments,
  rankSchemes,
  scoringRules,
  teamMemberships,
  teams,
} from "@/server/db/schema";
import { ApiError } from "@/server/http";
import { scoringRuleSchema } from "@/server/kpi/validation";
import { CollectedInputError, CollectedMetricInputProvider, type CollectedCriterionPayload } from "./collected-provider";
import { JiraMetricInputProvider, type JiraEvaluationFact } from "@/server/jira/evaluation-provider";
import { aggregateEvaluation, evaluateCriterion, type MetricInputProvider, type PipelineCriterion } from "./pipeline";

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

function evaluationConflict(error: unknown): never {
  if (error instanceof CollectedInputError) throw new ApiError(422, "INVALID_EVALUATION_INPUT", error.message);
  if (error instanceof ResolutionError) throw new ApiError(409, "EVALUATION_CONFIGURATION_CONFLICT", error.message);
  throw error;
}

function deserializeRule(type: "THRESHOLD" | "RANGE" | "FORMULA" | "HYBRID", config: Record<string, unknown>): ScoringRule {
  const parsed = scoringRuleSchema.safeParse({ type, ...config });
  if (!parsed.success) throw new ApiError(409, "EVALUATION_CONFIGURATION_CONFLICT", "Stored scoring-rule configuration is invalid.");
  return parsed.data;
}

function assertMetricFormulaKind(value: string): "COUNT" | "RATIO" | "DURATION" | "CUSTOM_FORMULA" {
  if (value === "COUNT" || value === "RATIO" || value === "DURATION" || value === "CUSTOM_FORMULA") return value;
  throw new ApiError(409, "EVALUATION_CONFIGURATION_CONFLICT", `Stored metric formula kind '${value}' is invalid.`);
}

async function periodScope(tx: DbTransaction, organizationId: string, periodId: string) {
  const rows = await tx.select({
    id: evaluationPeriods.id,
    key: evaluationPeriods.key,
    startsOn: evaluationPeriods.startsOn,
    endsOn: evaluationPeriods.endsOn,
    status: evaluationPeriods.status,
    rankSchemeId: evaluationPeriods.rankSchemeId,
    lockedAt: evaluationPeriods.lockedAt,
  }).from(evaluationPeriods)
    .where(and(eq(evaluationPeriods.id, periodId), eq(evaluationPeriods.organizationId, organizationId)))
    .limit(1);
  if (!rows[0]) throw new ApiError(404, "EVALUATION_PERIOD_NOT_FOUND", "Evaluation period was not found in this organization.");
  return rows[0];
}

async function loadRuntimeKpi(tx: DbTransaction, organizationId: string, versionId: string): Promise<{ versionId: string; criteria: PipelineCriterion[] }> {
  const versionRows = await tx.select({ id: kpiVersions.id, status: kpiVersions.status })
    .from(kpiVersions)
    .innerJoin(kpiTemplates, eq(kpiVersions.templateId, kpiTemplates.id))
    .where(and(eq(kpiVersions.id, versionId), eq(kpiTemplates.organizationId, organizationId)))
    .limit(1);
  const version = versionRows[0];
  if (!version) throw new ApiError(409, "EVALUATION_CONFIGURATION_CONFLICT", "Resolved KPI version does not belong to this organization.");
  if (version.status === "DRAFT") throw new ApiError(409, "EVALUATION_CONFIGURATION_CONFLICT", "Resolved KPI version must be an immutable published, in-use, or retired version before evaluation.");

  const criterionRows = await tx.select().from(criteria).where(eq(criteria.kpiVersionId, versionId)).orderBy(asc(criteria.position));
  const runtime: PipelineCriterion[] = [];
  for (const criterion of criterionRows) {
    const metricRows = await tx.select({
      metricDefinitionId: metricConfigurations.metricDefinitionId,
      parameters: metricConfigurations.parameters,
      key: metricDefinitions.key,
      name: metricDefinitions.name,
      formulaKind: metricDefinitions.formulaKind,
      formula: metricDefinitions.formula,
      requiredFields: metricDefinitions.requiredFields,
      supportedIssueTypes: metricDefinitions.supportedIssueTypes,
      dataQualityRequirements: metricDefinitions.dataQualityRequirements,
    }).from(metricConfigurations)
      .innerJoin(metricDefinitions, eq(metricConfigurations.metricDefinitionId, metricDefinitions.id))
      .where(and(eq(metricConfigurations.criterionId, criterion.id), eq(metricDefinitions.organizationId, organizationId)))
      .limit(1);
    const metricRow = metricRows[0] ?? null;

    const ruleRows = await tx.select().from(scoringRules).where(eq(scoringRules.criterionId, criterion.id)).orderBy(asc(scoringRules.position));
    runtime.push({
      id: criterion.id,
      name: criterion.name,
      maxScore: Number(criterion.maxScore),
      method: criterion.method,
      requiredEvidence: criterion.requiredEvidence,
      evidenceSources: criterion.evidencePolicy.sources,
      metricConfiguration: metricRow ? {
        metricDefinitionId: metricRow.metricDefinitionId,
        parameters: metricRow.parameters,
      } : null,
      metricDefinition: metricRow ? {
        id: metricRow.metricDefinitionId,
        key: metricRow.key,
        name: metricRow.name,
        formulaKind: assertMetricFormulaKind(metricRow.formulaKind),
        formula: metricRow.formula,
        requiredFields: metricRow.requiredFields,
        supportedIssueTypes: metricRow.supportedIssueTypes,
        dataQualityRequirements: metricRow.dataQualityRequirements,
      } : null,
      rules: ruleRows.map((row) => deserializeRule(row.type, row.config)),
    });
  }
  return { versionId, criteria: runtime };
}

export async function listEvaluationPeriods(organizationId: string) {
  return getDb().select({
    id: evaluationPeriods.id,
    key: evaluationPeriods.key,
    startsOn: evaluationPeriods.startsOn,
    endsOn: evaluationPeriods.endsOn,
    status: evaluationPeriods.status,
    rankSchemeId: evaluationPeriods.rankSchemeId,
    lockedAt: evaluationPeriods.lockedAt,
    createdAt: evaluationPeriods.createdAt,
  }).from(evaluationPeriods)
    .where(eq(evaluationPeriods.organizationId, organizationId))
    .orderBy(sql`${evaluationPeriods.startsOn} desc`);
}

export async function createEvaluationPeriod(input: {
  organizationId: string;
  actorUserId: string;
  requestId?: string;
  key: string;
  startsOn: string;
  endsOn: string;
  rankSchemeId?: string | null;
}) {
  try {
    return await getDb().transaction(async (tx) => {
      if (input.rankSchemeId) {
        const scheme = await tx.select({ id: rankSchemes.id }).from(rankSchemes)
          .where(and(eq(rankSchemes.id, input.rankSchemeId), eq(rankSchemes.organizationId, input.organizationId), eq(rankSchemes.active, true)))
          .limit(1);
        if (!scheme[0]) throw new ApiError(422, "INVALID_RANK_SCHEME", "Rank scheme must be active and belong to this organization.");
      }
      const rows = await tx.insert(evaluationPeriods).values({
        organizationId: input.organizationId,
        key: input.key,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        rankSchemeId: input.rankSchemeId ?? null,
        status: "UPCOMING",
      }).returning();
      const period = rows[0];
      if (!period) throw new ApiError(500, "CREATE_FAILED", "Evaluation period could not be created.");
      await appendAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        action: "EVALUATION_PERIOD_CREATED",
        entityType: "evaluation_period",
        entityId: period.id,
        after: { key: period.key, startsOn: period.startsOn, endsOn: period.endsOn, status: period.status, rankSchemeId: period.rankSchemeId },
      });
      return period;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    mapUniqueViolation(error, "An evaluation period with this key already exists in the organization.");
  }
}

export async function listPeriodAssignments(organizationId: string, periodId: string) {
  const period = await getDb().select({ id: evaluationPeriods.id }).from(evaluationPeriods)
    .where(and(eq(evaluationPeriods.id, periodId), eq(evaluationPeriods.organizationId, organizationId))).limit(1);
  if (!period[0]) throw new ApiError(404, "EVALUATION_PERIOD_NOT_FOUND", "Evaluation period was not found in this organization.");
  return getDb().select({
    id: periodKpiAssignments.id,
    teamId: periodKpiAssignments.teamId,
    teamName: teams.name,
    kpiVersionId: periodKpiAssignments.kpiVersionId,
    templateName: kpiTemplates.name,
    version: kpiVersions.version,
    status: kpiVersions.status,
  }).from(periodKpiAssignments)
    .innerJoin(teams, eq(periodKpiAssignments.teamId, teams.id))
    .innerJoin(kpiVersions, eq(periodKpiAssignments.kpiVersionId, kpiVersions.id))
    .innerJoin(kpiTemplates, eq(kpiVersions.templateId, kpiTemplates.id))
    .where(and(eq(periodKpiAssignments.periodId, periodId), eq(kpiTemplates.organizationId, organizationId)))
    .orderBy(teams.name);
}

export async function replacePeriodAssignments(input: {
  organizationId: string;
  periodId: string;
  actorUserId: string;
  requestId?: string;
  assignments: Array<{ teamId: string; kpiVersionId: string }>;
}) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.periodId}))`);
    const period = await periodScope(tx, input.organizationId, input.periodId);
    if (period.status !== "UPCOMING") throw new ApiError(409, "PERIOD_CONFIGURATION_FROZEN", "KPI assignments can change only while the evaluation period is upcoming.");

    for (const assignment of input.assignments) {
      const teamRows = await tx.select({ id: teams.id }).from(teams)
        .innerJoin(departments, eq(teams.departmentId, departments.id))
        .where(and(eq(teams.id, assignment.teamId), eq(departments.organizationId, input.organizationId), eq(teams.active, true)))
        .limit(1);
      if (!teamRows[0]) throw new ApiError(422, "INVALID_TEAM_ASSIGNMENT", "Assigned team must be active and belong to this organization.");

      const versionRows = await tx.select({ id: kpiVersions.id, status: kpiVersions.status }).from(kpiVersions)
        .innerJoin(kpiTemplates, eq(kpiVersions.templateId, kpiTemplates.id))
        .where(and(eq(kpiVersions.id, assignment.kpiVersionId), eq(kpiTemplates.organizationId, input.organizationId)))
        .limit(1);
      const version = versionRows[0];
      if (!version || (version.status !== "PUBLISHED" && version.status !== "IN_USE")) {
        throw new ApiError(422, "INVALID_KPI_ASSIGNMENT", "Assigned KPI version must belong to this organization and be published or in use.");
      }
    }

    const beforeAssignments = await tx.select({ teamId: periodKpiAssignments.teamId, kpiVersionId: periodKpiAssignments.kpiVersionId })
      .from(periodKpiAssignments).where(eq(periodKpiAssignments.periodId, input.periodId)).orderBy(periodKpiAssignments.teamId);
    await tx.delete(periodKpiAssignments).where(eq(periodKpiAssignments.periodId, input.periodId));
    if (input.assignments.length) {
      await tx.insert(periodKpiAssignments).values(input.assignments.map((assignment) => ({
        periodId: input.periodId,
        teamId: assignment.teamId,
        kpiVersionId: assignment.kpiVersionId,
        assignedBy: input.actorUserId,
      })));
    }
    const afterAssignments = [...input.assignments].sort((a, b) => a.teamId.localeCompare(b.teamId));
    await appendAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: "PERIOD_KPI_ASSIGNMENTS_REPLACED",
      entityType: "evaluation_period",
      entityId: input.periodId,
      before: { assignments: beforeAssignments },
      after: { assignments: afterAssignments },
      metadata: { logicallyIdempotent: JSON.stringify(beforeAssignments) === JSON.stringify(afterAssignments) },
    });
    return input.assignments;
  });
}

export async function startEvaluationCollection(input: { organizationId: string; periodId: string; actorUserId: string; requestId?: string }) {
  const { organizationId, periodId } = input;
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${periodId}))`);
    const period = await periodScope(tx, organizationId, periodId);
    if (period.status !== "UPCOMING") throw new ApiError(409, "INVALID_PERIOD_TRANSITION", "Only an upcoming evaluation period can start collection.");
    const assignments = await tx.select({ id: periodKpiAssignments.id, teamId: periodKpiAssignments.teamId }).from(periodKpiAssignments).where(eq(periodKpiAssignments.periodId, periodId));
    if (!assignments.length) throw new ApiError(409, "PERIOD_ASSIGNMENTS_REQUIRED", "At least one team KPI assignment is required before collection starts.");

    const primaryMembershipRows = await tx.select({
      teamId: teamMemberships.teamId,
      effectiveFrom: teamMemberships.effectiveFrom,
      effectiveTo: teamMemberships.effectiveTo,
    }).from(teamMemberships)
      .innerJoin(teams, eq(teamMemberships.teamId, teams.id))
      .innerJoin(departments, eq(teams.departmentId, departments.id))
      .where(and(eq(departments.organizationId, organizationId), eq(teamMemberships.primary, true)));
    const requiredTeamIds = new Set(primaryMembershipRows
      .filter((membership) => membership.effectiveFrom <= period.startsOn && (membership.effectiveTo === null || membership.effectiveTo >= period.startsOn))
      .map((membership) => membership.teamId));
    const assignedTeamIds = new Set(assignments.map((assignment) => assignment.teamId));
    const missingTeamCount = [...requiredTeamIds].filter((teamId) => !assignedTeamIds.has(teamId)).length;
    if (missingTeamCount > 0) {
      throw new ApiError(409, "PERIOD_ASSIGNMENT_COVERAGE_REQUIRED", `${missingTeamCount} team(s) with effective primary members are missing a KPI assignment for this period.`);
    }

    const rows = await tx.update(evaluationPeriods).set({ status: "COLLECTING", updatedAt: new Date() }).where(eq(evaluationPeriods.id, periodId)).returning();
    const updated = rows[0];
    if (!updated) throw new ApiError(500, "PERIOD_TRANSITION_FAILED", "Evaluation period could not start collection.");
    await appendAuditEvent(tx, {
      organizationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: "EVALUATION_COLLECTION_STARTED",
      entityType: "evaluation_period",
      entityId: periodId,
      before: { status: period.status },
      after: { status: updated.status },
      metadata: { assignmentCount: assignments.length },
    });
    return updated;
  });
}

async function resolveMemberConfiguration(tx: DbTransaction, organizationId: string, period: { id: string; startsOn: string }, memberId: string) {
  const memberRows = await tx.select({ id: members.id }).from(members)
    .where(and(eq(members.id, memberId), eq(members.organizationId, organizationId)))
    .limit(1);
  if (!memberRows[0]) throw new ApiError(404, "MEMBER_NOT_FOUND", "Evaluation member was not found in this organization.");

  const membershipRows = await tx.select({
    id: teamMemberships.id,
    memberId: teamMemberships.memberId,
    teamId: teamMemberships.teamId,
    effectiveFrom: teamMemberships.effectiveFrom,
    effectiveTo: teamMemberships.effectiveTo,
    primary: teamMemberships.primary,
  }).from(teamMemberships)
    .innerJoin(teams, eq(teamMemberships.teamId, teams.id))
    .innerJoin(departments, eq(teams.departmentId, departments.id))
    .where(and(eq(teamMemberships.memberId, memberId), eq(departments.organizationId, organizationId)));

  const assignmentRows = await tx.select({
    periodId: periodKpiAssignments.periodId,
    teamId: periodKpiAssignments.teamId,
    kpiVersionId: periodKpiAssignments.kpiVersionId,
  }).from(periodKpiAssignments).where(eq(periodKpiAssignments.periodId, period.id));

  try {
    return resolveEvaluationConfiguration({
      memberId,
      periodId: period.id,
      periodStartDate: period.startsOn,
      memberships: membershipRows as EffectiveMembership[],
      assignments: assignmentRows as KpiAssignment[],
    });
  } catch (error) {
    evaluationConflict(error);
  }
}

async function persistMemberResult(tx: DbTransaction, input: {
  organizationId: string;
  actorUserId: string;
  periodId: string;
  memberId: string;
  resolvedMembershipId: string;
  resolvedTeamId: string;
  kpiVersionId: string;
  collected?: CollectedCriterionPayload[];
  provider?: MetricInputProvider;
  period: { id: string; key: string; startsOn: string; endsOn: string };
}) {
  const existingRows = await tx.select({ id: memberEvaluations.id, status: memberEvaluations.status }).from(memberEvaluations)
    .where(and(eq(memberEvaluations.periodId, input.periodId), eq(memberEvaluations.memberId, input.memberId)))
    .limit(1);
  const existing = existingRows[0] ?? null;
  if (existing) {
    const decision = recalculationPolicy(existing.status, false);
    if (!decision.allowed) throw new ApiError(409, "RECALCULATION_BLOCKED", decision.reason);
  }

  const runtime = await loadRuntimeKpi(tx, input.organizationId, input.kpiVersionId);
  let provider: MetricInputProvider;
  if (input.provider) {
    provider = input.provider;
  } else {
    try {
      const collectedProvider = new CollectedMetricInputProvider(input.collected ?? []);
      const configuredIds = new Set(runtime.criteria.map((criterion) => criterion.id));
      for (const criterionId of collectedProvider.criterionIds()) {
        if (!configuredIds.has(criterionId)) {
          throw new CollectedInputError(`Collected input references criterion '${criterionId}' outside KPI version '${runtime.versionId}'.`);
        }
      }
      provider = collectedProvider;
    } catch (error) {
      evaluationConflict(error);
    }
  }

  const criterionResults: Array<Awaited<ReturnType<typeof evaluateCriterion>>> = [];
  for (const criterion of runtime.criteria) {
    criterionResults.push(await evaluateCriterion({
      organizationId: input.organizationId,
      memberId: input.memberId,
      period: input.period,
      criterion,
      provider,
    }));
  }
  const summary = aggregateEvaluation(criterionResults);
  const systemScore = summary.aggregate.result.status === "EVALUATED" ? summary.aggregate.result.value : null;
  const confidence = summary.aggregate.result.status === "EVALUATED" ? summary.confidence : "REVIEW_REQUIRED";
  const qualityIssues = criterionResults.flatMap((criterion) => criterion.qualityIssues);

  const memberRows = existing
    ? await tx.update(memberEvaluations).set({
        resolvedMembershipId: input.resolvedMembershipId,
        resolvedTeamId: input.resolvedTeamId,
        kpiVersionId: input.kpiVersionId,
        status: "SYSTEM_EVALUATED",
        confidence,
        systemScore: systemScore === null ? null : String(systemScore),
        updatedAt: new Date(),
      }).where(eq(memberEvaluations.id, existing.id)).returning()
    : await tx.insert(memberEvaluations).values({
        periodId: input.periodId,
        memberId: input.memberId,
        resolvedMembershipId: input.resolvedMembershipId,
        resolvedTeamId: input.resolvedTeamId,
        kpiVersionId: input.kpiVersionId,
        status: "SYSTEM_EVALUATED",
        confidence,
        systemScore: systemScore === null ? null : String(systemScore),
      }).returning();
  const memberEvaluation = memberRows[0];
  if (!memberEvaluation) throw new ApiError(500, "EVALUATION_PERSIST_FAILED", "Member evaluation could not be persisted.");

  if (provider instanceof JiraMetricInputProvider) {
    const existingSnapshot = await tx.select({ id: jiraFactSnapshots.id }).from(jiraFactSnapshots)
      .where(eq(jiraFactSnapshots.memberEvaluationId, memberEvaluation.id)).limit(1);
    if (!existingSnapshot[0]) {
      const contributingFacts = provider.contributingFacts();
      if (contributingFacts.length) {
        await tx.insert(jiraFactSnapshots).values(contributingFacts.map((row) => ({
          jiraIssueId: row.jiraIssueId,
          memberEvaluationId: memberEvaluation.id,
          facts: row.facts,
          attribution: {
            ...row.attribution,
            issueKey: row.issueKey,
            workspaceUrl: row.workspaceUrl,
            sourceUpdatedAt: row.sourceUpdatedAt instanceof Date ? row.sourceUpdatedAt.toISOString() : row.sourceUpdatedAt,
          },
        })));
      }
    }
  }

  await tx.delete(dataQualityIssues).where(eq(dataQualityIssues.memberEvaluationId, memberEvaluation.id));

  for (const criterion of criterionResults) {
    const criterionMetricValue = criterion.metricValue ? {
      value: criterion.metricValue.value,
      variables: criterion.metricValue.variables ?? {},
    } : null;
    const criterionSystemScore = criterion.result.status === "EVALUATED" ? criterion.result.value : null;
    const explanationTrace = criterion.explanationTrace as Record<string, unknown>;
    const existingCriterionRows = await tx.select({ id: criterionEvaluations.id }).from(criterionEvaluations)
      .where(and(eq(criterionEvaluations.memberEvaluationId, memberEvaluation.id), eq(criterionEvaluations.criterionId, criterion.criterionId)))
      .limit(1);
    const existingCriterion = existingCriterionRows[0] ?? null;
    const criterionRows = existingCriterion
      ? await tx.update(criterionEvaluations).set({
          metricValue: criterionMetricValue,
          systemScore: criterionSystemScore === null ? null : String(criterionSystemScore),
          confidence: criterion.confidence,
          explanationTrace,
          updatedAt: new Date(),
        }).where(eq(criterionEvaluations.id, existingCriterion.id)).returning()
      : await tx.insert(criterionEvaluations).values({
          memberEvaluationId: memberEvaluation.id,
          criterionId: criterion.criterionId,
          metricValue: criterionMetricValue,
          systemScore: criterionSystemScore === null ? null : String(criterionSystemScore),
          confidence: criterion.confidence,
          explanationTrace,
        }).returning();
    const criterionEvaluation = criterionRows[0];
    if (!criterionEvaluation) throw new ApiError(500, "EVALUATION_PERSIST_FAILED", "Criterion evaluation could not be persisted.");

    await tx.delete(evidence).where(eq(evidence.criterionEvaluationId, criterionEvaluation.id));
    if (criterion.evidence.length) {
      await tx.insert(evidence).values(criterion.evidence.map((item) => ({
        criterionEvaluationId: criterionEvaluation.id,
        type: item.type,
        sourceRef: item.sourceRef ?? null,
        title: item.title,
        payload: item.payload ?? {},
        createdBy: input.actorUserId,
      })));
    }

    if (criterion.qualityIssues.length) {
      await tx.insert(dataQualityIssues).values(criterion.qualityIssues.map((issue) => ({
        memberEvaluationId: memberEvaluation.id,
        criterionEvaluationId: criterionEvaluation.id,
        code: issue.code,
        missingField: issue.missingField ?? null,
        affectedMetric: issue.affectedMetric ?? null,
        severity: issue.severity,
        message: issue.message,
      })));
    }
  }

  return {
    id: memberEvaluation.id,
    memberId: input.memberId,
    resolvedMembershipId: input.resolvedMembershipId,
    resolvedTeamId: input.resolvedTeamId,
    kpiVersionId: input.kpiVersionId,
    status: "SYSTEM_EVALUATED" as const,
    systemScore,
    confidence,
    coverage: summary.aggregate.coverage,
    qualityIssueCount: qualityIssues.length,
  };
}

async function updatePeriodCompletion(tx: DbTransaction, organizationId: string, period: { id: string; startsOn: string; status: string }) {
  const membershipRows = await tx.select({
    memberId: teamMemberships.memberId,
    effectiveFrom: teamMemberships.effectiveFrom,
    effectiveTo: teamMemberships.effectiveTo,
  }).from(teamMemberships)
    .innerJoin(members, eq(teamMemberships.memberId, members.id))
    .where(and(eq(members.organizationId, organizationId), eq(teamMemberships.primary, true)));
  const eligible = new Set(membershipRows
    .filter((row) => row.effectiveFrom <= period.startsOn && (row.effectiveTo === null || row.effectiveTo >= period.startsOn))
    .map((row) => row.memberId));
  if (eligible.size === 0) return { eligibleMembers: 0, evaluatedMembers: 0, completed: false };

  const evaluationRows = await tx.select({ memberId: memberEvaluations.memberId, status: memberEvaluations.status })
    .from(memberEvaluations).where(eq(memberEvaluations.periodId, period.id));
  const systemCompleteStatuses = new Set(["SYSTEM_EVALUATED", "LEADER_REVIEW", "HEAD_REVIEW", "FINALIZED", "LOCKED"]);
  const evaluated = new Set(evaluationRows.filter((row) => systemCompleteStatuses.has(row.status)).map((row) => row.memberId));
  const completed = [...eligible].every((memberId) => evaluated.has(memberId));
  if (completed && period.status === "COLLECTING") {
    await tx.update(evaluationPeriods).set({ status: "SYSTEM_EVALUATED", updatedAt: new Date() }).where(eq(evaluationPeriods.id, period.id));
  }
  return { eligibleMembers: eligible.size, evaluatedMembers: [...eligible].filter((memberId) => evaluated.has(memberId)).length, completed };
}

function issueCreatedAt(payload: Record<string, unknown>): string | null {
  const fields = payload.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
  const created = (fields as Record<string, unknown>).created;
  return typeof created === "string" && created.trim() ? created : null;
}

async function jiraProviderForMember(tx: DbTransaction, input: {
  organizationId: string;
  memberId: string;
  existingEvaluationId: string | null;
}): Promise<JiraMetricInputProvider> {
  if (input.existingEvaluationId) {
    const snapshots = await tx.select({
      jiraIssueId: jiraFactSnapshots.jiraIssueId,
      issueKey: jiraIssues.issueKey,
      summary: jiraIssues.summary,
      workspaceUrl: jiraConnections.workspaceUrl,
      facts: jiraFactSnapshots.facts,
      attribution: jiraFactSnapshots.attribution,
      capturedAt: jiraFactSnapshots.capturedAt,
    }).from(jiraFactSnapshots)
      .innerJoin(jiraIssues, eq(jiraFactSnapshots.jiraIssueId, jiraIssues.id))
      .innerJoin(jiraConnections, eq(jiraIssues.connectionId, jiraConnections.id))
      .where(and(
        eq(jiraFactSnapshots.memberEvaluationId, input.existingEvaluationId),
        eq(jiraConnections.organizationId, input.organizationId),
      ));
    if (snapshots.length) {
      return new JiraMetricInputProvider(snapshots.map((row): JiraEvaluationFact => ({
        jiraIssueId: row.jiraIssueId,
        issueKey: row.issueKey,
        summary: row.summary,
        workspaceUrl: row.workspaceUrl,
        facts: row.facts,
        attribution: row.attribution,
        sourceUpdatedAt: row.capturedAt,
      })), true);
    }
  }

  const currentFacts = await tx.select({
    jiraIssueId: jiraIssueFacts.jiraIssueId,
    issueKey: jiraIssues.issueKey,
    summary: jiraIssues.summary,
    workspaceUrl: jiraConnections.workspaceUrl,
    currentPayload: jiraIssues.currentPayload,
    facts: jiraIssueFacts.facts,
    attribution: jiraIssueFacts.attribution,
    sourceUpdatedAt: jiraIssueFacts.sourceUpdatedAt,
  }).from(jiraIssueFacts)
    .innerJoin(jiraIssues, eq(jiraIssueFacts.jiraIssueId, jiraIssues.id))
    .innerJoin(jiraConnections, eq(jiraIssues.connectionId, jiraConnections.id))
    .where(and(
      eq(jiraIssueFacts.memberId, input.memberId),
      eq(jiraConnections.organizationId, input.organizationId),
      eq(jiraConnections.active, true),
    ));

  return new JiraMetricInputProvider(currentFacts.map((row): JiraEvaluationFact => ({
    jiraIssueId: row.jiraIssueId,
    issueKey: row.issueKey,
    summary: row.summary,
    workspaceUrl: row.workspaceUrl,
    facts: row.facts,
    attribution: row.attribution,
    sourceUpdatedAt: row.sourceUpdatedAt,
    issueCreatedAt: issueCreatedAt(row.currentPayload),
  })));
}

async function eligiblePeriodMemberIds(tx: DbTransaction, organizationId: string, period: { startsOn: string }): Promise<string[]> {
  const rows = await tx.select({
    memberId: teamMemberships.memberId,
    effectiveFrom: teamMemberships.effectiveFrom,
    effectiveTo: teamMemberships.effectiveTo,
  }).from(teamMemberships)
    .innerJoin(members, eq(teamMemberships.memberId, members.id))
    .innerJoin(teams, eq(teamMemberships.teamId, teams.id))
    .innerJoin(departments, eq(teams.departmentId, departments.id))
    .where(and(
      eq(departments.organizationId, organizationId),
      eq(teamMemberships.primary, true),
      eq(members.active, true),
    ));
  return [...new Set(rows
    .filter((row) => row.effectiveFrom <= period.startsOn && (row.effectiveTo === null || row.effectiveTo >= period.startsOn))
    .map((row) => row.memberId))];
}

export async function evaluatePeriodFromJira(input: {
  organizationId: string;
  periodId: string;
  actorUserId: string;
  memberIds?: string[];
}) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.periodId}))`);
    const period = await periodScope(tx, input.organizationId, input.periodId);
    if (period.status !== "COLLECTING" && period.status !== "SYSTEM_EVALUATED") {
      throw new ApiError(409, "EVALUATION_PERIOD_NOT_COLLECTING", "Jira-backed system evaluation is allowed only while the period is collecting or already system-evaluated.");
    }

    const eligibleIds = await eligiblePeriodMemberIds(tx, input.organizationId, period);
    const eligibleSet = new Set(eligibleIds);
    const requestedIds = input.memberIds?.length ? [...new Set(input.memberIds)] : eligibleIds;
    for (const memberId of requestedIds) {
      if (!eligibleSet.has(memberId)) throw new ApiError(422, "INVALID_EVALUATION_MEMBER", "Every requested Jira evaluation member must be active and have an effective primary membership for this period.");
    }

    const results = [];
    for (const memberId of requestedIds) {
      const resolution = await resolveMemberConfiguration(tx, input.organizationId, period, memberId);
      const existingRows = await tx.select({ id: memberEvaluations.id }).from(memberEvaluations)
        .where(and(eq(memberEvaluations.periodId, period.id), eq(memberEvaluations.memberId, memberId))).limit(1);
      const provider = await jiraProviderForMember(tx, {
        organizationId: input.organizationId,
        memberId,
        existingEvaluationId: existingRows[0]?.id ?? null,
      });
      results.push(await persistMemberResult(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        periodId: period.id,
        memberId,
        resolvedMembershipId: resolution.membershipId,
        resolvedTeamId: resolution.teamId,
        kpiVersionId: resolution.kpiVersionId,
        provider,
        period: { id: period.id, key: period.key, startsOn: period.startsOn, endsOn: period.endsOn },
      }));
    }
    const progress = await updatePeriodCompletion(tx, input.organizationId, period);
    return { results, progress, source: "JIRA" as const };
  });
}

export async function evaluatePeriodMembers(input: {
  organizationId: string;
  periodId: string;
  actorUserId: string;
  members: Array<{ memberId: string; criteria: CollectedCriterionPayload[] }>;
}) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.periodId}))`);
    const period = await periodScope(tx, input.organizationId, input.periodId);
    if (period.status !== "COLLECTING" && period.status !== "SYSTEM_EVALUATED") {
      throw new ApiError(409, "EVALUATION_PERIOD_NOT_COLLECTING", "System evaluation is allowed only while the period is collecting or already system-evaluated.");
    }

    const results = [];
    for (const memberInput of input.members) {
      const resolution = await resolveMemberConfiguration(tx, input.organizationId, period, memberInput.memberId);
      results.push(await persistMemberResult(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        periodId: period.id,
        memberId: memberInput.memberId,
        resolvedMembershipId: resolution.membershipId,
        resolvedTeamId: resolution.teamId,
        kpiVersionId: resolution.kpiVersionId,
        collected: memberInput.criteria,
        period: { id: period.id, key: period.key, startsOn: period.startsOn, endsOn: period.endsOn },
      }));
    }
    const progress = await updatePeriodCompletion(tx, input.organizationId, period);
    return { results, progress };
  });
}

export async function listPeriodEvaluations(organizationId: string, periodId: string) {
  await getDb().transaction((tx) => periodScope(tx, organizationId, periodId));
  const rows = await getDb().select({
    id: memberEvaluations.id,
    memberId: memberEvaluations.memberId,
    memberName: members.name,
    employeeId: members.employeeId,
    resolvedMembershipId: memberEvaluations.resolvedMembershipId,
    resolvedTeamId: memberEvaluations.resolvedTeamId,
    teamName: teams.name,
    kpiVersionId: memberEvaluations.kpiVersionId,
    templateName: kpiTemplates.name,
    version: kpiVersions.version,
    status: memberEvaluations.status,
    confidence: memberEvaluations.confidence,
    systemScore: memberEvaluations.systemScore,
    leaderScore: memberEvaluations.leaderScore,
    headScore: memberEvaluations.headScore,
    finalScore: memberEvaluations.finalScore,
    finalRank: memberEvaluations.finalRank,
    finalCoefficient: memberEvaluations.finalCoefficient,
    finalizedAt: memberEvaluations.finalizedAt,
    lockedAt: memberEvaluations.lockedAt,
    updatedAt: memberEvaluations.updatedAt,
  }).from(memberEvaluations)
    .innerJoin(members, eq(memberEvaluations.memberId, members.id))
    .innerJoin(teams, eq(memberEvaluations.resolvedTeamId, teams.id))
    .innerJoin(kpiVersions, eq(memberEvaluations.kpiVersionId, kpiVersions.id))
    .innerJoin(kpiTemplates, eq(kpiVersions.templateId, kpiTemplates.id))
    .where(and(eq(memberEvaluations.periodId, periodId), eq(kpiTemplates.organizationId, organizationId)))
    .orderBy(members.name);

  const result = [];
  for (const row of rows) {
    const criterionRows = await getDb().select({
      id: criterionEvaluations.id,
      criterionId: criterionEvaluations.criterionId,
      criterionName: criteria.name,
      maxScore: criteria.maxScore,
      metricValue: criterionEvaluations.metricValue,
      systemScore: criterionEvaluations.systemScore,
      leaderScore: criterionEvaluations.leaderScore,
      headScore: criterionEvaluations.headScore,
      finalScore: criterionEvaluations.finalScore,
      confidence: criterionEvaluations.confidence,
      explanationTrace: criterionEvaluations.explanationTrace,
    }).from(criterionEvaluations)
      .innerJoin(criteria, eq(criterionEvaluations.criterionId, criteria.id))
      .where(eq(criterionEvaluations.memberEvaluationId, row.id))
      .orderBy(criteria.position);
    const issueRows = await getDb().select({
      id: dataQualityIssues.id,
      criterionEvaluationId: dataQualityIssues.criterionEvaluationId,
      code: dataQualityIssues.code,
      missingField: dataQualityIssues.missingField,
      affectedMetric: dataQualityIssues.affectedMetric,
      severity: dataQualityIssues.severity,
      message: dataQualityIssues.message,
      resolvedAt: dataQualityIssues.resolvedAt,
      resolutionDisposition: dataQualityIssues.resolutionDisposition,
      resolutionReason: dataQualityIssues.resolutionReason,
      resolvedBy: dataQualityIssues.resolvedBy,
    }).from(dataQualityIssues).where(eq(dataQualityIssues.memberEvaluationId, row.id));
    result.push({
      ...row,
      systemScore: row.systemScore === null ? null : Number(row.systemScore),
      leaderScore: row.leaderScore === null ? null : Number(row.leaderScore),
      headScore: row.headScore === null ? null : Number(row.headScore),
      finalScore: row.finalScore === null ? null : Number(row.finalScore),
      finalCoefficient: row.finalCoefficient === null ? null : Number(row.finalCoefficient),
      criteria: criterionRows.map((item) => ({
        ...item,
        maxScore: Number(item.maxScore),
        systemScore: item.systemScore === null ? null : Number(item.systemScore),
        leaderScore: item.leaderScore === null ? null : Number(item.leaderScore),
        headScore: item.headScore === null ? null : Number(item.headScore),
        finalScore: item.finalScore === null ? null : Number(item.finalScore),
      })),
      qualityIssues: issueRows,
    });
  }
  return result;
}
