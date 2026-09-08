import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { RUNNING_TYPES } from "@/lib/running-types";
import { enrichActivity } from "@/lib/strava/enrich";
import { clampAnalysisBatchSize } from "@/lib/strava/analysis-batch";
import {
  getActivityLaps,
  getActivityStreams,
  getValidAccessToken,
  StravaApiError,
  type StravaLap,
  type StravaStreamsByType,
} from "@/lib/strava/client";

export interface AnalysisHydrationResult {
  selected: number;
  hydrated: number;
  alreadyReady: number;
  failed: number;
  rateLimited: boolean;
  errors: Array<{ activityId: string; message: string }>;
}

export interface AnalysisCoverage {
  totalRuns: number;
  detailEnriched: number;
  analysisReady: number;
  withHeartRate: number;
  withLaps: number;
  withStreams: number;
}


function lapIndexFor(lap: StravaLap, index: number): number {
  // Strava's lap_index is normally present and one-based. The array index is a
  // deterministic fallback for activities where Strava omits it.
  return lap.lap_index ?? index + 1;
}

type StoredStream = {
  data: number[] | boolean[] | Array<[number, number]>;
  seriesType?: string;
  originalSize?: number;
  resolution?: string;
};

function streamPayload(streams: StravaStreamsByType): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(streams).map(([key, stream]) => {
      const value: StoredStream = { data: stream.data };
      if (stream.series_type !== undefined) value.seriesType = stream.series_type;
      if (stream.original_size !== undefined) value.originalSize = stream.original_size;
      if (stream.resolution !== undefined) value.resolution = stream.resolution;
      return [key, value];
    }),
  ) as Prisma.InputJsonObject;
}

export async function hydrateActivityAnalysisData(
  userId: string,
  activityId: string,
): Promise<"hydrated" | "already_ready"> {
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, userId },
  });
  if (!activity) throw new Error("Activity not found");

  if (activity.analysisDataFetchedAt !== null) return "already_ready";

  const connection = await prisma.stravaConnection.findUnique({
    where: { userId },
  });
  if (!connection) {
    throw new Error("No Strava connection found for this user. Connect Strava first.");
  }

  const accessToken = await getValidAccessToken(connection);
  const [laps, streams] = await Promise.all([
    getActivityLaps(accessToken, activity.stravaId),
    getActivityStreams(accessToken, activity.stravaId),
  ]);

  const fetchedAt = new Date();
  const payload = streamPayload(streams);

  await prisma.$transaction(async (tx) => {
    // Re-running is safe. We replace laps because edits on Strava can change lap
    // boundaries, and an activity's explicit lap order is small enough that a
    // replace is simpler and safer than trying to diff it.
    await tx.activityLap.deleteMany({ where: { activityId: activity.id } });

    if (laps.length > 0) {
      await tx.activityLap.createMany({
        data: laps.map((lap, index) => ({
          activityId: activity.id,
          lapIndex: lapIndexFor(lap, index),
          name: lap.name ?? null,
          startDate: lap.start_date ? new Date(lap.start_date) : null,
          distance: lap.distance ?? null,
          movingTime: lap.moving_time ?? null,
          elapsedTime: lap.elapsed_time ?? null,
          startIndex: lap.start_index ?? null,
          endIndex: lap.end_index ?? null,
          averageSpeed: lap.average_speed ?? null,
          maxSpeed: lap.max_speed ?? null,
          averageHeartrate: lap.average_heartrate ?? null,
          maxHeartrate: lap.max_heartrate ?? null,
          averageCadence: lap.average_cadence ?? null,
          averageWatts: lap.average_watts ?? null,
          totalElevationGain: lap.total_elevation_gain ?? null,
        })),
      });
    }

    await tx.activityStream.upsert({
      where: { activityId: activity.id },
      create: {
        activityId: activity.id,
        payload,
        fetchedAt,
      },
      update: {
        payload,
        fetchedAt,
      },
    });

    await tx.activity.update({
      where: { id: activity.id },
      data: { analysisDataFetchedAt: fetchedAt },
    });
  });

  return "hydrated";
}

// Hydrates a conservative batch of recent runs. Each activity can cost up to
// three Strava requests (detail + laps + streams), so this is intentionally a
// repeatable small-batch job instead of an unbounded "download everything now"
// loop. Re-running continues with the next not-yet-ready activities.
export async function hydrateHistoricalAnalysisData(
  userId: string,
  options: { limit?: number } = {},
): Promise<AnalysisHydrationResult> {
  const limit = clampAnalysisBatchSize(options.limit);

  const pending = await prisma.activity.findMany({
    where: {
      userId,
      type: { in: [...RUNNING_TYPES] },
      analysisDataFetchedAt: null,
    },
    orderBy: { startDate: "desc" },
    take: limit,
    select: { id: true },
  });

  const result: AnalysisHydrationResult = {
    selected: pending.length,
    hydrated: 0,
    alreadyReady: 0,
    failed: 0,
    rateLimited: false,
    errors: [],
  };

  for (const row of pending) {
    try {
      // Reuse the existing detail enrichment path so the analysis dataset also
      // gets cadence/temp/gear/etc. without duplicating that mapping logic.
      await enrichActivity(userId, row.id);
      const status = await hydrateActivityAnalysisData(userId, row.id);
      if (status === "hydrated") result.hydrated += 1;
      else result.alreadyReady += 1;
    } catch (err) {
      if (err instanceof StravaApiError && err.status === 429) {
        result.rateLimited = true;
        break;
      }
      if (err instanceof StravaApiError && (err.status === 400 || err.status === 401)) {
        throw err;
      }

      result.failed += 1;
      result.errors.push({
        activityId: row.id,
        message: err instanceof Error ? err.message : "Unknown hydration error",
      });
    }
  }

  return result;
}

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
