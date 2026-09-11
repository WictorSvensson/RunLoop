// Garmin activity-type mapping onto Activity.type.
// Garmin uses typeKey strings (e.g. "running", "treadmill_running",
// "trail_running", "swimming", "strength_training"). Values mirror
// lib/running-types.ts RUNNING_TYPES where running so Dashboard/Analytics/
// Coach filters apply unchanged. Unknown keys fall back to "Workout"
// (visible on Training, excluded from run stats) rather than failing import.

const TYPE_KEY_TO_ACTIVITY_TYPE: Record<string, string> = {
  running: "Run",
  treadmill_running: "VirtualRun",
  indoor_running: "VirtualRun",
  trail_running: "TrailRun",
  cycling: "Ride",
  indoor_cycling: "Ride",
  mountain_biking: "Ride",
  swimming: "Swim",
  lap_swimming: "Swim",
  open_water_swimming: "Swim",
  walking: "Walk",
  indoor_walking: "Walk",
  hiking: "Hike",
  strength_training: "WeightTraining",
  cardio: "Workout",
  yoga: "Workout",
  pilates: "Workout",
  rowing: "Rowing",
  indoor_rowing: "Rowing",
  elliptical: "Elliptical",
  stair_climbing: "Workout",
  skiing: "NordicSki",
  cross_country_skiing: "NordicSki",
  snowboarding: "Snowboard",
  alpine_skiing: "AlpineSki",
  tennis: "Tennis",
  golf: "Golf",
};

/** Maps a Garmin activityType.typeKey to an Activity.type value. */
export function garminTypeKeyToActivityType(typeKey: string | null | undefined): string {
  if (!typeKey) return "Workout";
  return TYPE_KEY_TO_ACTIVITY_TYPE[typeKey] ?? "Workout";
}

/**
 * Maps a Garmin sleep overall qualifierKey (e.g. "EXCELLENT", "GOOD",
 * "FAIR", "POOR") onto the SleepQuality enum. Unknown/absent qualifiers
 * return null (honest gap) rather than a fabricated bucket.
 */
export function garminSleepQualifierToQuality(
  qualifierKey: string | null | undefined,
): "POOR" | "OKAY" | "GOOD" | "EXCELLENT" | null {
  if (!qualifierKey) return null;
  const q = qualifierKey.toUpperCase();
  if (q.includes("EXCELLENT")) return "EXCELLENT";
  if (q.includes("GOOD")) return "GOOD";
  if (q.includes("FAIR") || q.includes("OKAY") || q.includes("AVERAGE")) return "OKAY";
  if (q.includes("POOR")) return "POOR";
  return null;
}

// ---------------------------------------------------------------------------
// Pure list-summary mapping. Lives here (not import.ts) so it stays unit
// testable: import.ts pulls in @/lib/prisma, whose module init needs a live
// DATABASE_URL, while this module imports types only.
// ---------------------------------------------------------------------------

import type { IActivity } from "@flow-js/garmin-connect";

/** Garmin `startTimeGMT` is "YYYY-MM-DD HH:MM:SS" without designator (UTC).
 * Parsed as UTC explicitly: `new Date("2024-06-01 12:00:00")` would otherwise
 * be read as server-local time (a 2 h shift on CEST machines) while the
 * correct UTC branch stays unreachable. */
export function parseGarminDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const bare = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (bare) {
    const [, y, mo, d, h, mi, s] = bare;
    const utc = new Date(
      Date.UTC(+y, +mo - 1, +d, +h, +mi, s !== undefined ? +s : 0),
    );
    // Date.UTC rolls impossible components over — round-trip so "2024-13-40"
    // is rejected, not shifted (same discipline as parseSuuntoFilename).
    if (
      !isNaN(utc.getTime()) &&
      utc.getUTCFullYear() === +y &&
      utc.getUTCMonth() === +mo - 1 &&
      utc.getUTCDate() === +d
    ) {
      return utc;
    }
    return null;
  }
  const direct = new Date(value);
  return isNaN(direct.getTime()) ? null : direct;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface MappedGarminActivity {
  externalId: string;
  name: string | null;
  type: string;
  startDate: Date;
  distance: number | null;
  movingTime: number | null;
  elapsedTime: number | null;
  averageSpeed: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  calories: number | null;
  startDateLocal: Date | null;
}

/**
 * List-summary mapping. Negative durations/distances (device glitches) map
 * to null rather than corrupting aggregates. Distance 0 is kept as 0 —
 * a conscious difference from the Suunto convention (Suunto nulls unknown
 * GPS distance; Garmin list distance is an explicit device value).
 */
export function mapGarminActivity(a: IActivity): MappedGarminActivity | null {
  const startDate = parseGarminDateTime(a.startTimeGMT ?? a.startTimeLocal);
  if (!startDate) return null;
  const distance =
    typeof a.distance === "number" && a.distance >= 0 ? round1(a.distance) : null;
  const movingTime =
    typeof a.movingDuration === "number" && a.movingDuration >= 0
      ? Math.round(a.movingDuration)
      : null;
  const elapsedRaw =
    typeof a.elapsedDuration === "number"
      ? a.elapsedDuration
      : typeof a.duration === "number"
        ? a.duration
        : null;
  const elapsedTime = elapsedRaw !== null && elapsedRaw >= 0 ? Math.round(elapsedRaw) : null;
  // Recomputed, never trusted from list units (unit ambiguity in list API).
  const averageSpeed =
    distance !== null && movingTime !== null && movingTime > 0
      ? Math.round((distance / movingTime) * 1000) / 1000
      : null;
  return {
    externalId: String(a.activityId),
    name: a.activityName ?? null,
    type: garminTypeKeyToActivityType(a.activityType?.typeKey),
    startDate,
    distance,
    movingTime,
    elapsedTime,
    averageSpeed,
    averageHeartrate: typeof a.averageHR === "number" ? Math.round(a.averageHR) : null,
    maxHeartrate: typeof a.maxHR === "number" ? Math.round(a.maxHR) : null,
    calories: typeof a.calories === "number" ? Math.round(a.calories) : null,
    startDateLocal: parseGarminDateTime(a.startTimeLocal),
  };
}
