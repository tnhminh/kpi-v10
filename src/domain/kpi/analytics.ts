import { resolveRank } from "./rank";
import type { HistoricalAggregate, RankBand } from "./types";

export function aggregateHistoricalFinalScores(scores: Array<number | null>, rankBands: RankBand[]): HistoricalAggregate {
  for (const score of scores) {
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 10)) {
      throw new Error("Historical final scores must be finite and within 0..10.");
    }
  }
  const valid = scores.filter((score): score is number => score !== null);

  const totalCount = scores.length;
  const validCount = valid.length;
  if (validCount === 0) {
    return { score: null, validCount, totalCount, coverageLabel: `0 / ${totalCount} valid periods`, rank: null };
  }

  const average = valid.reduce((sum, score) => sum + score, 0) / validCount;
  const rounded = Math.round((average + Number.EPSILON) * 100) / 100;
  return {
    score: rounded,
    validCount,
    totalCount,
    coverageLabel: `${validCount} / ${totalCount} valid periods`,
    rank: resolveRank(rounded, rankBands),
  };
}
