import { ApiError } from "@/server/http";

interface DatabaseErrorLike {
  code?: unknown;
  constraint_name?: unknown;
  constraint?: unknown;
  cause?: unknown;
}

function databaseErrorChain(error: unknown): DatabaseErrorLike[] {
  const chain: DatabaseErrorLike[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current) && chain.length < 8) {
    seen.add(current);
    const candidate = current as DatabaseErrorLike;
    chain.push(candidate);
    current = candidate.cause;
  }
  return chain;
}

export function isUniqueViolation(error: unknown): boolean {
  return databaseErrorChain(error).some((candidate) => candidate.code === "23505");
}

export function databaseConstraintName(error: unknown): string | null {
  for (const candidate of databaseErrorChain(error)) {
    const value = candidate.constraint_name ?? candidate.constraint;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

export function mapUniqueViolation(error: unknown, fallbackMessage: string): never {
  if (!isUniqueViolation(error)) throw error;
  throw new ApiError(409, "CONFLICT", fallbackMessage, {
    constraint: databaseConstraintName(error),
  });
}
