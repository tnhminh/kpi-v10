import type { EvaluationStatus } from "./types";

export class LifecycleError extends Error {}

export type RecalculationDecision =
  | { allowed: true; mode: "AUTO" | "EXPLICIT_REFRESH" }
  | { allowed: false; reason: string };

export function recalculationPolicy(status: EvaluationStatus, explicitRefresh = false): RecalculationDecision {
  switch (status) {
    case "PENDING":
    case "SYSTEM_EVALUATED":
      return { allowed: true, mode: "AUTO" };
    case "LEADER_REVIEW":
      return explicitRefresh
        ? { allowed: true, mode: "EXPLICIT_REFRESH" }
        : { allowed: false, reason: "Leader review exists; underlying data changes must not silently overwrite reviewed values." };
    case "HEAD_REVIEW":
      return { allowed: false, reason: "Department Head review has started; system recalculation requires reopening the workflow." };
    case "FINALIZED":
      return { allowed: false, reason: "Finalized evaluations must not recalculate automatically." };
    case "LOCKED":
      return { allowed: false, reason: "Locked evaluations are immutable." };
  }
}

export function assertMutable(status: EvaluationStatus): void {
  if (status === "LOCKED") throw new LifecycleError("Locked evaluations are immutable.");
}

export function assertCanFinalize(status: EvaluationStatus, unresolvedQualityIssues: number, requiredReviewsComplete: boolean): void {
  if (!Number.isInteger(unresolvedQualityIssues) || unresolvedQualityIssues < 0) throw new LifecycleError("Unresolved data-quality issue count must be a non-negative integer.");
  if (status !== "HEAD_REVIEW") throw new LifecycleError("Only an evaluation in Department Head review can be finalized.");
  if (!requiredReviewsComplete) throw new LifecycleError("Required reviews are incomplete.");
  if (unresolvedQualityIssues > 0) throw new LifecycleError("Critical data-quality issues must be resolved or explicitly waived before finalization.");
}

export function assertCanLock(status: EvaluationStatus, snapshotCreated: boolean): void {
  if (status !== "FINALIZED") throw new LifecycleError("Only finalized evaluations can be locked.");
  if (!snapshotCreated) throw new LifecycleError("A historical snapshot must exist before locking.");
}

export function validateAdjustment(input: {
  previousScore: number | null;
  newScore: number;
  maxScore: number;
  reason?: string | null;
  meaningfulDelta?: number;
}): number {
  if (!Number.isFinite(input.newScore) || input.newScore < 0 || input.newScore > input.maxScore) {
    throw new LifecycleError("Adjusted score must be within criterion bounds.");
  }
  if (!Number.isFinite(input.maxScore) || input.maxScore < 0 || input.maxScore > 10) {
    throw new LifecycleError("Criterion maximum must be within 0..10.");
  }

  const threshold = input.meaningfulDelta ?? 0.3;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 10) throw new LifecycleError("Meaningful adjustment threshold must be within 0..10.");
  if (input.previousScore !== null && (!Number.isFinite(input.previousScore) || input.previousScore < 0 || input.previousScore > input.maxScore)) {
    throw new LifecycleError("Previous score must be null or within criterion bounds.");
  }
  const delta = input.previousScore === null ? Math.abs(input.newScore) : Math.abs(input.newScore - input.previousScore);
  if (delta >= threshold && !(input.reason?.trim())) {
    throw new LifecycleError(`A reason is required for adjustments of ${threshold} or more.`);
  }
  return input.newScore;
}
