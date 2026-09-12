import { prisma } from "@/lib/prisma";
import { RUNNING_TYPES } from "@/lib/running-types";

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
}

export interface ActivityLapDTO {
  lapIndex: number;
  name: string | null;
  distance: number | null;
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
  };
}

// Detailed representation of one activity with stored laps attached.
// Scoped by userId for isolation. Throws "Activity not found" for missing
// or foreign rows.
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
  const [laps, hasStreams] = await Promise.all([
    loadLapDTOs(activity.id),
    hasStoredStreams(activity.id),
  ]);
  return toActivityDTO(activity, laps, hasStreams);
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
    averageSpeed: lap.averageSpeed,
    averageHeartrate: lap.averageHeartrate,
  }));
}

// True only when stored streams contain at least one stream — matching
// getAnalysisCoverage's withStreams count, so the panel never claims streams
// are stored for an empty payload.
async function hasStoredStreams(activityId: string): Promise<boolean> {
  const streamRow = await prisma.activityStream.findUnique({
    where: { activityId },
    select: { payload: true },
  });
  if (!streamRow) return false;
  const payload = streamRow.payload;
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    Object.keys(payload).length > 0
  );
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
      const payload = run.stream.payload;
      return typeof payload === "object" && payload !== null && !Array.isArray(payload)
        ? Object.keys(payload).length > 0
        : false;
    }).length,
  };
}
