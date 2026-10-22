// FIT decoding for the Suunto backfill importer, via the official
// @garmin/fitsdk (scales, offsets, endianness and developer fields are the
// SDK's problem — hand-rolling this was tried during inventory and tripped
// over big-endian definitions and conditional dev-data flags).
//
// Role: FILL GAPS ONLY. GPX remains the source of truth for track, pace,
// HR and elevation. FIT contributes what
// GPX cannot: true treadmill/pool distances, cadence + power streams,
// calories, and lap/interval structure.
//
// Runtime note: plain `node` strips types natively, so keep this file free
// of non-erasable syntax (enums, parameter properties, namespaces).

import { Decoder, Stream } from "@garmin/fitsdk";
import type { LapMesg, RecordMesg, SessionMesg } from "@garmin/fitsdk";
import type { TrackSummary } from "./gpx.ts";

// Backfill note: no separate re-decode script is needed. FIT sources stay
// re-downloadable (Garmin/Suunto cloud APIs) or user-local (Suunto export
// zips), and every importer upserts streams idempotently without wiping on
// FIT failure — so a full resync (`fullResync` / `?limit=N` staging) or a
// zip re-upload re-decodes and refreshes stored series in place. Existing
// streams are never wiped: writers only touch laps/streams when FIT delivers.

export interface FitSeries {
  cadence: (number | null)[];
  watts: (number | null)[];
  /** Per-record HR in bpm (null when the record carries none). */
  heartrate: (number | null)[];
  /** Per-record device speed in m/s (null when absent). */
  speed: (number | null)[];
  /** Per-record altitude in m (null when absent). */
  altitude: (number | null)[];
  /** Cumulative meters; present on treadmill/pool files that lack GPS. */
  distance: number[];
  /**
   * Clock + alignment contract (sub-lap rep detection depends on this):
   * - `time` holds OFFSET seconds from the first record message's timestamp
   *   (not absolute epoch) — FIT record count (smart recording, pauses) can
   *   differ from any GPX point count, so consumers must join on fitTime,
   *   never by array index against GPX `time`.
   * - Every series above is built from the SAME paired-tuple loop and shares
   *   the SAME length/indexing as `time`/`distance`: a record is dropped as a
   *   whole tuple only when its distance is null; every other null is kept as
   *   null in place. Index i means the same record in all series.
   * - Stored as `fitTime` in the ActivityStream payload.
   */
  time: number[];
}

export interface FitLap {
  lapIndex: number; // 1-based
  startDate: Date | null;
  /**
   * Record indices into the decoded FitSeries arrays (inclusive), so laps
   * join to per-record streams without timestamp math. Absolute `startDate`
   * stays the cross-clock anchor (FIT fitTime vs GPX time are different
   * clocks — offset-sec vs absolute — joinable only via startDate or these
   * indices). Null when the lap has no startTime or no records matched.
   */
  startIndex: number | null;
  endIndex: number | null;
  distance: number | null;
  movingTime: number | null; // totalTimerTime when present, else elapsed
  elapsedTime: number | null;
  averageSpeed: number | null;
  maxSpeed: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  averageCadence: number | null;
  averageWatts: number | null;
  totalElevationGain: number | null;
}

export interface FitSummary {
  distance: number | null;
  elapsedTime: number | null;
  movingTime: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  averageCadence: number | null;
  maxCadence: number | null;
  averageWatts: number | null;
  maxWatts: number | null;
  maxSpeed: number | null;
  calories: number | null;
  totalAscent: number | null;
  series: FitSeries;
  laps: FitLap[];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function avgSpeedFor(distance: number | null, movingTime: number | null): number | null {
  if (distance === null || movingTime === null || movingTime <= 0) return null;
  return Math.round((distance / movingTime) * 1000) / 1000;
}

function toFitLap(lap: LapMesg, index: number): FitLap {
  const elapsed = num(lap.totalElapsedTime);
  const moving = num(lap.totalTimerTime) ?? elapsed;
  const distance = num(lap.totalDistance);
  return {
    lapIndex: index + 1,
    startDate: lap.startTime instanceof Date ? lap.startTime : null,
    // Index mapping needs kept-record timestamps — filled by decodeFit after
    // the series loop (mapLapIndicesToRecords); null until then.
    startIndex: null,
    endIndex: null,
    distance,
    movingTime: moving !== null ? Math.round(moving) : null,
    elapsedTime: elapsed !== null ? Math.round(elapsed) : null,
    averageSpeed: avgSpeedFor(distance, moving),
    maxSpeed: num(lap.maxSpeed),
    averageHeartrate: num(lap.avgHeartRate),
    maxHeartrate: num(lap.maxHeartRate),
    averageCadence: num(lap.avgRunningCadence) ?? num(lap.avgCadence),
    averageWatts: num(lap.avgPower) !== null ? Math.round(num(lap.avgPower) as number) : null,
    totalElevationGain: num(lap.totalAscent),
  };
}

/**
 * Maps lap boundaries onto kept-record indices. Pure — unit-tested.
 *
 * @param recordTimeMs absolute epoch ms per kept record (null when the record
 *   carried no timestamp), index-aligned with every FitSeries array.
 * @param lapStartsMs absolute epoch ms per lap start (null when unknown).
 * @returns one {startIndex, endIndex} pair per lap (inclusive). A lap with no
 *   start maps to nulls; a start before the first record clamps to 0; a start
 *   past the last record clamps to the final index; each end is the next
 *   lap's start minus one (last lap runs to the final record).
 */
export function mapLapIndicesToRecords(
  recordTimeMs: (number | null)[],
  lapStartsMs: (number | null)[],
): { startIndex: number | null; endIndex: number | null }[] {
  const starts: (number | null)[] = lapStartsMs.map((lapStart) => {
    if (lapStart === null || recordTimeMs.length === 0) return null;
    for (let j = 0; j < recordTimeMs.length; j++) {
      const t = recordTimeMs[j];
      if (t !== null && t >= lapStart) return j;
    }
    return recordTimeMs.length - 1;
  });
  return starts.map((start, i) => {
    if (start === null) return { startIndex: null, endIndex: null };
    const next = starts.slice(i + 1).find((s) => s !== null);
    const end = (next === undefined ? recordTimeMs.length : next) - 1;
    return { startIndex: start, endIndex: Math.max(end, start) };
  });
}

/** Non-empty FIT series keys for the ActivityStream payload fragment, with
 *  the repo's empty-[]=absent convention (a series that is empty or all-null
 *  decodes to [] and is omitted). Distance is NOT included — GPX-backed paths
 *  resolve it with GPX priority, so callers handle it explicitly. */
export function fitStreamPayload(
  series: FitSeries,
): Record<string, { data: (number | null)[] }> {
  const payload: Record<string, { data: (number | null)[] }> = {};
  if (series.time.length > 0) payload.fitTime = { data: series.time };
  if (series.heartrate.length > 0) payload.heartrate = { data: series.heartrate };
  if (series.altitude.length > 0) payload.altitude = { data: series.altitude };
  if (series.speed.length > 0) payload.speed = { data: series.speed };
  if (series.cadence.length > 0) payload.cadence = { data: series.cadence };
  if (series.watts.length > 0) payload.watts = { data: series.watts };
  return payload;
}

/**
 * Decodes a Suunto .fit file into session totals, per-record streams and
 * laps. Returns null only when no session message exists (caller keeps the
 * GPX-only result — FIT is gap-fill, never load-bearing). Non-fatal SDK
 * warnings don't discard a usable session; they're logged for diagnosis.
 */
export function decodeFit(bytes: Uint8Array): FitSummary | null {
  let messages;
  try {
    const { messages: decoded, errors } = new Decoder(Stream.fromByteArray(bytes)).read();
    if (errors.length > 0) {
      console.warn(`fit decode: ${errors.length} non-fatal warning(s), using decoded session anyway`);
    }
    messages = decoded;
  } catch {
    return null;
  }

  const session: SessionMesg | undefined = messages.sessionMesgs?.[0];
  if (!session) return null;

  const records: RecordMesg[] = messages.recordMesgs ?? [];
  const firstTs = records.length > 0 && records[0].timestamp instanceof Date
    ? records[0].timestamp.getTime()
    : null;
  // Build paired tuples BEFORE filtering: every series below is pushed in
  // this one loop, so index i means the same record in all of them (profile.ts
  // derivePaceStream pairs fitTime[i] with distance[i]). Records without a
  // distance carry no position — drop the whole tuple, keep every other null
  // in place so the series stay index-aligned.
  const keptTimeMs: (number | null)[] = [];
  const keptTime: number[] = [];
  const keptDistance: number[] = [];
  const keptCadence: (number | null)[] = [];
  const keptWatts: (number | null)[] = [];
  const keptHeartrate: (number | null)[] = [];
  const keptSpeed: (number | null)[] = [];
  const keptAltitude: (number | null)[] = [];
  for (const r of records) {
    const d = num(r.distance);
    if (d === null) continue;
    keptDistance.push(d);
    keptTimeMs.push(r.timestamp instanceof Date ? r.timestamp.getTime() : null);
    keptTime.push(
      firstTs !== null && r.timestamp instanceof Date
        ? Math.round((r.timestamp.getTime() - firstTs) / 1000)
        : 0,
    );
    keptCadence.push(num(r.cadence));
    const w = num(r.power);
    keptWatts.push(w !== null ? Math.round(w) : null);
    const hr = num(r.heartRate);
    keptHeartrate.push(hr !== null ? Math.round(hr) : null);
    const spd = num(r.speed);
    keptSpeed.push(spd !== null ? Math.round(spd * 1000) / 1000 : null);
    keptAltitude.push(num(r.altitude));
  }
  const cadence = keptCadence;
  const watts = keptWatts;
  const heartrate = keptHeartrate;
  const speed = keptSpeed;
  const altitude = keptAltitude;
  const distance = keptDistance;
  const time = keptTime;
  const hasCadence = cadence.some((c) => c !== null);
  const hasWatts = watts.some((w) => w !== null);
  const hasHeartrate = heartrate.some((h) => h !== null);
  const hasSpeed = speed.some((s) => s !== null);
  const hasAltitude = altitude.some((a) => a !== null);
  const hasAnySeries = hasCadence || hasWatts || hasHeartrate || hasSpeed || hasAltitude;

  const laps = (messages.lapMesgs ?? []).map(toFitLap);
  // Lap↔record join: absolute lap startTimes against kept-record timestamps.
  // Indices address the aligned series arrays (same clock/length as time).
  const indices = mapLapIndicesToRecords(
    keptTimeMs,
    laps.map((lap) => (lap.startDate !== null ? lap.startDate.getTime() : null)),
  );
  laps.forEach((lap, i) => {
    lap.startIndex = indices[i].startIndex;
    lap.endIndex = indices[i].endIndex;
  });

  const moving = num(session.totalTimerTime) ?? num(session.totalElapsedTime);

  return {
    distance: num(session.totalDistance),
    elapsedTime: num(session.totalElapsedTime),
    movingTime: moving,
    averageHeartrate: num(session.avgHeartRate),
    maxHeartrate: num(session.maxHeartRate),
    averageCadence: num(session.avgRunningCadence) ?? num(session.avgCadence),
    maxCadence: num(session.maxRunningCadence) ?? num(session.maxCadence),
    averageWatts: num(session.avgPower) !== null ? Math.round(num(session.avgPower) as number) : null,
    maxWatts: num(session.maxPower) !== null ? Math.round(num(session.maxPower) as number) : null,
    maxSpeed: num(session.maxSpeed),
    calories: num(session.totalCalories),
    totalAscent: num(session.totalAscent),
    series: {
      cadence: hasCadence ? cadence : [],
      watts: hasWatts ? watts : [],
      heartrate: hasHeartrate ? heartrate : [],
      speed: hasSpeed ? speed : [],
      altitude: hasAltitude ? altitude : [],
      distance,
      time: hasAnySeries || distance.length > 0 ? time : [],
    },
    laps,
  };
}

export interface MergedSummary {
  distance: number | null;
  movingTime: number;
  averageSpeed: number | null;
  maxSpeed: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  averageCadence: number | null;
  averageWatts: number | null;
  maxWatts: number | null;
  calories: number | null;
  totalElevationGain: number | null;
  /** True when the distance came from FIT (treadmill/pool/GPS-dead). */
  distanceFromFit: boolean;
}

/**
 * Merges FIT gap-fill data into a GPX-derived summary. GPX wins every
 * conflict; FIT only fills fields GPX left null (plus calories, which GPX
 * never has). Pure — unit-tested.
 */
export function mergeSummaryWithFit(
  summary: TrackSummary,
  fit: FitSummary | null,
): MergedSummary {
  const base: MergedSummary = {
    distance: summary.distance,
    movingTime: summary.movingTime,
    averageSpeed: summary.averageSpeed,
    maxSpeed: summary.maxSpeed,
    averageHeartrate: summary.averageHeartrate,
    maxHeartrate: summary.maxHeartrate,
    averageCadence: null,
    averageWatts: null,
    maxWatts: null,
    calories: null,
    totalElevationGain: summary.totalElevationGain,
    distanceFromFit: false,
  };
  if (!fit) return base;

  if (base.distance === null && fit.distance !== null) {
    // Treadmill / pool / GPS-dead: belt-measured or length-counted distance
    // replaces "unknown". Speeds recompute from the same moving time the
    // GPX math produced (elapsed fallback for indoor).
    base.distance = Math.round(fit.distance * 10) / 10;
    base.averageSpeed = avgSpeedFor(base.distance, base.movingTime);
    base.distanceFromFit = true;
  }
  if (base.averageHeartrate === null) base.averageHeartrate = fit.averageHeartrate;
  if (base.maxHeartrate === null) base.maxHeartrate = fit.maxHeartrate;
  if (base.maxSpeed === null) base.maxSpeed = fit.maxSpeed;
  if (base.totalElevationGain === null) base.totalElevationGain = fit.totalAscent;
  base.averageCadence = fit.averageCadence;
  base.averageWatts = fit.averageWatts;
  base.maxWatts = fit.maxWatts;
  base.calories = fit.calories;
  return base;
}
