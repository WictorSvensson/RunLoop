import type { Activity } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, getActivityDetail } from "./client";

// A BigInt-free view of an activity, safe to send to the client (JSON can't
// serialize BigInt, and we don't want to leak Strava ids to the browser).
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
}

export function toActivityDTO(a: Activity): ActivityDTO {
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
  };
}

// Loads (and caches) the detailed representation of one activity from Strava.
// Fetch-once: if the activity was already enriched, returns the stored row
// without hitting the Strava API. Scoped by userId for isolation.
export async function enrichActivity(
  userId: string,
  activityId: string,
): Promise<ActivityDTO> {
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, userId },
  });
  if (!activity) {
    throw new Error("Activity not found");
  }

  // Already enriched -> serve from DB, no API call.
  if (activity.detailFetchedAt !== null) {
    return toActivityDTO(activity);
  }

  const connection = await prisma.stravaConnection.findUnique({
    where: { userId },
  });
  if (!connection) {
    throw new Error("No Strava connection found for this user. Connect Strava first.");
  }

  const accessToken = await getValidAccessToken(connection);
  const detail = await getActivityDetail(accessToken, activity.stravaId);

  const startDateLocal = detail.start_date_local
    ? new Date(detail.start_date_local)
    : null;

  // Preserve existing values when Strava omits a field (never clobber to null),
  // so this is safe even if enrichment is ever re-run.
  const round = (n: number | undefined) =>
    n === undefined ? undefined : Math.round(n);

  // Race guard: only the first writer (while still un-enriched) performs the
  // update. A concurrent double-click that already enriched won't overwrite.
  await prisma.activity.updateMany({
    where: { id: activity.id, detailFetchedAt: null },
    data: {
      name: detail.name ?? activity.name,
      description: detail.description ?? activity.description,
      startDateLocal:
        startDateLocal && !isNaN(startDateLocal.getTime())
          ? startDateLocal
          : activity.startDateLocal,
      timezone: detail.timezone ?? activity.timezone,
      averageCadence: detail.average_cadence ?? activity.averageCadence,
      averageWatts: detail.average_watts ?? activity.averageWatts,
      weightedAverageWatts:
        round(detail.weighted_average_watts) ?? activity.weightedAverageWatts,
      maxWatts: round(detail.max_watts) ?? activity.maxWatts,
      kilojoules: detail.kilojoules ?? activity.kilojoules,
      calories: detail.calories ?? activity.calories,
      averageTemp: round(detail.average_temp) ?? activity.averageTemp,
      gearId: detail.gear?.id ?? detail.gear_id ?? activity.gearId,
      gearName: detail.gear?.name ?? activity.gearName,
      deviceName: detail.device_name ?? activity.deviceName,
      detailFetchedAt: new Date(),
    },
  });

  // Re-read the persisted row (source of truth whether we won the race or not).
  const fresh = await prisma.activity.findUniqueOrThrow({
    where: { id: activity.id },
  });
  return toActivityDTO(fresh);
}
