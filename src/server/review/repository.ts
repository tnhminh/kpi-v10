import { and, asc, eq, sql } from "drizzle-orm";
import { appendAuditEvent } from "@/server/audit/repository";
import { assertCanFinalize, assertCanLock, LifecycleError, validateAdjustment } from "@/domain/kpi/lifecycle";
import { RankSchemeError, resolveRank } from "@/domain/kpi/rank";
import { aggregateKpi, ScoringError } from "@/domain/kpi/scoring";
import type { AppRole } from "@/server/auth/types";
import { canReviewTeam } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import {
  adjustments,
  criteria,
  criterionEvaluations,
  dataQualityIssues,
  departmentHeadAssignments,
  departments,
  evaluationPeriods,
  evidence,
  historicalSnapshots,
  jiraFactSnapshots,
  jiraIssues,
  kpiTemplates,
  kpiVersions,
  memberEvaluations,
  members,
  rankBands,
  rankSchemes,
  teamLeadershipAssignments,
  teamMemberships,
  teams,
} from "@/server/db/schema";
import { listPeriodEvaluations } from "@/server/evaluation/repository";
import { ApiError } from "@/server/http";
import { snapshotChecksum } from "./snapshot";

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type ReviewLayer = "LEADER" | "DEPARTMENT_HEAD";

function numeric(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function lifecycleError(error: unknown): never {
  if (error instanceof LifecycleError || error instanceof RankSchemeError || error instanceof ScoringError) {
    throw new ApiError(409, "REVIEW_LIFECYCLE_CONFLICT", error.message);
  }
  throw error;
}

async function evaluationScope(tx: DbTransaction, organizationId: string, evaluationId: string) {
  const rows = await tx.select({
    id: memberEvaluations.id,
    periodId: memberEvaluations.periodId,
    periodKey: evaluationPeriods.key,
    periodStartsOn: evaluationPeriods.startsOn,
    periodEndsOn: evaluationPeriods.endsOn,
    periodStatus: evaluationPeriods.status,
    rankSchemeId: evaluationPeriods.rankSchemeId,
    memberId: memberEvaluations.memberId,
    memberName: members.name,
    employeeId: members.employeeId,
    memberEmail: members.email,
    resolvedMembershipId: memberEvaluations.resolvedMembershipId,
    resolvedTeamId: memberEvaluations.resolvedTeamId,
    teamName: teams.name,
    departmentId: departments.id,
    departmentName: departments.name,
    kpiVersionId: memberEvaluations.kpiVersionId,
    kpiVersion: kpiVersions.version,
    templateId: kpiTemplates.id,
    templateName: kpiTemplates.name,
    status: memberEvaluations.status,
    confidence: memberEvaluations.confidence,
    systemScore: memberEvaluations.systemScore,
    leaderScore: memberEvaluations.leaderScore,
    headScore: memberEvaluations.headScore,
    finalScore: memberEvaluations.finalScore,
    finalRank: memberEvaluations.finalRank,
    finalCoefficient: memberEvaluations.finalCoefficient,
    finalizedAt: memberEvaluations.finalizedAt,
    finalizedBy: memberEvaluations.finalizedBy,
    lockedAt: memberEvaluations.lockedAt,
  }).from(memberEvaluations)
    .innerJoin(evaluationPeriods, eq(memberEvaluations.periodId, evaluationPeriods.id))
    .innerJoin(members, eq(memberEvaluations.memberId, members.id))
    .innerJoin(teams, eq(memberEvaluations.resolvedTeamId, teams.id))
    .innerJoin(departments, eq(teams.departmentId, departments.id))
    .innerJoin(kpiVersions, eq(memberEvaluations.kpiVersionId, kpiVersions.id))
    .innerJoin(kpiTemplates, eq(kpiVersions.templateId, kpiTemplates.id))
    .where(and(
      eq(memberEvaluations.id, evaluationId),
      eq(evaluationPeriods.organizationId, organizationId),
      eq(kpiTemplates.organizationId, organizationId),
    ))
    .limit(1);
  if (!rows[0]) throw new ApiError(404, "EVALUATION_NOT_FOUND", "Member evaluation was not found in this organization.");
  return rows[0];
}

async function reviewCriteria(tx: DbTransaction, evaluationId: string) {
  return tx.select({
    id: criterionEvaluations.id,
    criterionId: criterionEvaluations.criterionId,
    name: criteria.name,
    description: criteria.description,
    position: criteria.position,
    maxScore: criteria.maxScore,
    method: criteria.method,
    evidencePolicy: criteria.evidencePolicy,
    adjustmentPolicy: criteria.adjustmentPolicy,
    metricValue: criterionEvaluations.metricValue,
    systemScore: criterionEvaluations.systemScore,
    leaderScore: criterionEvaluations.leaderScore,
    headScore: criterionEvaluations.headScore,
    finalScore: criterionEvaluations.finalScore,
    confidence: criterionEvaluations.confidence,
    explanationTrace: criterionEvaluations.explanationTrace,
  }).from(criterionEvaluations)
    .innerJoin(criteria, eq(criterionEvaluations.criterionId, criteria.id))
    .where(eq(criterionEvaluations.memberEvaluationId, evaluationId))
    .orderBy(asc(criteria.position));
}

async function ledTeamIdsForPeriod(tx: DbTransaction, input: { organizationId: string; actorUserId: string; onDate: string }) {
  const actorRows = await tx.select({ id: members.id }).from(members)
    .where(and(eq(members.organizationId, input.organizationId), eq(members.userId, input.actorUserId)))
    .limit(1);
  const actorMember = actorRows[0];
  if (!actorMember) return [] as string[];

  const rows = await tx.select({
    teamId: teamLeadershipAssignments.teamId,
    effectiveFrom: teamLeadershipAssignments.effectiveFrom,
    effectiveTo: teamLeadershipAssignments.effectiveTo,
  }).from(teamLeadershipAssignments)
    .innerJoin(teams, eq(teamLeadershipAssignments.teamId, teams.id))
    .innerJoin(departments, eq(teams.departmentId, departments.id))
    .where(and(
      eq(teamLeadershipAssignments.leaderMemberId, actorMember.id),
      eq(departments.organizationId, input.organizationId),
    ));
  return rows.filter((row) => row.effectiveFrom <= input.onDate && (row.effectiveTo === null || row.effectiveTo >= input.onDate)).map((row) => row.teamId);
}

async function departmentReviewTeamIdsForPeriod(tx: DbTransaction, input: { organizationId: string; actorUserId: string; onDate: string }) {
  const assignments = await tx.select({
    departmentId: departmentHeadAssignments.departmentId,
    effectiveFrom: departmentHeadAssignments.effectiveFrom,
    effectiveTo: departmentHeadAssignments.effectiveTo,
  }).from(departmentHeadAssignments)
    .innerJoin(departments, eq(departmentHeadAssignments.departmentId, departments.id))
    .where(and(eq(departmentHeadAssignments.userId, input.actorUserId), eq(departments.organizationId, input.organizationId)));
  const departmentIds = new Set(assignments
    .filter((row) => row.effectiveFrom <= input.onDate && (row.effectiveTo === null || row.effectiveTo >= input.onDate))
    .map((row) => row.departmentId));
  if (!departmentIds.size) return [] as string[];
  const teamRows = await tx.select({ teamId: teams.id, departmentId: teams.departmentId }).from(teams)
    .innerJoin(departments, eq(teams.departmentId, departments.id))
    .where(eq(departments.organizationId, input.organizationId));
  return teamRows.filter((row) => departmentIds.has(row.departmentId)).map((row) => row.teamId);
}

async function assertReviewScope(tx: DbTransaction, input: {
  organizationId: string;
  actorUserId: string;
  actorRole: AppRole;
  onDate: string;
  targetTeamId: string;
}) {
  if (input.actorRole === "ADMINISTRATOR") return;
  if (input.actorRole === "DEPARTMENT_HEAD") {
    const allowedTeamIds = await departmentReviewTeamIdsForPeriod(tx, input);
    if (allowedTeamIds.includes(input.targetTeamId)) return;
    throw new ApiError(403, "REVIEW_SCOPE_FORBIDDEN", "You are not assigned as Department Head for this evaluation's resolved department and period.");
  }
  const ledTeamIds = input.actorRole === "TEAM_LEADER"
    ? await ledTeamIdsForPeriod(tx, { organizationId: input.organizationId, actorUserId: input.actorUserId, onDate: input.onDate })
    : [];
  if (!canReviewTeam(input.actorRole, input.targetTeamId, ledTeamIds)) {
    throw new ApiError(403, "REVIEW_SCOPE_FORBIDDEN", "You are not authorized to review this evaluation's resolved team for the period.");
  }
}

async function assertDepartmentReviewScope(tx: DbTransaction, input: {
  organizationId: string;
  actorUserId: string;
  actorRole: AppRole;
  onDate: string;
  targetTeamId: string;
}) {
  if (input.actorRole === "ADMINISTRATOR") return;
  if (input.actorRole !== "DEPARTMENT_HEAD") throw new ApiError(403, "REVIEW_SCOPE_FORBIDDEN", "Department review authority is required.");
  const teamIds = await departmentReviewTeamIdsForPeriod(tx, input);
  if (!teamIds.includes(input.targetTeamId)) {
    throw new ApiError(403, "REVIEW_SCOPE_FORBIDDEN", "You are not assigned as Department Head for this evaluation's resolved department and period.");
  }
}

const stage: Record<string, number> = {
  PENDING: 0,
  SYSTEM_EVALUATED: 1,
  LEADER_REVIEW: 2,
  HEAD_REVIEW: 3,
  FINALIZED: 4,
  LOCKED: 5,
};

async function refreshPeriodWorkflowState(tx: DbTransaction, periodId: string, actorUserId?: string) {
  const periodRows = await tx.select({ status: evaluationPeriods.status }).from(evaluationPeriods).where(eq(evaluationPeriods.id, periodId)).limit(1);
  const period = periodRows[0];
  if (!period || period.status === "LOCKED") return period?.status ?? null;
  const rows = await tx.select({ status: memberEvaluations.status }).from(memberEvaluations).where(eq(memberEvaluations.periodId, periodId));
  if (!rows.length) return period.status;

  const allAtLeast = (minimum: number) => rows.every((row) => (stage[row.status] ?? -1) >= minimum);
  const anyAtLeast = (minimum: number) => rows.some((row) => (stage[row.status] ?? -1) >= minimum);
  let nextStatus: "SYSTEM_EVALUATED" | "LEADER_REVIEW" | "HEAD_REVIEW" | "FINALIZED" | "LOCKED" = "SYSTEM_EVALUATED";
  if (allAtLeast(stage.LOCKED)) nextStatus = "LOCKED";
  else if (allAtLeast(stage.FINALIZED)) nextStatus = "FINALIZED";
  else if (allAtLeast(stage.LEADER_REVIEW)) nextStatus = "HEAD_REVIEW";
  else if (anyAtLeast(stage.LEADER_REVIEW)) nextStatus = "LEADER_REVIEW";

  const now = new Date();
  await tx.update(evaluationPeriods).set(nextStatus === "LOCKED" ? {
    status: nextStatus,
    lockedAt: now,
    lockedBy: actorUserId ?? null,
    updatedAt: now,
  } : { status: nextStatus, updatedAt: now }).where(eq(evaluationPeriods.id, periodId));
  return nextStatus;
}

export async function listReviewQueue(input: {
  organizationId: string;
  periodId: string;
  actorUserId: string;
  actorRole: AppRole;
  layer: ReviewLayer;
}) {
  const periodRows = await getDb().select({ startsOn: evaluationPeriods.startsOn }).from(evaluationPeriods)
    .where(and(eq(evaluationPeriods.id, input.periodId), eq(evaluationPeriods.organizationId, input.organizationId)))
    .limit(1);
  const period = periodRows[0];
  if (!period) throw new ApiError(404, "EVALUATION_PERIOD_NOT_FOUND", "Evaluation period was not found in this organization.");

  const rows = await listPeriodEvaluations(input.organizationId, input.periodId);
  if (input.actorRole === "ADMINISTRATOR") return rows;
  if (input.actorRole === "DEPARTMENT_HEAD") {
    const teamIds = await getDb().transaction((tx) => departmentReviewTeamIdsForPeriod(tx, { organizationId: input.organizationId, actorUserId: input.actorUserId, onDate: period.startsOn }));
    const allowed = new Set(teamIds);
    return rows.filter((row) => allowed.has(row.resolvedTeamId));
  }
  if (input.layer === "DEPARTMENT_HEAD" || input.actorRole !== "TEAM_LEADER") return [];
  const ledTeamIds = await getDb().transaction((tx) => ledTeamIdsForPeriod(tx, { organizationId: input.organizationId, actorUserId: input.actorUserId, onDate: period.startsOn }));
  const allowed = new Set(ledTeamIds);
  return rows.filter((row) => allowed.has(row.resolvedTeamId));
}

export async function completeReview(input: {
  organizationId: string;
  evaluationId: string;
  actorUserId: string;
  actorRole: AppRole;
  requestId?: string;
  layer: ReviewLayer;
  adjustments: Array<{ criterionEvaluationId: string; score: number; reason?: string }>;
}) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.evaluationId}))`);
    const scope = await evaluationScope(tx, input.organizationId, input.evaluationId);
    const rows = await reviewCriteria(tx, input.evaluationId);
    if (!rows.length) throw new ApiError(409, "REVIEW_CONFIGURATION_EMPTY", "Evaluation has no criterion results to review.");

    if (input.layer === "LEADER") {
      await assertReviewScope(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        onDate: scope.periodStartsOn,
        targetTeamId: scope.resolvedTeamId,
      });
      if (scope.status !== "SYSTEM_EVALUATED") throw new ApiError(409, "INVALID_REVIEW_STAGE", "Leader review requires a system-evaluated member that has not already entered human review.");
      if (scope.periodStatus !== "SYSTEM_EVALUATED" && scope.periodStatus !== "LEADER_REVIEW") {
        throw new ApiError(409, "INVALID_PERIOD_REVIEW_STAGE", "Leader review is closed for this evaluation period.");
      }
    } else {
      await assertDepartmentReviewScope(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        onDate: scope.periodStartsOn,
        targetTeamId: scope.resolvedTeamId,
      });
      if (scope.status !== "LEADER_REVIEW") throw new ApiError(409, "INVALID_REVIEW_STAGE", "Department Head review requires a completed Leader review.");
      if (scope.periodStatus !== "HEAD_REVIEW") throw new ApiError(409, "INVALID_PERIOD_REVIEW_STAGE", "Department Head review opens only after all Leader reviews for the period are complete.");
    }

    const requested = new Map(input.adjustments.map((item) => [item.criterionEvaluationId, item]));
    const configured = new Set(rows.map((row) => row.id));
    for (const id of requested.keys()) {
      if (!configured.has(id)) throw new ApiError(422, "UNKNOWN_CRITERION_EVALUATION", "Review payload contains a criterion outside this member evaluation.");
    }

    const aggregateInput = [];
    for (const row of rows) {
      const maxScore = Number(row.maxScore);
      const previousScore = input.layer === "LEADER" ? numeric(row.systemScore) : numeric(row.leaderScore);
      const change = requested.get(row.id);
      const nextScore = change?.score ?? previousScore;
      if (nextScore === null) {
        throw new ApiError(409, "REVIEW_SCORE_REQUIRED", `Criterion '${row.name}' is not system-evaluated and requires an explicit human score before this review can complete.`);
      }

      try {
        validateAdjustment({ previousScore, newScore: nextScore, maxScore, reason: change?.reason });
      } catch (error) {
        lifecycleError(error);
      }
      const changed = previousScore === null || Math.abs(nextScore - previousScore) > 0.000001;
      if (changed && !change?.reason?.trim()) {
        throw new ApiError(422, "ADJUSTMENT_REASON_REQUIRED", `Criterion '${row.name}' changed from ${previousScore ?? "NOT_EVALUATED"} to ${nextScore}; an auditable reason is required.`);
      }

      if (changed) {
        await tx.insert(adjustments).values({
          criterionEvaluationId: row.id,
          layer: input.layer,
          previousScore: previousScore === null ? null : String(previousScore),
          newScore: String(nextScore),
          reason: change!.reason!.trim(),
          actorUserId: input.actorUserId,
        });
      }

      if (input.layer === "LEADER") {
        await tx.update(criterionEvaluations).set({ leaderScore: String(nextScore), updatedAt: new Date() }).where(eq(criterionEvaluations.id, row.id));
      } else {
        await tx.update(criterionEvaluations).set({ headScore: String(nextScore), updatedAt: new Date() }).where(eq(criterionEvaluations.id, row.id));
      }
      aggregateInput.push({ criterionId: row.criterionId, maxScore, result: { status: "EVALUATED" as const, value: nextScore } });
    }

    let aggregate;
    try {
      aggregate = aggregateKpi(aggregateInput, true);
    } catch (error) {
      lifecycleError(error);
    }
    if (aggregate.result.status !== "EVALUATED") throw new ApiError(409, "REVIEW_INCOMPLETE", aggregate.result.reason);
    const score = aggregate.result.value;
    const now = new Date();
    if (input.layer === "LEADER") {
      await tx.update(memberEvaluations).set({ leaderScore: String(score), status: "LEADER_REVIEW", updatedAt: now }).where(eq(memberEvaluations.id, input.evaluationId));
    } else {
      await tx.update(memberEvaluations).set({ headScore: String(score), status: "HEAD_REVIEW", updatedAt: now }).where(eq(memberEvaluations.id, input.evaluationId));
    }
    const periodStatus = await refreshPeriodWorkflowState(tx, scope.periodId, input.actorUserId);
    const nextStatus = input.layer === "LEADER" ? "LEADER_REVIEW" as const : "HEAD_REVIEW" as const;
    await appendAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: input.layer === "LEADER" ? "LEADER_REVIEW_COMPLETED" : "DEPARTMENT_HEAD_REVIEW_COMPLETED",
      entityType: "member_evaluation",
      entityId: input.evaluationId,
      before: { status: scope.status, score: input.layer === "LEADER" ? numeric(scope.systemScore) : numeric(scope.leaderScore) },
      after: { status: nextStatus, score, periodStatus },
      metadata: { adjustedCriterionCount: input.adjustments.length, periodId: scope.periodId, memberId: scope.memberId, teamId: scope.resolvedTeamId },
    });
    return { evaluationId: input.evaluationId, layer: input.layer, score, status: nextStatus, periodStatus };
  });
}

async function resolveFinalRank(tx: DbTransaction, rankSchemeId: string | null, score: number) {
  if (!rankSchemeId) return { rank: null as string | null, coefficient: null as number | null };
  const schemeRows = await tx.select({ id: rankSchemes.id }).from(rankSchemes).where(eq(rankSchemes.id, rankSchemeId)).limit(1);
  if (!schemeRows[0]) throw new ApiError(409, "RANK_SCHEME_NOT_FOUND", "Evaluation period rank scheme no longer resolves.");
  const bands = await tx.select({
    rank: rankBands.rank,
    coefficient: rankBands.coefficient,
    minScore: rankBands.minScore,
    maxScore: rankBands.maxScore,
    minInclusive: rankBands.minInclusive,
    maxInclusive: rankBands.maxInclusive,
  }).from(rankBands).where(eq(rankBands.rankSchemeId, rankSchemeId)).orderBy(asc(rankBands.position));
  try {
    return resolveRank(score, bands.map((band) => ({
      rank: band.rank,
      coefficient: Number(band.coefficient),
      minScore: band.minScore === null ? null : Number(band.minScore),
      maxScore: band.maxScore === null ? null : Number(band.maxScore),
      minInclusive: band.minInclusive,
      maxInclusive: band.maxInclusive,
    })));
  } catch (error) {
    lifecycleError(error);
  }
}

export async function finalizeEvaluation(input: {
  organizationId: string;
  evaluationId: string;
  actorUserId: string;
  actorRole: AppRole;
  requestId?: string;
}) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.evaluationId}))`);
    const scope = await evaluationScope(tx, input.organizationId, input.evaluationId);
    await assertDepartmentReviewScope(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      onDate: scope.periodStartsOn,
      targetTeamId: scope.resolvedTeamId,
    });
    const rows = await reviewCriteria(tx, input.evaluationId);
    const unresolvedRows = await tx.select({ id: dataQualityIssues.id }).from(dataQualityIssues)
      .where(and(eq(dataQualityIssues.memberEvaluationId, input.evaluationId), eq(dataQualityIssues.severity, "CRITICAL"), sql`${dataQualityIssues.resolvedAt} is null`));
    const complete = rows.length > 0 && rows.every((row) => row.headScore !== null);
    try {
      assertCanFinalize(scope.status, unresolvedRows.length, complete);
    } catch (error) {
      lifecycleError(error);
    }

    const aggregateInput = rows.map((row) => ({
      criterionId: row.criterionId,
      maxScore: Number(row.maxScore),
      result: row.headScore === null
        ? { status: "NOT_EVALUATED" as const, reason: "Department Head score is missing." }
        : { status: "EVALUATED" as const, value: Number(row.headScore) },
    }));
    let aggregate;
    try {
      aggregate = aggregateKpi(aggregateInput, true);
    } catch (error) {
      lifecycleError(error);
    }
    if (aggregate.result.status !== "EVALUATED") throw new ApiError(409, "FINALIZATION_INCOMPLETE", aggregate.result.reason);
    const score = aggregate.result.value;
    const rank = await resolveFinalRank(tx, scope.rankSchemeId, score);
    const now = new Date();

    for (const row of rows) {
      await tx.update(criterionEvaluations).set({ finalScore: row.headScore, updatedAt: now }).where(eq(criterionEvaluations.id, row.id));
    }
    await tx.update(memberEvaluations).set({
      finalScore: String(score),
      finalRank: rank.rank,
      finalCoefficient: rank.coefficient === null ? null : String(rank.coefficient),
      status: "FINALIZED",
      finalizedAt: now,
      finalizedBy: input.actorUserId,
      updatedAt: now,
    }).where(eq(memberEvaluations.id, input.evaluationId));
    const periodStatus = await refreshPeriodWorkflowState(tx, scope.periodId, input.actorUserId);
    await appendAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: "EVALUATION_FINALIZED",
      entityType: "member_evaluation",
      entityId: input.evaluationId,
      before: { status: scope.status, headScore: numeric(scope.headScore), finalScore: numeric(scope.finalScore) },
      after: { status: "FINALIZED", finalScore: score, finalRank: rank.rank, finalCoefficient: rank.coefficient, periodStatus },
      metadata: { periodId: scope.periodId, memberId: scope.memberId, teamId: scope.resolvedTeamId, kpiVersionId: scope.kpiVersionId },
    });
    return { evaluationId: input.evaluationId, status: "FINALIZED" as const, finalScore: score, finalRank: rank.rank, finalCoefficient: rank.coefficient, periodStatus };
  });
}

async function buildSnapshotPayload(tx: DbTransaction, organizationId: string, evaluationId: string) {
  const scope = await evaluationScope(tx, organizationId, evaluationId);
  const criterionRows = await reviewCriteria(tx, evaluationId);
  const membershipRows = scope.resolvedMembershipId
    ? await tx.select({ id: teamMemberships.id, memberId: teamMemberships.memberId, teamId: teamMemberships.teamId, effectiveFrom: teamMemberships.effectiveFrom, effectiveTo: teamMemberships.effectiveTo, primary: teamMemberships.primary })
      .from(teamMemberships).where(eq(teamMemberships.id, scope.resolvedMembershipId)).limit(1)
    : [];
  const evidenceRows = await tx.select({
    id: evidence.id,
    criterionEvaluationId: evidence.criterionEvaluationId,
    type: evidence.type,
    sourceRef: evidence.sourceRef,
    title: evidence.title,
    payload: evidence.payload,
    createdBy: evidence.createdBy,
    createdAt: evidence.createdAt,
  }).from(evidence)
    .innerJoin(criterionEvaluations, eq(evidence.criterionEvaluationId, criterionEvaluations.id))
    .where(eq(criterionEvaluations.memberEvaluationId, evaluationId))
    .orderBy(asc(evidence.createdAt), asc(evidence.id));
  const adjustmentRows = await tx.select({
    id: adjustments.id,
    criterionEvaluationId: adjustments.criterionEvaluationId,
    layer: adjustments.layer,
    previousScore: adjustments.previousScore,
    newScore: adjustments.newScore,
    reason: adjustments.reason,
    actorUserId: adjustments.actorUserId,
    createdAt: adjustments.createdAt,
  }).from(adjustments)
    .innerJoin(criterionEvaluations, eq(adjustments.criterionEvaluationId, criterionEvaluations.id))
    .where(eq(criterionEvaluations.memberEvaluationId, evaluationId))
    .orderBy(asc(adjustments.createdAt), asc(adjustments.id));
  const qualityRows = await tx.select().from(dataQualityIssues).where(eq(dataQualityIssues.memberEvaluationId, evaluationId)).orderBy(asc(dataQualityIssues.createdAt), asc(dataQualityIssues.id));
  const jiraRows = await tx.select({
    id: jiraFactSnapshots.id,
    issueKey: jiraIssues.issueKey,
    facts: jiraFactSnapshots.facts,
    attribution: jiraFactSnapshots.attribution,
    capturedAt: jiraFactSnapshots.capturedAt,
  }).from(jiraFactSnapshots)
    .innerJoin(jiraIssues, eq(jiraFactSnapshots.jiraIssueId, jiraIssues.id))
    .where(eq(jiraFactSnapshots.memberEvaluationId, evaluationId))
    .orderBy(asc(jiraFactSnapshots.capturedAt), asc(jiraFactSnapshots.id));
  const rankRows = scope.rankSchemeId ? await tx.select({
    rank: rankBands.rank,
    minScore: rankBands.minScore,
    maxScore: rankBands.maxScore,
    minInclusive: rankBands.minInclusive,
    maxInclusive: rankBands.maxInclusive,
    coefficient: rankBands.coefficient,
    position: rankBands.position,
  }).from(rankBands).where(eq(rankBands.rankSchemeId, scope.rankSchemeId)).orderBy(asc(rankBands.position)) : [];

  return {
    schema: "kpi-evaluation-snapshot/v1",
    evaluation: {
      id: scope.id,
      status: scope.status,
      systemScore: numeric(scope.systemScore),
      leaderScore: numeric(scope.leaderScore),
      headScore: numeric(scope.headScore),
      finalScore: numeric(scope.finalScore),
      finalRank: scope.finalRank,
      finalCoefficient: numeric(scope.finalCoefficient),
      confidence: scope.confidence,
      finalizedAt: scope.finalizedAt,
      finalizedBy: scope.finalizedBy,
    },
    period: { id: scope.periodId, key: scope.periodKey, startsOn: scope.periodStartsOn, endsOn: scope.periodEndsOn, rankSchemeId: scope.rankSchemeId },
    member: { id: scope.memberId, employeeId: scope.employeeId, name: scope.memberName, email: scope.memberEmail },
    membership: membershipRows[0] ?? null,
    team: { id: scope.resolvedTeamId, name: scope.teamName },
    kpi: { templateId: scope.templateId, templateName: scope.templateName, versionId: scope.kpiVersionId, version: scope.kpiVersion },
    criteria: criterionRows.map((row) => ({
      criterionEvaluationId: row.id,
      criterionId: row.criterionId,
      name: row.name,
      description: row.description,
      position: row.position,
      maxScore: Number(row.maxScore),
      method: row.method,
      evidencePolicy: row.evidencePolicy,
      adjustmentPolicy: row.adjustmentPolicy,
      metricValue: row.metricValue,
      systemScore: numeric(row.systemScore),
      leaderScore: numeric(row.leaderScore),
      headScore: numeric(row.headScore),
      finalScore: numeric(row.finalScore),
      confidence: row.confidence,
      explanationTrace: row.explanationTrace,
      evidence: evidenceRows.filter((item) => item.criterionEvaluationId === row.id),
      adjustments: adjustmentRows.filter((item) => item.criterionEvaluationId === row.id).map((item) => ({ ...item, previousScore: numeric(item.previousScore), newScore: Number(item.newScore) })),
      qualityIssues: qualityRows.filter((item) => item.criterionEvaluationId === row.id),
    })),
    memberQualityIssues: qualityRows.filter((item) => item.criterionEvaluationId === null),
    jiraFacts: jiraRows,
    rankBands: rankRows.map((row) => ({ ...row, minScore: row.minScore === null ? null : Number(row.minScore), maxScore: row.maxScore === null ? null : Number(row.maxScore), coefficient: Number(row.coefficient) })),
  };
}

export async function resolveQualityIssue(input: {
  organizationId: string;
  issueId: string;
  actorUserId: string;
  actorRole: AppRole;
  disposition: "RESOLVED" | "WAIVED";
  reason: string;
  requestId?: string;
}) {
  return getDb().transaction(async (tx) => {
    const issueRows = await tx.select({
      id: dataQualityIssues.id,
      memberEvaluationId: dataQualityIssues.memberEvaluationId,
      severity: dataQualityIssues.severity,
      resolvedAt: dataQualityIssues.resolvedAt,
    }).from(dataQualityIssues).where(eq(dataQualityIssues.id, input.issueId)).limit(1);
    const issue = issueRows[0];
    if (!issue?.memberEvaluationId) throw new ApiError(404, "QUALITY_ISSUE_NOT_FOUND", "Data-quality issue was not found on a member evaluation.");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${issue.memberEvaluationId}))`);
    const scope = await evaluationScope(tx, input.organizationId, issue.memberEvaluationId);
    await assertDepartmentReviewScope(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      onDate: scope.periodStartsOn,
      targetTeamId: scope.resolvedTeamId,
    });
    if (scope.status === "FINALIZED" || scope.status === "LOCKED") {
      throw new ApiError(409, "QUALITY_RESOLUTION_FROZEN", "Data-quality issues cannot change after finalization.");
    }
    if (issue.resolvedAt) throw new ApiError(409, "QUALITY_ISSUE_ALREADY_RESOLVED", "Data-quality issue has already been resolved or waived.");
    const now = new Date();
    const rows = await tx.update(dataQualityIssues).set({
      resolvedAt: now,
      resolutionDisposition: input.disposition,
      resolutionReason: input.reason.trim(),
      resolvedBy: input.actorUserId,
    }).where(eq(dataQualityIssues.id, input.issueId)).returning({
      id: dataQualityIssues.id,
      resolvedAt: dataQualityIssues.resolvedAt,
      resolutionDisposition: dataQualityIssues.resolutionDisposition,
      resolutionReason: dataQualityIssues.resolutionReason,
      resolvedBy: dataQualityIssues.resolvedBy,
    });
    const resolved = rows[0];
    if (!resolved) throw new ApiError(500, "QUALITY_RESOLUTION_PERSIST_FAILED", "Data-quality resolution could not be persisted.");
    await appendAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: input.disposition === "WAIVED" ? "DATA_QUALITY_WAIVED" : "DATA_QUALITY_RESOLVED",
      entityType: "data_quality_issue",
      entityId: input.issueId,
      before: { severity: issue.severity, resolvedAt: issue.resolvedAt },
      after: { resolutionDisposition: resolved.resolutionDisposition, resolvedAt: resolved.resolvedAt, resolvedBy: resolved.resolvedBy },
      reason: input.reason,
      metadata: { evaluationId: issue.memberEvaluationId, periodId: scope.periodId, memberId: scope.memberId },
    });
    return resolved;
  });
}

export async function lockEvaluation(input: {
  organizationId: string;
  evaluationId: string;
  actorUserId: string;
  actorRole: AppRole;
  requestId?: string;
}) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.evaluationId}))`);
    const scope = await evaluationScope(tx, input.organizationId, input.evaluationId);
    await assertDepartmentReviewScope(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      onDate: scope.periodStartsOn,
      targetTeamId: scope.resolvedTeamId,
    });
    if (scope.status !== "FINALIZED") throw new ApiError(409, "INVALID_LOCK_STAGE", "Only a finalized evaluation can be locked.");
    const existing = await tx.select({ id: historicalSnapshots.id }).from(historicalSnapshots).where(eq(historicalSnapshots.memberEvaluationId, input.evaluationId)).limit(1);
    if (existing[0]) throw new ApiError(409, "HISTORICAL_SNAPSHOT_EXISTS", "A historical snapshot already exists for this evaluation.");

    const payload = await buildSnapshotPayload(tx, input.organizationId, input.evaluationId);
    const checksum = snapshotChecksum(payload);
    const snapshotRows = await tx.insert(historicalSnapshots).values({
      memberEvaluationId: input.evaluationId,
      snapshotVersion: 1,
      payload,
      lockedBy: input.actorUserId,
      checksum,
    }).returning({ id: historicalSnapshots.id, lockedAt: historicalSnapshots.lockedAt });
    const snapshot = snapshotRows[0];
    if (!snapshot) throw new ApiError(500, "SNAPSHOT_PERSIST_FAILED", "Historical snapshot could not be persisted.");
    try {
      assertCanLock(scope.status, true);
    } catch (error) {
      lifecycleError(error);
    }
    const now = snapshot.lockedAt;
    await tx.update(memberEvaluations).set({ status: "LOCKED", lockedAt: now, updatedAt: now }).where(eq(memberEvaluations.id, input.evaluationId));
    const periodStatus = await refreshPeriodWorkflowState(tx, scope.periodId, input.actorUserId);
    await appendAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: "EVALUATION_LOCKED",
      entityType: "member_evaluation",
      entityId: input.evaluationId,
      before: { status: scope.status, finalScore: numeric(scope.finalScore), finalRank: scope.finalRank },
      after: { status: "LOCKED", snapshotId: snapshot.id, checksum, lockedAt: now, periodStatus },
      metadata: { periodId: scope.periodId, memberId: scope.memberId, teamId: scope.resolvedTeamId, kpiVersionId: scope.kpiVersionId },
    });
    return { evaluationId: input.evaluationId, status: "LOCKED" as const, snapshotId: snapshot.id, checksum, lockedAt: now, periodStatus };
  });
}
