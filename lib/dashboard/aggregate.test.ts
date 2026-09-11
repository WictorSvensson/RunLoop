import { describe, it, expect } from "vitest";
import type { Activity } from "@/generated/prisma/client";
import {
  bucketWeeklyVolume,
  computeThisWeekStats,
  computeConsistency,
  computePaceTrend,
  computeVolumeChange,
  windowStartUTC,
} from "@/lib/dashboard/aggregate";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let idCounter = 0;

/**
 * Builds a minimal Activity-shaped object. Only fields consumed by the
 * aggregate functions (startDate, distance, movingTime, averageHeartrate)
 * are meaningfully exercised; everything else is filled with harmless
 * placeholder values to satisfy the type.
 */
function makeActivity(overrides: Partial<Activity> = {}): Activity {
  idCounter += 1;
  return {
    id: `activity-${idCounter}`,
    userId: "user-1",
    stravaId: BigInt(idCounter),
    source: "STRAVA",
    externalId: String(idCounter),
    name: null,
    type: "Run",
    startDate: new Date("2024-01-01T12:00:00.000Z"),
    distance: null,
    movingTime: null,
    elapsedTime: null,
    averageSpeed: null,
    maxSpeed: null,
    averageHeartrate: null,
    maxHeartrate: null,
    totalElevationGain: null,
    startDateLocal: null,
    timezone: null,
    averageCadence: null,
    averageWatts: null,
    weightedAverageWatts: null,
    maxWatts: null,
    kilojoules: null,
    calories: null,
    averageTemp: null,
    description: null,
    gearId: null,
    gearName: null,
    deviceName: null,
    detailFetchedAt: null,
    analysisDataFetchedAt: null,
    createdAt: new Date("2024-01-01T12:00:00.000Z"),
    updatedAt: new Date("2024-01-01T12:00:00.000Z"),
    ...overrides,
  } as Activity;
}

// A fixed "now" so tests are deterministic regardless of wall-clock time.
// 2024-03-14 is a Thursday (UTC). Its Monday-UTC week start is 2024-03-11.
const NOW = new Date("2024-03-14T15:30:00.000Z");
const CURRENT_WEEK_MONDAY = new Date("2024-03-11T00:00:00.000Z");

function mondayMinusWeeks(n: number): Date {
  const d = new Date(CURRENT_WEEK_MONDAY);
  d.setUTCDate(d.getUTCDate() - n * 7);
  return d;
}

describe("bucketWeeklyVolume", () => {
  it("returns weekCount empty buckets for an empty activities array", () => {
    const result = bucketWeeklyVolume([], 8, NOW);

    expect(result.weeks).toHaveLength(8);
    expect(result.weeks.every((w) => !w.hasData)).toBe(true);
    expect(result.weeks.every((w) => w.distanceKm === 0)).toBe(true);
    expect(result.weeks.every((w) => w.runCount === 0)).toBe(true);
    expect(result.avgKmPerWeek).toBe(0);
    expect(result.currentVsAvgPct).toBeNull();
    // Labels are oldest -> newest, W1..W8.
    expect(result.weeks.map((w) => w.label)).toEqual([
      "W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8",
    ]);
    // Last bucket is the current week.
    expect(result.currentWeek.weekStart.getTime()).toBe(
      CURRENT_WEEK_MONDAY.getTime(),
    );
  });

  it("buckets all activities into a single week when they share the same week", () => {
    const activities = [
      makeActivity({
        startDate: new Date("2024-03-12T08:00:00.000Z"), // Tuesday, current week
        distance: 5000,
      }),
      makeActivity({
        startDate: new Date("2024-03-13T08:00:00.000Z"), // Wednesday, current week
        distance: 10000,
      }),
    ];

    const result = bucketWeeklyVolume(activities, 8, NOW);
    const currentWeek = result.currentWeek;

    expect(currentWeek.hasData).toBe(true);
    expect(currentWeek.runCount).toBe(2);
    expect(currentWeek.distanceKm).toBe(15); // (5000+10000)/1000

    // Every other week should remain empty.
    const otherWeeks = result.weeks.slice(0, -1);
    expect(otherWeeks.every((w) => !w.hasData)).toBe(true);
  });

  it("distributes activities spanning all 8 weeks into their own buckets", () => {
    const activities = Array.from({ length: 8 }, (_, i) =>
      makeActivity({
        // i=0 -> 7 weeks ago ... i=7 -> current week
        startDate: new Date(mondayMinusWeeks(7 - i).getTime() + 3 * 86400000),
        distance: (i + 1) * 1000, // 1km, 2km, ... 8km
      }),
    );

    const result = bucketWeeklyVolume(activities, 8, NOW);

    expect(result.weeks.every((w) => w.hasData)).toBe(true);
    expect(result.weeks.map((w) => w.distanceKm)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(result.weeks.map((w) => w.runCount)).toEqual([
      1, 1, 1, 1, 1, 1, 1, 1,
    ]);
  });

  it("marks a week with no activities as hasData:false with zero distance", () => {
    const activities = [
      makeActivity({
        startDate: mondayMinusWeeks(7), // oldest week only
        distance: 5000,
      }),
      // Week index 6 (mondayMinusWeeks(1)) intentionally left empty.
      makeActivity({
        startDate: CURRENT_WEEK_MONDAY, // current week
        distance: 5000,
      }),
    ];

    const result = bucketWeeklyVolume(activities, 8, NOW);

    const emptyWeek = result.weeks[6]; // second-to-last week (1 week ago)
    expect(emptyWeek.hasData).toBe(false);
    expect(emptyWeek.distanceKm).toBe(0);
    expect(emptyWeek.runCount).toBe(0);
  });

  it("buckets a Sunday 23:00 UTC activity into the prior week, not the next Monday's week", () => {
    // Sunday 2024-03-10 23:00 UTC belongs to the week starting Mon 2024-03-04,
    // NOT the week starting Mon 2024-03-11 (the following day).
    const sundayNightActivity = makeActivity({
      startDate: new Date("2024-03-10T23:00:00.000Z"),
      distance: 4000,
    });
    // Monday 2024-03-11 00:00:00.000 UTC (exact boundary) belongs to the
    // current week.
    const mondayMidnightActivity = makeActivity({
      startDate: new Date("2024-03-11T00:00:00.000Z"),
      distance: 6000,
    });

    const result = bucketWeeklyVolume(
      [sundayNightActivity, mondayMidnightActivity],
      8,
      NOW,
    );

    const priorWeek = result.weeks[6]; // week starting 2024-03-04
    const currentWeek = result.currentWeek; // week starting 2024-03-11

    expect(priorWeek.weekStart.toISOString()).toBe(
      "2024-03-04T00:00:00.000Z",
    );
    expect(priorWeek.hasData).toBe(true);
    expect(priorWeek.distanceKm).toBe(4);
    expect(priorWeek.runCount).toBe(1);

    expect(currentWeek.weekStart.toISOString()).toBe(
      "2024-03-11T00:00:00.000Z",
    );
    expect(currentWeek.hasData).toBe(true);
    expect(currentWeek.distanceKm).toBe(6);
    expect(currentWeek.runCount).toBe(1);
  });

  it("ignores activities outside the requested window", () => {
    const tooOld = makeActivity({
      startDate: mondayMinusWeeks(20),
      distance: 9999,
    });
    const result = bucketWeeklyVolume([tooOld], 8, NOW);
    expect(result.weeks.every((w) => !w.hasData)).toBe(true);
  });

  it("computes avgKmPerWeek across all prior calendar weeks (rest weeks count as zero), excluding current week, rounded to 1 decimal", () => {
    const activities = [
      makeActivity({ startDate: mondayMinusWeeks(2), distance: 10333 }), // 10.333 -> 10.3km
      makeActivity({ startDate: mondayMinusWeeks(1), distance: 20666 }), // 20.666 -> 20.7km
      makeActivity({ startDate: CURRENT_WEEK_MONDAY, distance: 5000 }), // current week, excluded from avg
    ];

    // weekCount 3 -> exactly 2 prior weeks, both with data, so the average
    // isn't diluted by any additional zero weeks and is easy to verify by hand.
    const result = bucketWeeklyVolume(activities, 3, NOW);

    // avg of 10.3 and 20.7 = 15.5
    expect(result.avgKmPerWeek).toBe(15.5);
  });

  it("counts weeks with no activity as zero distance in the average (does not silently exclude them)", () => {
    const activities = [
      makeActivity({ startDate: mondayMinusWeeks(1), distance: 20000 }), // 20km
      // mondayMinusWeeks(2) has no activity at all -> counts as 0km, not excluded.
      makeActivity({ startDate: CURRENT_WEEK_MONDAY, distance: 5000 }),
    ];

    const result = bucketWeeklyVolume(activities, 3, NOW);

    // avg of 20 and 0 = 10, NOT 20 (which is what excluding the empty week would give)
    expect(result.avgKmPerWeek).toBe(10);
  });

  it("returns currentVsAvgPct = null when there is no prior-week data (avg is 0)", () => {
    const activities = [
      makeActivity({ startDate: CURRENT_WEEK_MONDAY, distance: 5000 }),
    ];
    const result = bucketWeeklyVolume(activities, 8, NOW);
    expect(result.avgKmPerWeek).toBe(0);
    expect(result.currentVsAvgPct).toBeNull();
  });

  it("computes currentVsAvgPct correctly for a week above and below average", () => {
    // weekCount 2 -> exactly 1 prior week, so avg == that week's distance.
    // Prior week = 10km, current week = 15km -> +50%
    const above = bucketWeeklyVolume(
      [
        makeActivity({ startDate: mondayMinusWeeks(1), distance: 10000 }),
        makeActivity({ startDate: CURRENT_WEEK_MONDAY, distance: 15000 }),
      ],
      2,
      NOW,
    );
    expect(above.currentVsAvgPct).toBe(50);

    // Prior week = 10km, current week = 5km -> -50%
    const below = bucketWeeklyVolume(
      [
        makeActivity({ startDate: mondayMinusWeeks(1), distance: 10000 }),
        makeActivity({ startDate: CURRENT_WEEK_MONDAY, distance: 5000 }),
      ],
      2,
      NOW,
    );
    expect(below.currentVsAvgPct).toBe(-50);
  });
});

describe("computeThisWeekStats", () => {
  it("returns zeros and null avgHeartrate for an empty activities array", () => {
    const stats = computeThisWeekStats([], NOW);
    expect(stats.distanceKm).toBe(0);
    expect(stats.runCount).toBe(0);
    expect(stats.movingTimeSeconds).toBe(0);
    expect(stats.avgHeartrate).toBeNull();
  });

  it("only includes activities from the current Monday-UTC week", () => {
    const thisWeekActivity = makeActivity({
      startDate: new Date("2024-03-13T08:00:00.000Z"),
      distance: 5000,
      movingTime: 1500,
    });
    const lastWeekActivity = makeActivity({
      startDate: new Date("2024-03-08T08:00:00.000Z"),
      distance: 8000,
      movingTime: 2000,
    });

    const stats = computeThisWeekStats(
      [thisWeekActivity, lastWeekActivity],
      NOW,
    );

    expect(stats.runCount).toBe(1);
    expect(stats.distanceKm).toBe(5);
    expect(stats.movingTimeSeconds).toBe(1500);
  });

  it("computes avg HR ignoring activities with null averageHeartrate", () => {
    const activities = [
      makeActivity({
        startDate: CURRENT_WEEK_MONDAY,
        averageHeartrate: 140,
      }),
      makeActivity({
        startDate: CURRENT_WEEK_MONDAY,
        averageHeartrate: null,
      }),
      makeActivity({
        startDate: CURRENT_WEEK_MONDAY,
        averageHeartrate: 160,
      }),
    ];

    const stats = computeThisWeekStats(activities, NOW);

    // Average of 140 and 160 only (null excluded) = 150
    expect(stats.avgHeartrate).toBe(150);
    expect(stats.runCount).toBe(3);
  });

  it("returns null avgHeartrate when all activities in the week lack HR data", () => {
    const activities = [
      makeActivity({ startDate: CURRENT_WEEK_MONDAY, averageHeartrate: null }),
    ];
    const stats = computeThisWeekStats(activities, NOW);
    expect(stats.avgHeartrate).toBeNull();
  });

  it("treats null distance and movingTime as zero rather than throwing", () => {
    const activities = [
      makeActivity({
        startDate: CURRENT_WEEK_MONDAY,
        distance: null,
        movingTime: null,
      }),
    ];
    const stats = computeThisWeekStats(activities, NOW);
    expect(stats.distanceKm).toBe(0);
    expect(stats.movingTimeSeconds).toBe(0);
    expect(stats.runCount).toBe(1);
  });

  it("rounds distanceKm to 1 decimal place", () => {
    const activities = [
      makeActivity({ startDate: CURRENT_WEEK_MONDAY, distance: 1234 }), // 1.234km -> 1.2km
    ];
    const stats = computeThisWeekStats(activities, NOW);
    expect(stats.distanceKm).toBe(1.2);
  });

  it("rounds avgHeartrate to the nearest integer", () => {
    const activities = [
      makeActivity({ startDate: CURRENT_WEEK_MONDAY, averageHeartrate: 140 }),
      makeActivity({ startDate: CURRENT_WEEK_MONDAY, averageHeartrate: 141 }),
    ];
    const stats = computeThisWeekStats(activities, NOW);
    // (140+141)/2 = 140.5 -> rounds to 141 (banker's? Math.round -> 141)
    expect(stats.avgHeartrate).toBe(141);
  });

  it("handles a Sunday 23:00 UTC activity as belonging to the prior week (excluded from current week stats)", () => {
    const sundayNightActivity = makeActivity({
      startDate: new Date("2024-03-10T23:00:00.000Z"), // prior week
      distance: 4000,
    });
    const mondayMidnightActivity = makeActivity({
      startDate: new Date("2024-03-11T00:00:00.000Z"), // current week boundary
      distance: 6000,
    });

    const stats = computeThisWeekStats(
      [sundayNightActivity, mondayMidnightActivity],
      NOW,
    );

    expect(stats.runCount).toBe(1);
    expect(stats.distanceKm).toBe(6);
  });
});

describe("computeConsistency", () => {
  it("returns zeros for an empty activities array", () => {
    const result = computeConsistency([], 8);
    expect(result.totalRuns).toBe(0);
    expect(result.avgRunsPerWeek).toBe(0);
    expect(result.barWidthPct).toBe(0);
  });

  it("computes avgRunsPerWeek as totalRuns / weekCount", () => {
    const activities = Array.from({ length: 10 }, () => makeActivity());
    const result = computeConsistency(activities, 4);
    expect(result.totalRuns).toBe(10);
    expect(result.avgRunsPerWeek).toBe(2.5); // 10 / 4
  });

  it("scales barWidthPct against a 7-runs/week ceiling, capped at 100", () => {
    // 3.5 runs/week -> 3.5/7 = 50%
    const halfCeiling = computeConsistency(
      Array.from({ length: 14 }, () => makeActivity()),
      4,
    );
    expect(halfCeiling.avgRunsPerWeek).toBe(3.5);
    expect(halfCeiling.barWidthPct).toBe(50);

    // 14 runs/week average (2x the 7/week ceiling) -> capped at 100, not 200.
    const overCeiling = computeConsistency(
      Array.from({ length: 56 }, () => makeActivity()),
      4,
    );
    expect(overCeiling.avgRunsPerWeek).toBe(14);
    expect(overCeiling.barWidthPct).toBe(100);
  });
});

describe("computePaceTrend", () => {
  it("returns hasData:false and all-null fields for an empty activities array", () => {
    const result = computePaceTrend([], 4, NOW);
    expect(result.hasData).toBe(false);
    expect(result.avgPaceSecPerKm).toBeNull();
    expect(result.earlierAvgSecPerKm).toBeNull();
    expect(result.laterAvgSecPerKm).toBeNull();
    expect(result.deltaSecPerKm).toBeNull();
  });

  it("ignores activities missing distance or movingTime rather than throwing", () => {
    const activities = [
      makeActivity({
        startDate: CURRENT_WEEK_MONDAY,
        distance: null,
        movingTime: 1000,
      }),
      makeActivity({
        startDate: CURRENT_WEEK_MONDAY,
        distance: 1000,
        movingTime: null,
      }),
    ];
    const result = computePaceTrend(activities, 4, NOW);
    expect(result.hasData).toBe(false);
    expect(result.avgPaceSecPerKm).toBeNull();
  });

  it("computes a distance-weighted average pace across the whole window", () => {
    // 5km in 1500s (300 s/km) + 10km in 3600s (360 s/km)
    // weighted: (1500+3600) / (5+10) = 5100/15 = 340 s/km
    const activities = [
      makeActivity({
        startDate: CURRENT_WEEK_MONDAY,
        distance: 5000,
        movingTime: 1500,
      }),
      makeActivity({
        startDate: mondayMinusWeeks(3),
        distance: 10000,
        movingTime: 3600,
      }),
    ];
    const result = computePaceTrend(activities, 4, NOW);
    expect(result.avgPaceSecPerKm).toBe(340);
  });

  it("splits the window in half (weekCount=4 -> weeks -3,-2 earlier; -1,0 later) and computes a negative delta for faster later pace", () => {
    // Earlier half (weeks -3,-2): 5km in 1800s -> 360 s/km
    const earlier = makeActivity({
      startDate: mondayMinusWeeks(3),
      distance: 5000,
      movingTime: 1800,
    });
    // Later half (weeks -1,0): 5km in 1500s -> 300 s/km (faster)
    const later = makeActivity({
      startDate: mondayMinusWeeks(1),
      distance: 5000,
      movingTime: 1500,
    });

    const result = computePaceTrend([earlier, later], 4, NOW);

    expect(result.earlierAvgSecPerKm).toBe(360);
    expect(result.laterAvgSecPerKm).toBe(300);
    expect(result.deltaSecPerKm).toBe(-60); // faster -> negative delta
  });

  it("returns null earlier/later averages when one half of the window has no data, but still computes the overall average", () => {
    const onlyLater = makeActivity({
      startDate: CURRENT_WEEK_MONDAY,
      distance: 5000,
      movingTime: 1500,
    });
    const result = computePaceTrend([onlyLater], 4, NOW);

    expect(result.earlierAvgSecPerKm).toBeNull();
    expect(result.laterAvgSecPerKm).toBe(300);
    expect(result.deltaSecPerKm).toBeNull(); // can't compute a delta without both halves
    expect(result.avgPaceSecPerKm).toBe(300); // overall average still works
    expect(result.earlierRunCount).toBe(0);
    expect(result.laterRunCount).toBe(1);
  });

  it("ignores activities outside the requested window", () => {
    const tooOld = makeActivity({
      startDate: mondayMinusWeeks(20),
      distance: 5000,
      movingTime: 1500,
    });
    const result = computePaceTrend([tooOld], 4, NOW);
    expect(result.hasData).toBe(false);
  });
});

describe("computeVolumeChange", () => {
  it("returns hasData:false and zeroed averages for an empty activities array", () => {
    const result = computeVolumeChange([], 4, NOW);
    expect(result.hasData).toBe(false);
    expect(result.earlierAvgKmPerWeek).toBe(0);
    expect(result.laterAvgKmPerWeek).toBe(0);
    expect(result.deltaPct).toBeNull();
  });

  it("computes earlier/later avg km per week and a correct delta percentage", () => {
    // weekCount=4 -> earlierWeeks=2, laterWeeks=2.
    // Earlier half (weeks -3,-2): 20km total -> 10 km/week avg.
    // Later half (weeks -1,0): 30km total -> 15 km/week avg.
    // delta = (15-10)/10 * 100 = +50%
    const activities = [
      makeActivity({ startDate: mondayMinusWeeks(3), distance: 20000 }),
      makeActivity({ startDate: mondayMinusWeeks(1), distance: 15000 }),
      makeActivity({ startDate: CURRENT_WEEK_MONDAY, distance: 15000 }),
    ];

    const result = computeVolumeChange(activities, 4, NOW);

    expect(result.earlierAvgKmPerWeek).toBe(10);
    expect(result.laterAvgKmPerWeek).toBe(15);
    expect(result.deltaPct).toBe(50);
    expect(result.earlierRunCount).toBe(1);
    expect(result.laterRunCount).toBe(2);
  });

  it("returns deltaPct = null when the earlier half has zero distance (can't express % change from zero)", () => {
    const activities = [
      makeActivity({ startDate: CURRENT_WEEK_MONDAY, distance: 10000 }),
    ];
    const result = computeVolumeChange(activities, 4, NOW);
    expect(result.earlierAvgKmPerWeek).toBe(0);
    expect(result.deltaPct).toBeNull();
    // Distinguishes "zero earlier, zero later" from "zero earlier, some
    // later" (started running mid-window) — callers should NOT describe
    // this as "steady", since laterAvgKmPerWeek is non-zero.
    expect(result.earlierRunCount).toBe(0);
    expect(result.laterRunCount).toBe(1);
    expect(result.laterAvgKmPerWeek).toBeGreaterThan(0);
  });

  it("ignores activities outside the requested window", () => {
    const tooOld = makeActivity({
      startDate: mondayMinusWeeks(20),
      distance: 9999,
    });
    const result = computeVolumeChange([tooOld], 4, NOW);
    expect(result.hasData).toBe(false);
  });
});

describe("windowStartUTC", () => {
  it("returns the Monday-UTC start of a weekCount-week window ending with the current week", () => {
    // weekCount=8 -> current week start minus 7 weeks.
    const result = windowStartUTC(8, NOW);
    expect(result.toISOString()).toBe(mondayMinusWeeks(7).toISOString());
  });

  it("is used identically by bucketWeeklyVolume's oldest bucket boundary", () => {
    // Sanity check that this shared helper agrees with bucketWeeklyVolume's
    // own internal window-start math (they must never drift apart).
    const result = bucketWeeklyVolume([], 8, NOW);
    expect(result.weeks[0].weekStart.getTime()).toBe(
      windowStartUTC(8, NOW).getTime(),
    );
  });
});
