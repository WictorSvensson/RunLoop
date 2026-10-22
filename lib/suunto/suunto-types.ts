// Suunto Cloud API workout mapping onto Activity.type.
// Pure module (no prisma import) so it stays unit-testable: import.ts pulls
// in @/lib/prisma, whose module init needs a live DATABASE_URL, while this
// module must import cleanly under vitest.
//
// Field shapes follow the real specs (sibling Suunto-documentation/ folder):
// - suunto-workout-api.yaml — servers https://cloudapi.suunto.com/v3/workouts.
//   List rows carry NO sport string: the sport is the numeric `activityId`
//   ("ID for the sport", Suunto App column of Activities.pdf). Speeds are
//   km/h, times are seconds, HR lives in `hrdata`, energy in
//   `energyConsumption` (kcal), power/cadence in the `SummaryExtension`.
// - new-247-api.yaml — sleep entryData {Duration, Feeling, SleepQualityScore,
//   HRAvg, HRMin, AvgHRV, IsNap, BedtimeStart}; timestamps ISO-8601 UTC.
//
// Values mirror lib/running-types.ts RUNNING_TYPES where running so
// Dashboard/Analytics/Coach filters apply unchanged. Unknown activityIds fall
// back to "Workout" (visible on Training, excluded from run stats) rather
// than failing import.

/** Numeric Suunto activityId ("ID for the sport", Activities.pdf Suunto App
 * column) → Activity.type. Only non-Workout sports are listed; anything
 * absent (including Suunto's unused 89) maps to "Workout". Running-family
 * values match RUNNING_TYPES. */
const ACTIVITY_ID_TO_TYPE: Record<number, string> = {
  0: "Walk", // Walking
  1: "Run", // Running
  2: "Ride", // Cycling
  3: "NordicSki", // Cross-country skiing
  10: "Ride", // Mountain biking
  11: "Hike", // Hiking
  12: "InlineSkate", // Roller skating
  13: "AlpineSki", // Downhill skiing
  15: "Rowing", // Rowing
  16: "Golf", // Golfing
  21: "Swim", // Swimming
  22: "TrailRun", // Trail running
  23: "WeightTraining", // Gym
  24: "Walk", // Nordic walking
  30: "Snowboard", // Snowboarding
  31: "AlpineSki", // Ski touring
  34: "Tennis", // Tennis
  52: "Ride", // Indoor cycling
  53: "VirtualRun", // Treadmill
  55: "Elliptical", // Crosstrainer
  56: "NordicSki", // Roller skiing
  57: "Rowing", // Indoor rowing
  59: "Run", // Track and field
  60: "TrailRun", // Orienteering
  70: "Hike", // Trekking
  83: "Hike", // Mountaineering
  84: "AlpineSki", // Telemark skiing
  85: "Swim", // Openwater swimming
  95: "TrailRun", // Obstacle racing
  99: "Ride", // Gravel cycling
  103: "Run", // Track running
  105: "Ride", // E-biking
  106: "Ride", // E-mtb
  107: "NordicSki", // Backcountry skiing
  109: "Ride", // Hand cycling
  110: "Snowboard", // Splitboarding
  111: "NordicSki", // Biathlon
  114: "Ride", // Cyclocross
  115: "TrailRun", // Vertical running
  116: "AlpineSki", // Ski mountaineering
  117: "NordicSki", // Skate skiing
  118: "NordicSki", // Classic skiing
};

/** Maps a Suunto numeric activityId to an Activity.type value. */
export function suuntoActivityIdToActivityType(activityId: unknown): string {
  if (typeof activityId !== "number" || !Number.isInteger(activityId)) return "Workout";
  return ACTIVITY_ID_TO_TYPE[activityId] ?? "Workout";
}

/**
 * Parses a Suunto API timestamp. Numbers are epoch seconds — except values
 * ≥ 1e12, which are epoch milliseconds (the spec schema says seconds but the
 * published list example carries 13-digit ms; both occur, so both are
 * honored). ISO strings with an explicit designator/offset are honored;
 * bare "YYYY-MM-DD HH:MM:SS" values are read as UTC explicitly. Over-long
 * fractional seconds (the 247 API emits 7 digits) are truncated to millis.
 * Impossible dates are rejected, not rolled over (same discipline as
 * parseGarminDateTime / parseSuuntoFilename).
 */
export function parseSuuntoDateTime(value: string | number | null | undefined): Date | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    const ms = value >= 1e12 ? Math.round(value) : Math.round(value * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/(\.\d{3})\d+(?=[+-]\d{2}:?\d{2}|Z|$)/, "$1");
  if (!trimmed) return null;
  // Bare epoch digits (schema drift: some rows serialize numbers as strings).
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return parseSuuntoDateTime(Number(trimmed));
  }
  const bare = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?$/.exec(trimmed);
  if (bare) {
    const [, y, mo, d, h, mi, s] = bare;
    const utc = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, s !== undefined ? +s : 0));
    if (
      !isNaN(utc.getTime()) &&
      utc.getUTCFullYear() === +y &&
      utc.getUTCMonth() === +mo - 1 &&
      utc.getUTCDate() === +d &&
      utc.getUTCHours() === +h &&
      utc.getUTCMinutes() === +mi &&
      utc.getUTCSeconds() === (s !== undefined ? +s : 0)
    ) {
      return utc;
    }
    return null;
  }
  const direct = new Date(trimmed);
  return isNaN(direct.getTime()) ? null : direct;
}

// ---------------------------------------------------------------------------
// Pure list-summary mapping over the real LimitedWorkout shape.
// ---------------------------------------------------------------------------

/** Heart-rate block of a LimitedWorkout row. */
export interface SuuntoHrData {
  userMaxHR?: unknown;
  workoutAvgHR?: unknown;
  workoutMaxHR?: unknown;
}

/** One entry of a LimitedWorkout `extensions` array. */
export interface SuuntoExtension {
  type?: unknown;
  avgPower?: unknown;
  maxPower?: unknown;
  avgCadence?: unknown;
  maxCadence?: unknown;
}

/** Minimal Suunto LimitedWorkout row (subset the importer actually reads). */
export interface SuuntoApiWorkout {
  workoutKey?: unknown;
  key?: unknown;
  workoutName?: unknown;
  description?: unknown;
  activityId?: unknown; // numeric sport id (Activities.pdf, Suunto App column)
  startTime?: unknown; // epoch seconds (13-digit ms values also occur)
  stopTime?: unknown;
  totalTime?: unknown; // seconds
  totalDistance?: unknown; // meters
  totalAscent?: unknown; // meters
  totalDescent?: unknown; // meters
  avgSpeed?: unknown; // km/h
  maxSpeed?: unknown; // km/h
  hrdata?: unknown;
  energyConsumption?: unknown; // kcal
  cadence?: unknown; // number, or { avg, max }
  extensions?: unknown;
  timeOffsetInMinutes?: unknown; // athlete UTC offset; 0 = UTC
  stepCount?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** km/h (Suunto list units) → m/s (Activity units). */
function kmhToMs(v: number | null): number | null {
  if (v === null || v < 0) return null;
  return Math.round((v / 3.6) * 1000) / 1000;
}

function hrBlock(v: unknown): SuuntoHrData | null {
  if (typeof v !== "object" || v === null) return null;
  return v as SuuntoHrData;
}

/** Finds the SummaryExtension carrying session aggregates (power/cadence). */
function summaryExtension(v: unknown): SuuntoExtension | null {
  if (!Array.isArray(v)) return null;
  for (const e of v) {
    if (typeof e === "object" && e !== null && (e as { type?: unknown }).type === "SummaryExtension") {
      return e as SuuntoExtension;
    }
  }
  return null;
}

function cadenceAvg(v: unknown, ext: SuuntoExtension | null): number | null {
  const fromExt = ext ? num(ext.avgCadence) : null;
  if (fromExt !== null && fromExt >= 0) return Math.round(fromExt);
  const direct = num(v);
  if (direct !== null && direct >= 0) return Math.round(direct);
  if (typeof v === "object" && v !== null) {
    const avg = num((v as { avg?: unknown }).avg);
    if (avg !== null && avg >= 0) return Math.round(avg);
  }
  return null;
}

export interface MappedSuuntoWorkout {
  externalId: string;
  name: string | null;
  type: string;
  startDate: Date;
  startDateLocal: Date | null;
  distance: number | null;
  movingTime: number | null;
  elapsedTime: number | null;
  averageSpeed: number | null;
  maxSpeed: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  calories: number | null;
  totalElevationGain: number | null;
  averageWatts: number | null;
  maxWatts: number | null;
  averageCadence: number | null;
}

/**
 * List-summary mapping. Negative durations/distances (device glitches) map
 * to null rather than corrupting aggregates. Average speed is recomputed
 * from distance/time, never trusted from list units. The API exposes no
 * moving time, so movingTime = elapsedTime (pace math degrades honestly).
 */
export function mapSuuntoWorkout(w: SuuntoApiWorkout): MappedSuuntoWorkout | null {
  const externalId = str(w.workoutKey) ?? str(w.key);
  if (!externalId) return null;
  const rawStart: string | number | null =
    typeof w.startTime === "number" ? w.startTime : str(w.startTime);
  const startDate = parseSuuntoDateTime(rawStart);
  if (!startDate) return null;

  const distanceRaw = num(w.totalDistance);
  const distance = distanceRaw !== null && distanceRaw >= 0 ? round1(distanceRaw) : null;
  const elapsedRaw = num(w.totalTime);
  const elapsedTime = elapsedRaw !== null && elapsedRaw >= 0 ? Math.round(elapsedRaw) : null;
  const averageSpeed =
    distance !== null && elapsedTime !== null && elapsedTime > 0
      ? Math.round((distance / elapsedTime) * 1000) / 1000
      : null;

  const hr = hrBlock(w.hrdata);
  const avgHr = hr ? num(hr.workoutAvgHR) : null;
  const maxHr = hr ? num(hr.workoutMaxHR) : null;
  const caloriesRaw = num(w.energyConsumption);
  const ascentRaw = num(w.totalAscent);
  const ext = summaryExtension(w.extensions);
  const avgWatts = ext ? num(ext.avgPower) : null;
  const maxWatts = ext ? num(ext.maxPower) : null;

  const offsetMin = num(w.timeOffsetInMinutes);
  const startDateLocal =
    offsetMin !== null && Number.isInteger(offsetMin)
      ? new Date(startDate.getTime() + offsetMin * 60 * 1000)
      : null;

  return {
    externalId,
    name: str(w.workoutName) ?? str(w.description) ?? null,
    type: suuntoActivityIdToActivityType(w.activityId),
    startDate,
    startDateLocal,
    distance,
    movingTime: elapsedTime,
    elapsedTime,
    averageSpeed,
    maxSpeed: kmhToMs(num(w.maxSpeed)),
    averageHeartrate: avgHr !== null && avgHr > 0 ? Math.round(avgHr) : null,
    maxHeartrate: maxHr !== null && maxHr > 0 ? Math.round(maxHr) : null,
    calories: caloriesRaw !== null && caloriesRaw >= 0 ? Math.round(caloriesRaw) : null,
    totalElevationGain: ascentRaw !== null && ascentRaw >= 0 ? round1(ascentRaw) : null,
    averageWatts: avgWatts !== null && avgWatts >= 0 ? Math.round(avgWatts) : null,
    maxWatts: maxWatts !== null && maxWatts >= 0 ? Math.round(maxWatts) : null,
    averageCadence: cadenceAvg(w.cadence, ext),
  };
}

/**
 * Maps a 247 sleep `Feeling` (Poor 1, Average 2, Good 3, Very Good 4,
 * Excellent 5) onto the SleepQuality enum. Unknown/absent returns null
 * (honest gap) rather than a fabricated bucket.
 */
export function suuntoFeelingToQuality(
  feeling: number | null | undefined,
): "POOR" | "OKAY" | "GOOD" | "EXCELLENT" | null {
  if (feeling == null || typeof feeling !== "number" || !Number.isFinite(feeling)) return null;
  if (feeling >= 4) return "EXCELLENT";
  if (feeling >= 3) return "GOOD";
  if (feeling >= 2) return "OKAY";
  if (feeling >= 1) return "POOR";
  return null;
}

/**
 * Maps a 0..1 sleep-quality fraction (e.g. 247 `SleepQualityScore` / 100)
 * onto the SleepQuality enum. Same thresholds as lib/suunto-files.ts
 * qualityToSleepQuality (zip importer) — one convention, not two.
 */
export function suuntoSleepQualityToQuality(
  quality: number | null | undefined,
): "POOR" | "OKAY" | "GOOD" | "EXCELLENT" | null {
  if (quality == null || typeof quality !== "number" || Number.isNaN(quality)) return null;
  if (quality >= 0.9) return "EXCELLENT";
  if (quality >= 0.7) return "GOOD";
  if (quality >= 0.5) return "OKAY";
  if (quality >= 0) return "POOR";
  return null;
}
