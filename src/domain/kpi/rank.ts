import type { RankBand, RankResolution } from "./types";

export class RankSchemeError extends Error {}

function contains(band: RankBand, score: number): boolean {
  const lower = band.minScore === null || (band.minInclusive ? score >= band.minScore : score > band.minScore);
  const upper = band.maxScore === null || (band.maxInclusive ? score <= band.maxScore : score < band.maxScore);
  return lower && upper;
}

function normalizeBoundary(value: number | null, fallback: number): number {
  return value === null ? fallback : value;
}

export function validateRankScheme(bands: RankBand[]): void {
  if (bands.length === 0) throw new RankSchemeError("Rank scheme must contain at least one band.");

  for (const band of bands) {
    if (!Number.isFinite(band.coefficient)) throw new RankSchemeError(`Rank '${band.rank}' has an invalid coefficient.`);
    if (band.minScore !== null && (!Number.isFinite(band.minScore) || band.minScore < 0 || band.minScore > 10)) {
      throw new RankSchemeError(`Rank '${band.rank}' has an invalid minimum score.`);
    }
    if (band.maxScore !== null && (!Number.isFinite(band.maxScore) || band.maxScore < 0 || band.maxScore > 10)) {
      throw new RankSchemeError(`Rank '${band.rank}' has an invalid maximum score.`);
    }
    if (band.minScore !== null && band.maxScore !== null && band.minScore > band.maxScore) {
      throw new RankSchemeError(`Rank '${band.rank}' has an inverted range.`);
    }
  }

  const sorted = [...bands].sort((a, b) => normalizeBoundary(a.minScore, 0) - normalizeBoundary(b.minScore, 0));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (first.minScore !== null && (first.minScore > 0 || (first.minScore === 0 && !first.minInclusive))) {
    throw new RankSchemeError("Rank scheme has a gap at the lower boundary.");
  }
  if (last.maxScore !== null && (last.maxScore < 10 || (last.maxScore === 10 && !last.maxInclusive))) {
    throw new RankSchemeError("Rank scheme has a gap at the upper boundary.");
  }

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const currentMax = current.maxScore ?? 10;
    const nextMin = next.minScore ?? 0;

    if (currentMax > nextMin) {
      throw new RankSchemeError(`Rank bands '${current.rank}' and '${next.rank}' overlap.`);
    }
    if (currentMax < nextMin) {
      throw new RankSchemeError(`Rank scheme has a gap between '${current.rank}' and '${next.rank}'.`);
    }
    if (currentMax === nextMin) {
      if (current.maxInclusive && next.minInclusive) {
        throw new RankSchemeError(`Rank bands '${current.rank}' and '${next.rank}' overlap at ${currentMax}.`);
      }
      if (!current.maxInclusive && !next.minInclusive) {
        throw new RankSchemeError(`Rank scheme has a gap at ${currentMax}.`);
      }
    }
  }

  for (const score of [0, 10]) {
    const matches = sorted.filter((band) => contains(band, score));
    if (matches.length !== 1) throw new RankSchemeError(`Rank scheme must resolve score ${score} exactly once.`);
  }
}

export function resolveRank(score: number, bands: RankBand[]): RankResolution {
  if (!Number.isFinite(score) || score < 0 || score > 10) throw new RankSchemeError("Score must be within 0..10.");
  validateRankScheme(bands);
  const matches = bands.filter((band) => contains(band, score));
  if (matches.length !== 1) throw new RankSchemeError(`Score ${score} must resolve to exactly one rank.`);
  return { rank: matches[0].rank, coefficient: matches[0].coefficient };
}
