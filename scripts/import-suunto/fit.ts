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

export interface FitSeries {
  cadence: (number | null)[];
  watts: (number | null)[];
  /** Cumulative meters; present on treadmill/pool files that lack GPS. */
  distance: number[];
  /**
   * Seconds from the first record message, parallel to cadence/watts/
   * distance above. Stored as `fitTime` in the payload because FIT record
   * count (smart recording, pauses) can differ from the GPX point count —
   * consumers must join on fitTime, never by array index against `time`.
   */
  time: number[];
}

export interface FitLap {
  lapIndex: number; // 1-based
  startDate: Date | null;
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
 * Decodes a Suunto .fit file into session totals, per-second cadence/power
 * streams and laps. Returns null only when no session message exists (caller
 * keeps the GPX-only result — FIT is gap-fill, never load-bearing). Non-fatal
 * SDK warnings don't discard a usable session; they're logged for diagnosis.
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
  const cadence: (number | null)[] = records.map((r) => num(r.cadence));
  const watts: (number | null)[] = records
    .map((r) => num(r.power))
    .map((w) => (w !== null ? Math.round(w) : null));
  const distance: number[] = records
    .map((r) => num(r.distance))
    .filter((d): d is number => d !== null);
  const firstTs = records.length > 0 && records[0].timestamp instanceof Date
    ? records[0].timestamp.getTime()
    : null;
  const time: number[] = records.map((r) =>
    firstTs !== null && r.timestamp instanceof Date
      ? Math.round((r.timestamp.getTime() - firstTs) / 1000)
      : 0,
  );
  const hasCadence = cadence.some((c) => c !== null);
  const hasWatts = watts.some((w) => w !== null);

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
      distance,
      time: hasCadence || hasWatts || distance.length > 0 ? time : [],
    },
    laps: (messages.lapMesgs ?? []).map(toFitLap),
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
