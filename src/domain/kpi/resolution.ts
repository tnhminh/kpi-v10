import type { EffectiveMembership, KpiAssignment } from "./types";

export class ResolutionError extends Error {}

function assertIsoDate(value: string, label: string): void {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new ResolutionError(`${label} must be an ISO date (YYYY-MM-DD).`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const valid = parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  if (!valid) throw new ResolutionError(`${label} must be a real calendar date.`);
}

function activeOn(row: EffectiveMembership, date: string): boolean {
  assertIsoDate(row.effectiveFrom, `Membership '${row.id}' effectiveFrom`);
  if (row.effectiveTo !== null) {
    assertIsoDate(row.effectiveTo, `Membership '${row.id}' effectiveTo`);
    if (row.effectiveTo < row.effectiveFrom) throw new ResolutionError(`Membership '${row.id}' has an invalid effective range.`);
  }
  return row.effectiveFrom <= date && (row.effectiveTo === null || row.effectiveTo >= date);
}

export function resolvePrimaryMembership(memberId: string, onDate: string, memberships: EffectiveMembership[]): EffectiveMembership {
  assertIsoDate(onDate, "Resolution date");
  const matches = memberships.filter((row) => row.memberId === memberId && row.primary && activeOn(row, onDate));
  if (matches.length === 0) throw new ResolutionError(`No primary team membership exists for member '${memberId}' on ${onDate}.`);
  if (matches.length > 1) throw new ResolutionError(`Multiple primary team memberships exist for member '${memberId}' on ${onDate}.`);
  return matches[0];
}

export function resolveKpiAssignment(periodId: string, teamId: string, assignments: KpiAssignment[]): KpiAssignment {
  const matches = assignments.filter((row) => row.periodId === periodId && row.teamId === teamId);
  if (matches.length === 0) throw new ResolutionError(`No KPI assignment exists for team '${teamId}' in period '${periodId}'.`);
  if (matches.length > 1) throw new ResolutionError(`Multiple KPI assignments exist for team '${teamId}' in period '${periodId}'.`);
  return matches[0];
}

export function resolveEvaluationConfiguration(input: {
  memberId: string;
  periodId: string;
  periodStartDate: string;
  memberships: EffectiveMembership[];
  assignments: KpiAssignment[];
}) {
  const membership = resolvePrimaryMembership(input.memberId, input.periodStartDate, input.memberships);
  const assignment = resolveKpiAssignment(input.periodId, membership.teamId, input.assignments);
  return {
    membershipId: membership.id,
    teamId: membership.teamId,
    kpiVersionId: assignment.kpiVersionId,
  };
}
