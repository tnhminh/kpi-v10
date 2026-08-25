import { createHash } from "node:crypto";

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

function canonicalize(value: unknown): CanonicalJson {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Historical snapshot cannot contain non-finite numbers.");
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const result: Record<string, CanonicalJson> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) continue;
      result[key] = canonicalize(item);
    }
    return result;
  }
  throw new Error(`Historical snapshot contains unsupported value type '${typeof value}'.`);
}

export function canonicalSnapshotJson(payload: unknown): string {
  return JSON.stringify(canonicalize(payload));
}

export function snapshotChecksum(payload: unknown): string {
  return createHash("sha256").update(canonicalSnapshotJson(payload), "utf8").digest("hex");
}
