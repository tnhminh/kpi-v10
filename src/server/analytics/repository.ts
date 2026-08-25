import { and, asc, eq, sql } from "drizzle-orm";
import type { AppRole } from "@/server/auth/types";
import { getDb } from "@/server/db/client";
import { departmentHeadAssignments, departments, evaluationPeriods, memberEvaluations, members, teams } from "@/server/db/schema";
import { ApiError } from "@/server/http";
import { buildHistoricalAnalytics } from "./history";

export async function getHistoricalAnalytics(input: { organizationId: string; actorUserId: string; actorRole: AppRole }) {
  const scope = input.actorRole === "ADMINISTRATOR"
    ? "ORGANIZATION" as const
    : input.actorRole === "DEPARTMENT_HEAD"
      ? "DEPARTMENT" as const
      : "SELF" as const;
  const conditions = [eq(evaluationPeriods.organizationId, input.organizationId)];
  if (scope === "SELF") {
    conditions.push(eq(members.userId, input.actorUserId));
  } else if (scope === "DEPARTMENT") {
    conditions.push(sql`exists (
      select 1
      from ${departmentHeadAssignments}
      where ${departmentHeadAssignments.userId} = ${input.actorUserId}
        and ${departmentHeadAssignments.departmentId} = ${departments.id}
        and ${departmentHeadAssignments.effectiveFrom} <= ${evaluationPeriods.startsOn}
        and (${departmentHeadAssignments.effectiveTo} is null or ${departmentHeadAssignments.effectiveTo} >= ${evaluationPeriods.startsOn})
    )`);
  }

  const rows = await getDb().select({
    periodId: evaluationPeriods.id,
    periodKey: evaluationPeriods.key,
    startsOn: evaluationPeriods.startsOn,
    endsOn: evaluationPeriods.endsOn,
    memberId: members.id,
    memberName: members.name,
    teamId: teams.id,
    teamName: teams.name,
    status: memberEvaluations.status,
    finalScore: memberEvaluations.finalScore,
    finalRank: memberEvaluations.finalRank,
    finalCoefficient: memberEvaluations.finalCoefficient,
  }).from(memberEvaluations)
    .innerJoin(evaluationPeriods, eq(memberEvaluations.periodId, evaluationPeriods.id))
    .innerJoin(members, eq(memberEvaluations.memberId, members.id))
    .innerJoin(teams, eq(memberEvaluations.resolvedTeamId, teams.id))
    .innerJoin(departments, eq(teams.departmentId, departments.id))
    .where(and(...conditions))
    .orderBy(asc(evaluationPeriods.startsOn), asc(members.name));

  try {
    return buildHistoricalAnalytics(rows, scope);
  } catch (error) {
    if (error instanceof Error) throw new ApiError(409, "HISTORICAL_DATA_CORRUPT", error.message);
    throw error;
  }
}
