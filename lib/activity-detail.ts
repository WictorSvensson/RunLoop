import { prisma } from "@/lib/prisma";
import { RUNNING_TYPES } from "@/lib/running-types";
import { sessionProfile } from "@/lib/session-profile/profile";
import type {
  Confidence,
  SessionClass,
  SessionLapInput,
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
  // lib/session-profile/profile.ts. Null when not computed (e.g. detail API).
  profile: SessionProfileBadge | null;
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

// Pure SessionProfile badge builder: broad class + confidence only, so the
// Training list path and the detail API share one computation instead of
// drifting apart. Laps/streams never cross to the client — only the badge.
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
  const profile = sessionProfile(activity, laps, streams);
  return {
    classification: profile.classification,
    confidence: profile.confidence,
  };
}

// Detailed representation of one activity with stored laps attached.
// Scoped by userId for isolation. Throws "Activity not found" for missing
// or foreign rows. The SessionProfile badge is computed here too, so the
// detail response carries the same badge as the Training list rows —
// expanding a row must never overwrite its badge with null (list-only
// contract would also be acceptable, but computing in both paths is cheap:
// one extra stream row already fetched for hasStreams).
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
  const profile = toProfileBadge(
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
  return toActivityDTO(activity, lapDTOs, hasStreams, profile);
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
