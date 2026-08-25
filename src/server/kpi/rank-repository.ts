import { asc, eq } from "drizzle-orm";
import { validateRankScheme } from "@/domain/kpi/rank";
import { getDb } from "@/server/db/client";
import { rankBands, rankSchemes } from "@/server/db/schema";
import { ApiError } from "@/server/http";

export async function listRankSchemes(organizationId: string) {
  const schemes = await getDb().select({
    id: rankSchemes.id,
    name: rankSchemes.name,
    active: rankSchemes.active,
    createdAt: rankSchemes.createdAt,
    updatedAt: rankSchemes.updatedAt,
  }).from(rankSchemes)
    .where(eq(rankSchemes.organizationId, organizationId))
    .orderBy(asc(rankSchemes.name));

  const result = [];
  for (const scheme of schemes) {
    const rows = await getDb().select({
      id: rankBands.id,
      rank: rankBands.rank,
      minScore: rankBands.minScore,
      maxScore: rankBands.maxScore,
      minInclusive: rankBands.minInclusive,
      maxInclusive: rankBands.maxInclusive,
      coefficient: rankBands.coefficient,
      position: rankBands.position,
    }).from(rankBands)
      .where(eq(rankBands.rankSchemeId, scheme.id))
      .orderBy(asc(rankBands.position));

    const bands = rows.map((row) => ({
      ...row,
      minScore: row.minScore === null ? null : Number(row.minScore),
      maxScore: row.maxScore === null ? null : Number(row.maxScore),
      coefficient: Number(row.coefficient),
    }));

    try {
      validateRankScheme(bands);
    } catch (error) {
      throw new ApiError(409, "RANK_SCHEME_CORRUPT", error instanceof Error ? error.message : "Stored rank scheme is invalid.");
    }
    result.push({ ...scheme, bands });
  }
  return result;
}
