export interface HistoricalEvaluationRow {
  periodId: string;
  periodKey: string;
  startsOn: string;
  endsOn: string;
  memberId: string;
  memberName: string;
  teamId: string;
  teamName: string;
  status: string;
  finalScore: string | number | null;
  finalRank: string | null;
  finalCoefficient: string | number | null;
}

function validFinalScore(row: HistoricalEvaluationRow): number | null {
  if (row.status !== "FINALIZED" && row.status !== "LOCKED") return null;
  if (row.finalScore === null) return null;
  const value = Number(row.finalScore);
  if (!Number.isFinite(value) || value < 0 || value > 10) throw new Error("Historical finalized score is corrupt.");
  return value;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildHistoricalAnalytics(rows: HistoricalEvaluationRow[], scope: "SELF" | "ORGANIZATION") {
  const periods = new Map<string, HistoricalEvaluationRow[]>();
  for (const row of rows) {
    const values = periods.get(row.periodId) ?? [];
    values.push(row);
    periods.set(row.periodId, values);
  }

  const series = [...periods.values()].map((periodRows) => {
    const valid = periodRows.map(validFinalScore).filter((value): value is number => value !== null);
    const representative = periodRows[0]!;
    return {
      periodId: representative.periodId,
      periodKey: representative.periodKey,
      startsOn: representative.startsOn,
      endsOn: representative.endsOn,
      score: valid.length ? round2(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null,
      validCount: valid.length,
      totalCount: periodRows.length,
      coverageLabel: `${valid.length} / ${periodRows.length} valid evaluations`,
    };
  }).sort((a, b) => a.startsOn.localeCompare(b.startsOn));

  const validRows = rows.map((row) => ({ row, score: validFinalScore(row) })).filter((item): item is { row: HistoricalEvaluationRow; score: number } => item.score !== null);
  const summaryScore = validRows.length ? round2(validRows.reduce((sum, item) => sum + item.score, 0) / validRows.length) : null;
  const rankCounts = new Map<string, number>();
  validRows.forEach(({ row }) => { if (row.finalRank) rankCounts.set(row.finalRank, (rankCounts.get(row.finalRank) ?? 0) + 1); });
  const latestValid = [...validRows].sort((a, b) => b.row.startsOn.localeCompare(a.row.startsOn))[0] ?? null;

  return {
    scope,
    summary: {
      score: summaryScore,
      validCount: validRows.length,
      totalCount: rows.length,
      coverageLabel: `${validRows.length} / ${rows.length} valid evaluations`,
    },
    latest: latestValid ? {
      periodKey: latestValid.row.periodKey,
      score: latestValid.score,
      rank: latestValid.row.finalRank,
      coefficient: latestValid.row.finalCoefficient === null ? null : Number(latestValid.row.finalCoefficient),
    } : null,
    rankDistribution: [...rankCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([rank, count]) => ({ rank, count })),
    series,
  };
}
