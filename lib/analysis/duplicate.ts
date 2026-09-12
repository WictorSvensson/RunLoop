// N-way duplicate detection across activity sources (SUUNTO / GARMIN).
// Shared twin test so importers can't introduce divergent copies.
// Rule: same ±10 min start window AND comparable elapsed time (±5 min).
// Type labels are NOT compared — providers disagree (treadmill→VirtualRun vs
// Run, roller_skating→InlineSkate vs NordicSki). Null elapsed on either side
// falls back to the time window alone (safer against dupes than importing).

export const DUP_START_WINDOW_S = 600;
export const DUP_ELAPSED_TOLERANCE_S = 300;

/**
 * Pure twin test over (start, elapsed) pairs. Elapsed in seconds; either may
 * be null (unknown duration degrades to window-only matching).
 */
export function isDuplicateActivity(
  startA: Date,
  elapsedA: number | null,
  startB: Date,
  elapsedB: number | null,
): boolean {
  if (Math.abs(startA.getTime() - startB.getTime()) / 1000 >= DUP_START_WINDOW_S) {
    return false;
  }
  if (elapsedA === null || elapsedB === null) return true;
  return Math.abs(elapsedA - elapsedB) <= DUP_ELAPSED_TOLERANCE_S;
}

export interface DuplicateCandidate {
  startDate: Date;
  elapsedTime: number | null;
}

/**
 * Finds the first stored candidate that twins the given session, or null.
 * The candidate set is the caller's responsibility (pass rows of the OTHER
 * source(s)); own-source rows must be excluded by the caller, otherwise
 * re-imports match themselves and freeze updates.
 */
export function findDuplicateCandidate(
  candidates: DuplicateCandidate[],
  startDate: Date,
  elapsedTime: number | null,
): DuplicateCandidate | null {
  for (const c of candidates) {
    if (isDuplicateActivity(c.startDate, c.elapsedTime, startDate, elapsedTime)) {
      return c;
    }
  }
  return null;
}
