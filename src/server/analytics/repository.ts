import { and, asc, eq } from "drizzle-orm";
import type { AppRole } from "@/server/auth/types";
import { getDb } from "@/server/db/client";
import { departments, evaluationPeriods, memberEvaluations, members, teams } from "@/server/db/schema";
import { ApiError } from "@/server/http";
import { buildHistoricalAnalytics } from "./history";

export async function getHistoricalAnalytics(input: { organizationId: string; actorUserId: string; actorRole: AppRole }) {
  const organizationWide = input.actorRole === "ADMINISTRATOR" || input.actorRole === "DEPARTMENT_HEAD";
  const conditions = [eq(evaluationPeriods.organizationId, input.organizationId)];
  if (!organizationWide) conditions.push(eq(members.userId, input.actorUserId));

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
    return buildHistoricalAnalytics(rows, organizationWide ? "ORGANIZATION" : "SELF");
  } catch (error) {
    if (error instanceof Error) throw new ApiError(409, "HISTORICAL_DATA_CORRUPT", error.message);
    throw error;
  }
}
