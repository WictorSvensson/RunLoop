import { prisma } from "@/lib/prisma";
import { RUNNING_TYPES } from "@/lib/running-types";
import { sessionProfile } from "@/lib/session-profile/profile";
import type {
  Confidence,
  SessionClass,
  SessionLapInput,
  SessionProfile,
  SessionStreamsInput,
} from "@/lib/session-profile/types";

// Activity detail DTOs + readers. Provider-agnostic: Garmin and Suunto rows
// arrive with laps/streams stored at import time, so detail is always served
// from the DB (the old Strava-API fetch-once path was removed with the
// Strava integration).

// A BigInt-free view of an activity, safe to send to the client (JSON can't
// serialize BigInt).
export interface ActivityDTO {
  id: string;
  name: string | null;
  type: string | null;
  startDate: string; // ISO
  distance: number | null;
  movingTime: number | null;
  elapsedTime: number | null;
  averageSpeed: number | null;
  maxSpeed: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  totalElevationGain: number | null;
  // detail fields (null until enriched)
  startDateLocal: string | null;
  timezone: string | null;
  averageCadence: number | null;
  averageWatts: number | null;
  weightedAverageWatts: number | null;
  maxWatts: number | null;
  kilojoules: number | null;
  calories: number | null;
  averageTemp: number | null;
  description: string | null;
  gearName: string | null;
  deviceName: string | null;
  detailFetched: boolean;
  // analysis-ingestion state (laps + streams stored at import time)
  analysisReady: boolean;
  hasStreams: boolean;
  laps: ActivityLapDTO[] | null; // null when not loaded (list rows), [] when none stored
  // SessionProfile badge (broad class + confidence), computed server-side via
  // lib/session-profile/profile.ts. Present on list rows (badge-only payload:
  // the full profile never crosses to the client for 25-200 rows at a time).
  profile: SessionProfileBadge | null;
  // Full SessionProfile for the expanded detail panel only. Null on list rows
  // (where `profile` carries the cheap badge) — the detail API is the one path
  // that ships the whole thing, already computed once per activity.
  sessionProfile: SessionProfile | null;
}

export interface SessionProfileBadge {
  classification: SessionClass;
  confidence: Confidence;
}

export interface ActivityLapDTO {
  lapIndex: number;
  name: string | null;
  distance: number | null;
  movingTime: number | null;
  elapsedTime: number | null;
  averageSpeed: number | null;
  averageHeartrate: number | null;
}

export function toActivityDTO(
  a: {
    id: string;
    name: string | null;
    type: string | null;
    startDate: Date;
    distance: number | null;
    movingTime: number | null;
    elapsedTime: number | null;
    averageSpeed: number | null;
    maxSpeed: number | null;
    averageHeartrate: number | null;
    maxHeartrate: number | null;
    totalElevationGain: number | null;
    startDateLocal: Date | null;
    timezone: string | null;
    averageCadence: number | null;
    averageWatts: number | null;
    weightedAverageWatts: number | null;
    maxWatts: number | null;
    kilojoules: number | null;
    calories: number | null;
    averageTemp: number | null;
    description: string | null;
    gearName: string | null;
    deviceName: string | null;
    detailFetchedAt: Date | null;
    analysisDataFetchedAt: Date | null;
  },
  laps: ActivityLapDTO[] | null = null,
  hasStreams = false,
  profile: SessionProfileBadge | null = null,
  sessionProfile: SessionProfile | null = null,
): ActivityDTO {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    startDate: a.startDate.toISOString(),
    distance: a.distance,
    movingTime: a.movingTime,
    elapsedTime: a.elapsedTime,
    averageSpeed: a.averageSpeed,
    maxSpeed: a.maxSpeed,
    averageHeartrate: a.averageHeartrate,
    maxHeartrate: a.maxHeartrate,
    totalElevationGain: a.totalElevationGain,
    startDateLocal: a.startDateLocal ? a.startDateLocal.toISOString() : null,
    timezone: a.timezone,
    averageCadence: a.averageCadence,
    averageWatts: a.averageWatts,
    weightedAverageWatts: a.weightedAverageWatts,
    maxWatts: a.maxWatts,
    kilojoules: a.kilojoules,
    calories: a.calories,
    averageTemp: a.averageTemp,
    description: a.description,
    gearName: a.gearName,
    deviceName: a.deviceName,
    detailFetched: a.detailFetchedAt !== null,
    analysisReady: a.analysisDataFetchedAt !== null,
    hasStreams,
    laps,
    profile,
    sessionProfile,
  };
}

// Pure payload check shared by every hasStreams reader: true only when the
// stored ActivityStream payload is a non-empty object. Exported so the
// Training list path reuses the exact same predicate instead of
// reimplementing it (previously three copies: list page, detail reader,
// coverage count).
export function hasPayloadStreams(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    Object.keys(payload).length > 0
  );
}

// Pure SessionProfile → badge projection. Takes an ALREADY computed profile,
// so the detail path can compute sessionProfile() once and derive both the
// badge and the full payload from the same result (no double computation).
export function toSessionProfileBadge(profile: SessionProfile): SessionProfileBadge {
  return {
    classification: profile.classification,
    confidence: profile.confidence,
  };
}

// Pure SessionProfile badge builder for callers that only have the raw
// activity/laps/streams (the Training list path). Same computation as the
// detail path — the badge never drifts between the two.
export function toProfileBadge(
  activity: {
    type: string | null;
    name: string | null;
    description: string | null;
    distance: number | null;
    movingTime: number | null;
    elapsedTime: number | null;
    averageSpeed: number | null;
    maxSpeed: number | null;
    averageHeartrate: number | null;
    maxHeartrate: number | null;
    totalElevationGain: number | null;
    averageTemp: number | null;
  },
  laps: SessionLapInput[],
  streams: SessionStreamsInput,
): SessionProfileBadge {
  // sessionProfile() is honest about thin inputs by design: missing
  // laps/streams surface as unknown classification and low/insufficient
  // confidence, never as fabricated precision.
  return toSessionProfileBadge(sessionProfile(activity, laps, streams));
}

// Detailed representation of one activity with stored laps attached.
// Scoped by userId for isolation. Throws "Activity not found" for missing
// or foreign rows. The SessionProfile is computed exactly once here and both
// DTO fields (`sessionProfile` full payload, `profile` badge) are derived from
// that single result — the expanded panel shows what the algorithm concluded
// while the row badge stays identical to the Training list row.
export async function getActivityDetail(
  userId: string,
  activityId: string,
): Promise<ActivityDTO> {
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, userId },
  });
  if (!activity) {
    throw new Error("Activity not found");
  }
  const [lapDTOs, streamRow] = await Promise.all([
    loadLapDTOs(activity.id),
    prisma.activityStream.findUnique({
      where: { activityId: activity.id },
      select: { payload: true },
    }),
  ]);
  const payload = streamRow?.payload;
  const hasStreams = hasPayloadStreams(payload);
  const streams: SessionStreamsInput =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  const sessionProfileValue = sessionProfile(
    {
      type: activity.type,
      name: activity.name,
      description: activity.description,
      distance: activity.distance,
      movingTime: activity.movingTime,
      elapsedTime: activity.elapsedTime,
      averageSpeed: activity.averageSpeed,
      maxSpeed: activity.maxSpeed,
      averageHeartrate: activity.averageHeartrate,
      maxHeartrate: activity.maxHeartrate,
      totalElevationGain: activity.totalElevationGain,
      averageTemp: activity.averageTemp,
    },
    lapDTOs.map((lap) => ({
      lapIndex: lap.lapIndex,
      distance: lap.distance,
      movingTime: lap.movingTime,
      elapsedTime: lap.elapsedTime,
      averageSpeed: lap.averageSpeed,
      averageHeartrate: lap.averageHeartrate,
    })),
    streams,
  );
  return toActivityDTO(
    activity,
    lapDTOs,
    hasStreams,
    toSessionProfileBadge(sessionProfileValue),
    sessionProfileValue,
  );
}

// Stored lap splits for the detail panel. Absent rows mean "none stored",
// not an error.
async function loadLapDTOs(activityId: string): Promise<ActivityLapDTO[]> {
  const lapRows = await prisma.activityLap.findMany({
    where: { activityId },
    orderBy: { lapIndex: "asc" },
  });
  return lapRows.map((lap) => ({
    lapIndex: lap.lapIndex,
    name: lap.name,
    distance: lap.distance,
    movingTime: lap.movingTime,
    elapsedTime: lap.elapsedTime,
    averageSpeed: lap.averageSpeed,
    averageHeartrate: lap.averageHeartrate,
  }));
}

export interface AnalysisCoverage {
  totalRuns: number;
  detailEnriched: number;
  analysisReady: number;
  withHeartRate: number;
  withLaps: number;
  withStreams: number;
}

// Readiness readout over the user's runs: every importer stores laps +
// streams at import time, so this only ever lags while an import is young.
export async function getAnalysisCoverage(userId: string): Promise<AnalysisCoverage> {
  const runs = await prisma.activity.findMany({
    where: { userId, type: { in: [...RUNNING_TYPES] } },
    select: {
      detailFetchedAt: true,
      analysisDataFetchedAt: true,
      averageHeartrate: true,
      stream: { select: { payload: true } },
      _count: { select: { laps: true } },
    },
  });

  return {
    totalRuns: runs.length,
    detailEnriched: runs.filter((run) => run.detailFetchedAt !== null).length,
    analysisReady: runs.filter((run) => run.analysisDataFetchedAt !== null).length,
    withHeartRate: runs.filter((run) => run.averageHeartrate !== null).length,
    withLaps: runs.filter((run) => run._count.laps > 0).length,
    withStreams: runs.filter((run) => {
      if (run.stream === null) return false;
      return hasPayloadStreams(run.stream.payload);
    }).length,
  };
}
