export interface DateRange {
  effectiveFrom: string;
  effectiveTo: string | null;
}

function endOrInfinity(value: string | null): string {
  return value ?? "9999-12-31";
}

export function dateRangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.effectiveFrom <= endOrInfinity(b.effectiveTo) && b.effectiveFrom <= endOrInfinity(a.effectiveTo);
}

export function assertNoPrimaryMembershipOverlap(candidate: DateRange, existing: DateRange[]): void {
  if (existing.some((row) => dateRangesOverlap(candidate, row))) {
    throw new Error("Primary team membership overlaps an existing primary membership.");
  }
}
