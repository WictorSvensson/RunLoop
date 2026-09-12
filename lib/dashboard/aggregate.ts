import type { Activity } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Aggregation helpers for the dashboard page. These compute simple, honest
// summaries directly from raw Activity rows — there is no precomputed stats
// table and no training-plan/target concept in the schema yet, so anything
// that would require those (e.g. a real "8-week plan" or drift-corrected
// aerobic efficiency) is intentionally left out rather than faked.
// ---------------------------------------------------------------------------

export interface WeekBucket {
  /** Monday (UTC) that starts this week. */
  weekStart: Date;
  label: string; // "W1".."W8", oldest -> newest
  distanceKm: number;
  runCount: number;
  hasData: boolean;
}

export interface WeekSummary {
  weeks: WeekBucket[]; // oldest -> newest, always length `weekCount`
  currentWeek: WeekBucket;
  avgKmPerWeek: number; // average across weeks that have data
  currentVsAvgPct: number | null; // null if no average to compare against
}

export interface ThisWeekStats {
  distanceKm: number;
  runCount: number;
  movingTimeSeconds: number;
  avgHeartrate: number | null; // null if no activities had HR data
}

export interface RecoverySnapshot {
  hasCheckin: boolean;
  sleepDurationMinutes: number | null;
  energy: number | null; // 1-5
  symptoms: string | null; // Severity enum as string, e.g. "NONE"
}

export interface ConsistencySummary {
  weekCount: number;
  totalRuns: number;
  avgRunsPerWeek: number; // rounded to 1 decimal
  // Bar-width helper: avgRunsPerWeek / 7, capped at 100. 7 is a fixed,
  // athlete-agnostic ceiling (not a personalized target) — it just gives the
  // bar a stable, honest reference scale (a run every day of the week).
  barWidthPct: number;
}

export interface PaceTrend {
  hasData: boolean;
  avgPaceSecPerKm: number | null; // overall average pace across the window
  // Comparison between the older and newer half of the window. Null fields
  // mean there wasn't enough data in one of the halves to compute a pace.
  earlierAvgSecPerKm: number | null;
  laterAvgSecPerKm: number | null;
  deltaSecPerKm: number | null; // later - earlier; negative = faster
  earlierRunCount: number;
  laterRunCount: number;
}

export interface VolumeChange {
  hasData: boolean;
  earlierAvgKmPerWeek: number; // 0 when the earlier half had no distance
  laterAvgKmPerWeek: number; // 0 when the later half had no distance
  deltaPct: number | null; // null if earlier average is 0 (can't express a %)
  earlierRunCount: number;
  laterRunCount: number;
}


// Monday-start week boundary, in UTC, matching how activities are timestamped.
// Exported so callers (e.g. the dashboard's DB query window) can derive the
// exact same boundary instead of independently reimplementing it.
export function startOfWeekUTC(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = (day + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

/**
 * Start of the Monday-UTC week that begins a `weekCount`-week window ending
 * with the current week. Exported so every caller that needs "the start of
 * an N-week window" (DB query bounds, week bucketing, half-window splitting)
 * derives it from this single formula instead of re-deriving it independently.
 */
export function windowStartUTC(weekCount: number, now: Date = new Date()): Date {
  const start = new Date(startOfWeekUTC(now));
  start.setUTCDate(start.getUTCDate() - (weekCount - 1) * 7);
  return start;
}

/**
 * Buckets activities into `weekCount` Monday-start weeks ending with the
 * current week. Weeks with no activities still appear in the output
 * (hasData: false) so the UI can render an empty state rather than skip them.
 */
export function bucketWeeklyVolume(
  activities: Activity[],
  weekCount = 8,
  now: Date = new Date(),
): WeekSummary {
  const currentWeekStart = startOfWeekUTC(now);
  const weekStarts: Date[] = [];
  for (let i = weekCount - 1; i >= 0; i--) {
    const d = new Date(currentWeekStart);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weekStarts.push(d);
  }

  const buckets: WeekBucket[] = weekStarts.map((weekStart, index) => ({
    weekStart,
    label: `W${index + 1}`,
    distanceKm: 0,
    runCount: 0,
    hasData: false,
  }));

  for (const activity of activities) {
    const activityWeekStart = startOfWeekUTC(activity.startDate).getTime();
    const bucket = buckets.find(
      (b) => b.weekStart.getTime() === activityWeekStart,
    );
    if (!bucket) continue; // outside the window we asked for
    bucket.distanceKm += (activity.distance ?? 0) / 1000;
    bucket.runCount += 1;
    bucket.hasData = true;
  }

  for (const bucket of buckets) {
    bucket.distanceKm = Math.round(bucket.distanceKm * 10) / 10;
  }

  const currentWeek = buckets[buckets.length - 1];
  // Average over all *prior calendar weeks* in the window (rest weeks count
  // as zero distance), not just weeks that happened to have activity — a
  // filtered-to-active-weeks average would overstate typical weekly volume.
  const priorWeeks = buckets.slice(0, -1);
  const avgKmPerWeek =
    priorWeeks.length > 0
      ? priorWeeks.reduce((sum, b) => sum + b.distanceKm, 0) / priorWeeks.length
      : 0;

  const currentVsAvgPct =
    avgKmPerWeek > 0
      ? Math.round(
          ((currentWeek.distanceKm - avgKmPerWeek) / avgKmPerWeek) * 1000,
        ) / 10
      : null;

  return {
    weeks: buckets,
    currentWeek,
    avgKmPerWeek: Math.round(avgKmPerWeek * 10) / 10,
    currentVsAvgPct,
  };
}

/** Stats for the current Monday-start week: distance, run count, time, avg HR. */
export function computeThisWeekStats(
  activities: Activity[],
  now: Date = new Date(),
): ThisWeekStats {
  const weekStart = startOfWeekUTC(now);
  const thisWeek = activities.filter(
    (a) => startOfWeekUTC(a.startDate).getTime() === weekStart.getTime(),
  );

  const distanceKm =
    Math.round(
      thisWeek.reduce((sum, a) => sum + (a.distance ?? 0), 0) / 100,
    ) / 10;
  const movingTimeSeconds = thisWeek.reduce(
    (sum, a) => sum + (a.movingTime ?? 0),
    0,
  );
  const hrValues = thisWeek
    .map((a) => a.averageHeartrate)
    .filter((hr): hr is number => hr != null);
  const avgHeartrate =
    hrValues.length > 0
      ? Math.round(hrValues.reduce((sum, hr) => sum + hr, 0) / hrValues.length)
      : null;

  return {
    distanceKm,
    runCount: thisWeek.length,
    movingTimeSeconds,
    avgHeartrate,
  };
}

// ---------------------------------------------------------------------------
// Analytics-page helpers. These operate over a longer rolling window (e.g.
// 12 weeks) than the Dashboard's weekly snapshot. Everything here stays
// Phase-1-deterministic per Docs/RUNLOOP_ANALYSIS_ENGINE_SPEC.md — no workout
// classification (easy/threshold/long) exists yet, so pace/volume trends are
// computed across ALL runs in the window, not just "easy" runs.
// ---------------------------------------------------------------------------

/** Splits a `weekCount`-week window (ending with the current week) into two
 * halves at a Monday-UTC boundary, for "earlier vs. later" comparisons.
 * Odd week counts give the earlier half the extra week. */
function windowHalves(
  weekCount: number,
  now: Date,
): { windowStart: Date; midStart: Date; earlierWeeks: number; laterWeeks: number } {
  const windowStart = windowStartUTC(weekCount, now);

  const earlierWeeks = Math.ceil(weekCount / 2);
  const laterWeeks = weekCount - earlierWeeks;
  const midStart = new Date(windowStart);
  midStart.setUTCDate(midStart.getUTCDate() + earlierWeeks * 7);

  return { windowStart, midStart, earlierWeeks, laterWeeks };
}

/** Distance-weighted average pace (seconds/km) across a set of activities.
 * Returns null when there's no usable distance+time data (not 0 — 0 would
 * imply "instant", which is never a real pace). */
function averagePaceSecPerKm(activities: Activity[]): number | null {
  let totalDistance = 0; // meters
  let totalTime = 0; // seconds
  for (const a of activities) {
    if (a.distance && a.distance > 0 && a.movingTime && a.movingTime > 0) {
      totalDistance += a.distance;
      totalTime += a.movingTime;
    }
  }
  if (totalDistance <= 0) return null;
  return Math.round((totalTime / (totalDistance / 1000)) * 10) / 10;
}

/** Average runs/week over the window, plus a bar-width % scaled against a
 * fixed 7-runs/week ceiling (a run every day) — not an athlete-specific
 * target, just a stable reference so the bar has a consistent meaning. */
export function computeConsistency(
  activities: Activity[],
  weekCount: number,
): ConsistencySummary {
  const totalRuns = activities.length;
  const avgRunsPerWeek = weekCount > 0 ? totalRuns / weekCount : 0;
  const barWidthPct = Math.min(
    Math.round((avgRunsPerWeek / 7) * 1000) / 10,
    100,
  );

  return {
    weekCount,
    totalRuns,
    avgRunsPerWeek: Math.round(avgRunsPerWeek * 10) / 10,
    barWidthPct,
  };
}

/** Overall average pace across the window, plus an earlier-half vs.
 * later-half comparison. All runs count (no easy/quality classification
 * exists yet), so this is deliberately labeled "average pace", not "easy
 * pace", wherever it's rendered. */
export function computePaceTrend(
  activities: Activity[],
  weekCount: number,
  now: Date = new Date(),
): PaceTrend {
  const { windowStart, midStart } = windowHalves(weekCount, now);
  const inWindow = activities.filter(
    (a) => a.startDate.getTime() >= windowStart.getTime(),
  );
  const earlier = inWindow.filter(
    (a) => a.startDate.getTime() < midStart.getTime(),
  );
  const later = inWindow.filter(
    (a) => a.startDate.getTime() >= midStart.getTime(),
  );

  const avgPaceSecPerKm = averagePaceSecPerKm(inWindow);
  const earlierAvgSecPerKm = averagePaceSecPerKm(earlier);
  const laterAvgSecPerKm = averagePaceSecPerKm(later);
  const deltaSecPerKm =
    earlierAvgSecPerKm != null && laterAvgSecPerKm != null
      ? Math.round((laterAvgSecPerKm - earlierAvgSecPerKm) * 10) / 10
      : null;

  return {
    hasData: avgPaceSecPerKm != null,
    avgPaceSecPerKm,
    earlierRunCount: earlier.length,
    laterRunCount: later.length,
    earlierAvgSecPerKm,
    laterAvgSecPerKm,
    deltaSecPerKm,
  };
}

/** Compares average weekly distance between the earlier and later half of
 * the window. `deltaPct` is null when the earlier half had zero distance
 * (a percentage change from zero is undefined, not "infinite%"). */
export function computeVolumeChange(
  activities: Activity[],
  weekCount: number,
  now: Date = new Date(),
): VolumeChange {
  const { windowStart, midStart, earlierWeeks, laterWeeks } = windowHalves(
    weekCount,
    now,
  );
  const inWindow = activities.filter(
    (a) => a.startDate.getTime() >= windowStart.getTime(),
  );

  const earlierActivities = inWindow.filter(
    (a) => a.startDate.getTime() < midStart.getTime(),
  );
  const laterActivities = inWindow.filter(
    (a) => a.startDate.getTime() >= midStart.getTime(),
  );

  const earlierKm =
    earlierActivities.reduce((sum, a) => sum + (a.distance ?? 0), 0) / 1000;
  const laterKm =
    laterActivities.reduce((sum, a) => sum + (a.distance ?? 0), 0) / 1000;

  const earlierAvgKmPerWeek = earlierWeeks > 0 ? earlierKm / earlierWeeks : 0;
  const laterAvgKmPerWeek = laterWeeks > 0 ? laterKm / laterWeeks : 0;

  const deltaPct =
    earlierAvgKmPerWeek > 0
      ? Math.round(
          ((laterAvgKmPerWeek - earlierAvgKmPerWeek) / earlierAvgKmPerWeek) *
            1000,
        ) / 10
      : null;

  return {
    hasData: inWindow.length > 0,
    earlierAvgKmPerWeek: Math.round(earlierAvgKmPerWeek * 10) / 10,
    laterAvgKmPerWeek: Math.round(laterAvgKmPerWeek * 10) / 10,
    deltaPct,
    earlierRunCount: earlierActivities.length,
    laterRunCount: laterActivities.length,
  };
}
