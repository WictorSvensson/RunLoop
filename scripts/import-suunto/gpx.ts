// Pure Suunto GPX parsing + track math for the one-off backfill importer.
//
// Zero dependencies by design: this runs under plain `node` (v22+ strips
// types natively, no tsx/ts-node needed) and is unit-tested via vitest
// (see gpx.test.ts). Keep this file free of non-erasable syntax (enums,
// parameter properties, namespaces) so runtime type-stripping works.
//
// Honesty notes (per Docs/RUNLOOP_ANALYSIS_ENGINE_SPEC.md §2.4):
// - Treadmill GPX files contain 0,0 coords and no distance extension, so
//   distance is returned as null (unknown), NOT zero. Callers must store
//   null so volume stats don't silently undercount — filling treadmill
//   distance from the paired .fit files is explicit Phase-2 work.
// - Elevation gain uses a smoothed series (9s moving average) before summing
//   positive deltas; raw 1Hz baro/GPS elevation is too noisy to sum directly.
// - movingTime excludes segments slower than 0.5 m/s (pauses at traffic
//   lights etc.); falls back to elapsedTime when nothing qualifies (indoor).

export interface TrackPoint {
  lat: number;
  lon: number;
  ele: number | null;
  time: Date;
  hr: number | null;
}

export interface TrackSeries {
  /** Per-second series for ActivityStream.payload (offsets in seconds from start). */
  time: number[];
  distance: number[];
  heartrate: (number | null)[];
  altitude: (number | null)[];
}

export interface TrackSummary {
  /** Distance in meters, null when unknowable (treadmill). */
  distance: number | null;
  /** Seconds from first to last point. */
  elapsedTime: number;
  /** Seconds excluding stopped segments. */
  movingTime: number;
  /** m/s over moving time, null without distance. */
  averageSpeed: number | null;
  /** m/s, max 9s-smoothed segment speed. */
  maxSpeed: number | null;
  /** bpm, null when no HR samples. */
  averageHeartrate: number | null;
  /** bpm, null when no HR samples. */
  maxHeartrate: number | null;
  /** Meters, null without elevation data. */
  totalElevationGain: number | null;
  series: TrackSeries;
}

const STOP_SPEED_MPS = 0.5;
const ELE_SMOOTH_WINDOW = 9;

/**
 * Extracts track points from a Suunto GPX document. Tolerates missing
 * ele/time/hr per point; skips points without coords or with unparseable time.
 */
export function parseGpxTrackPoints(xml: string): TrackPoint[] {
  const points: TrackPoint[] = [];
  const trkptRe = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
  let m: RegExpExecArray | null;
  while ((m = trkptRe.exec(xml)) !== null) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const inner = m[3];
    const timeMatch = /<time>([^<]+)<\/time>/.exec(inner);
    if (!timeMatch) continue;
    const time = new Date(timeMatch[1]);
    if (isNaN(time.getTime())) continue;
    const eleMatch = /<ele>([^<]+)<\/ele>/.exec(inner);
    const eleRaw = eleMatch ? Number(eleMatch[1]) : null;
    const hrMatch = /<gpxtpx:hr>([^<]+)<\/gpxtpx:hr>/.exec(inner);
    const hrRaw = hrMatch ? Number(hrMatch[1]) : null;
    points.push({
      lat,
      lon,
      ele: eleRaw !== null && Number.isFinite(eleRaw) ? eleRaw : null,
      time,
      hr: hrRaw !== null && Number.isFinite(hrRaw) ? Math.round(hrRaw) : null,
    });
  }
  return points;
}

/** Great-circle distance between two points in meters. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * True when every point sits at 0,0 (Suunto treadmill exports) — distance
 * cannot be derived from the track. Empty is NOT stationary (Array.every on
 * empty would lie to future callers).
 */
export function isStationaryTrack(points: TrackPoint[]): boolean {
  return points.length > 0 && points.every((p) => p.lat === 0 && p.lon === 0);
}

/** Plausible HR band: outside it is strap-slip/optical noise, not physiology. */
const HR_MIN = 30;
const HR_MAX = 220;

function maxOf(values: (number | null)[]): number {
  let max = -Infinity;
  for (const v of values) {
    if (v !== null && v > max) max = v;
  }
  return max === -Infinity ? 0 : max;
}

function movingAverage(values: number[], window: number): number[];
function movingAverage(values: (number | null)[], window: number): (number | null)[];
function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      const v = values[j];
      if (v !== null) {
        sum += v;
        n++;
      }
    }
    return n > 0 ? sum / n : null;
  });
}

/**
 * Derives Activity-level fields from parsed track points. Defensive copies
 * and sorts by time (merged/hand-edited files can arrive out of order —
 * unsorted input would store negative elapsed times and stream offsets).
 * Drops isolated (0,0) GPS dropouts from otherwise-moving tracks (one dropout
 * would otherwise add thousands of km); a fully-stationary track keeps its
 * points and reports unknown (null) distance instead.
 *
 * @returns null when fewer than 2 usable points.
 */
export function summarizeTrack(points: TrackPoint[]): TrackSummary | null {
  const sorted = [...points].sort((a, b) => a.time.getTime() - b.time.getTime());
  // Fully-stationary (treadmill) tracks keep their points and report unknown
  // (null) distance below; moving tracks drop isolated (0,0) GPS dropouts.
  const usable = isStationaryTrack(sorted)
    ? sorted
    : sorted.filter((p) => !(p.lat === 0 && p.lon === 0));
  if (usable.length < 2) return null;
  points = usable;

  const stationary = isStationaryTrack(points);
  const startTime = points[0].time.getTime();
  const elapsedTime = Math.round((points[points.length - 1].time.getTime() - startTime) / 1000);

  // Per-segment distance + speed.
  const segDist: number[] = [0];
  const segSpeed: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dt = (points[i].time.getTime() - points[i - 1].time.getTime()) / 1000;
    if (stationary || dt <= 0) {
      segDist.push(0);
      segSpeed.push(0);
      continue;
    }
    const d = haversineMeters(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
    segDist.push(d);
    segSpeed.push(d / dt);
  }

  const cumDist: number[] = [];
  let total = 0;
  for (const d of segDist) {
    total += d;
    cumDist.push(Math.round(total * 10) / 10);
  }

  // Moving time: segments at/above stop threshold. Falls back to elapsed
  // (indoor / all-stopped tracks) rather than reporting 0 for a real workout.
  let movingTime = 0;
  for (let i = 1; i < points.length; i++) {
    const dt = (points[i].time.getTime() - points[i - 1].time.getTime()) / 1000;
    if (dt > 0 && segSpeed[i] >= STOP_SPEED_MPS) movingTime += dt;
  }
  movingTime = Math.round(movingTime);
  if (movingTime <= 0) movingTime = elapsedTime;

  const distance = stationary ? null : Math.round(total * 10) / 10;
  const averageSpeed =
    distance !== null && movingTime > 0 ? Math.round((distance / movingTime) * 1000) / 1000 : null;

  // Max speed from smoothed segment speeds (raw 1s GPS speeds spike).
  // Loop max, not Math.max(...arr): long activities have tens of thousands
  // of points and spreading them blows the call stack.
  const smoothed = movingAverage(segSpeed, ELE_SMOOTH_WINDOW);
  const maxSpeedRaw = maxOf(smoothed);
  const maxSpeed =
    distance !== null && maxSpeedRaw > 0 ? Math.round(maxSpeedRaw * 1000) / 1000 : null;

  // HR outside the plausible band is sensor noise (strap slip), excluded from
  // both average and max rather than stored as physiology.
  const hrs = points
    .map((p) => p.hr)
    .filter((hr): hr is number => hr !== null && hr >= HR_MIN && hr <= HR_MAX);
  const averageHeartrate =
    hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
  const maxHeartrate = hrs.length > 0 ? maxOf(hrs) : null;

  // Elevation gain from smoothed elevation (null when no ele samples).
  const eles = points.map((p) => p.ele);
  let totalElevationGain: number | null = null;
  if (eles.some((e) => e !== null)) {
    const smoothEle = movingAverage(eles, ELE_SMOOTH_WINDOW);
    let gain = 0;
    let prev: number | null = null;
    for (const e of smoothEle) {
      if (e === null) continue;
      if (prev !== null && e > prev) gain += e - prev;
      prev = e;
    }
    totalElevationGain = Math.round(gain * 10) / 10;
  }

  return {
    distance,
    elapsedTime,
    movingTime,
    averageSpeed,
    maxSpeed,
    averageHeartrate,
    maxHeartrate,
    totalElevationGain,
    series: {
      time: points.map((p) => Math.round((p.time.getTime() - startTime) / 1000)),
      distance: cumDist,
      heartrate: points.map((p) => p.hr),
      altitude: points.map((p) => p.ele),
    },
  };
}

/** Suunto filename sport slug -> Activity.type (matches RUNNING_TYPES where running). */
const SPORT_TO_TYPE: Record<string, string> = {
  running: "Run",
  treadmill: "VirtualRun",
  trail_running: "TrailRun",
  cycling: "Ride",
  indoor_cycling: "Ride",
  cross_country_skiing: "NordicSki",
  roller_skiing: "NordicSki",
  roller_skating: "InlineSkate",
  swimming: "Swim",
  walking: "Walk",
  gym: "WeightTraining",
  floorball: "Workout",
  crosstrainer: "Elliptical",
};

/** Maps a Suunto filename slug (e.g. "trail_running") to an Activity.type value. */
export function suuntoSportToActivityType(sport: string): string {
  return SPORT_TO_TYPE[sport] ?? "Workout";
}

/** Activity.type values counted as runs (mirrors lib/running-types.ts). */
export const SUUNTO_RUNNING_TYPES: string[] = ["Run", "TrailRun", "VirtualRun"];

// Recordings that barely moved relative to their duration fall in two camps:
// GPS-dead effort (treadmill/indoor mislabeled as outdoor: GPS drift records
// meters while HR shows a real workout — 250 files in this export) vs a dead
// recording (watch left running, resting HR). Duration and HR are real in the
// first case and worth keeping; only distance is unknown.
const SUSPICIOUS_MIN_RATIO = 0.05;
const SUSPICIOUS_MIN_ELAPSED_S = 300;

export interface DistanceResolution {
  /** Null distance means "unknown" (treadmill/GPS-dead), never zero. */
  distance: number | null;
  movingTime: number;
  /** Drift-derived speeds are meaningless without distance — nulled together. */
  averageSpeed: number | null;
  maxSpeed: number | null;
  /** True when the file is a dead recording not worth importing. */
  skipped: boolean;
}

/**
 * Resolves implausible tracks: barely any movement over a long recording.
 * Normal tracks pass through untouched.
 */
export function resolveSuspiciousTrack(summary: TrackSummary): DistanceResolution {
  const passthrough = {
    distance: summary.distance,
    movingTime: summary.movingTime,
    averageSpeed: summary.averageSpeed,
    maxSpeed: summary.maxSpeed,
    skipped: false,
  };
  const ratio = summary.elapsedTime > 0 ? summary.movingTime / summary.elapsedTime : 1;
  if (summary.elapsedTime <= SUSPICIOUS_MIN_ELAPSED_S || ratio >= SUSPICIOUS_MIN_RATIO) {
    return passthrough;
  }
  if ((summary.averageHeartrate ?? 0) >= 100) {
    // Real effort (high HR throughout) with dead GPS: keep duration + HR,
    // admit distance is unknown rather than storing GPS drift as distance.
    return { distance: null, movingTime: summary.elapsedTime, averageSpeed: null, maxSpeed: null, skipped: false };
  }
  return { distance: null, movingTime: summary.elapsedTime, averageSpeed: null, maxSpeed: null, skipped: true };
}

export interface SuuntoFilename {
  startDate: Date;
  sport: string;
}

/**
 * Parses a Suunto export workout filename.
 * Expected: YYYY-MM-DD_HH.MM.SS-sportslug (.fit or .gpx suffix), basename only.
 * The date is parse-only/fallback (the GPX track start wins at import time).
 */
export function parseSuuntoFilename(filename: string): SuuntoFilename | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})\.(\d{2})\.(\d{2})-(.+)\.(fit|gpx)$/.exec(filename);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, sport] = m;
  const startDate = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  // Date.UTC rolls impossible components over (month 13 -> next January);
  // round-trip the components so "2023-13-40_..." is rejected, not shifted.
  if (
    isNaN(startDate.getTime()) ||
    startDate.getUTCFullYear() !== +y ||
    startDate.getUTCMonth() !== +mo - 1 ||
    startDate.getUTCDate() !== +d ||
    startDate.getUTCHours() !== +h ||
    startDate.getUTCMinutes() !== +mi ||
    startDate.getUTCSeconds() !== +s
  ) {
    return null;
  }
  return { startDate, sport };
}
