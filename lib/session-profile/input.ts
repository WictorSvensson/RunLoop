// DB input layer for SessionProfile v0.1 — kept separate from profile.ts so
// the pure profiler imports no Prisma/client code (unit-testable without a
// database). Reuses lib/activity-detail.ts readers as the input layer only:
// getActivityDetail (itself built on toActivityDTO + loadLapDTOs) for the
// user-scoped activity + laps, plus the stored ActivityStream payload.
import { prisma } from "@/lib/prisma";
import { getActivityDetail, hasPayloadStreams } from "@/lib/activity-detail";
import type {
  SessionActivityInput,
  SessionLapInput,
  SessionStreamsInput,
} from "@/lib/session-profile/types";

export interface SessionInputs {
  activity: SessionActivityInput;
  laps: SessionLapInput[];
  streams: SessionStreamsInput;
}

/**
 * Loads the three SessionProfile inputs for one real activity. Scoped by
 * `userId` via `getActivityDetail` (throws "Activity not found" for missing
 * or foreign rows); the stream row is fetched by the already-verified id so
 * no cross-user stream can leak in. This function only reads — all
 * interpretation stays in `sessionProfile()`.
 */
export async function loadSessionInputs(
  userId: string,
  activityId: string,
): Promise<SessionInputs> {
  const detail = await getActivityDetail(userId, activityId);
  const streamRow = await prisma.activityStream.findUnique({
    where: { activityId: detail.id },
    select: { payload: true },
  });
  const streams =
    streamRow !== null && hasPayloadStreams(streamRow.payload)
      ? (streamRow.payload as Record<string, unknown>)
      : null;
  return {
    activity: {
      type: detail.type,
      name: detail.name,
      description: detail.description,
      distance: detail.distance,
      movingTime: detail.movingTime,
      elapsedTime: detail.elapsedTime,
      averageSpeed: detail.averageSpeed,
      maxSpeed: detail.maxSpeed,
      averageHeartrate: detail.averageHeartrate,
      maxHeartrate: detail.maxHeartrate,
      totalElevationGain: detail.totalElevationGain,
      averageTemp: detail.averageTemp,
    },
    // Measured per-lap times flow straight through: movingTime preferred,
    // elapsedTime fallback, distance/pace estimate only when both are absent
    // (profile.ts flags the estimated path in notes/uncertainty).
    laps: (detail.laps ?? []).map((lap) => ({
      lapIndex: lap.lapIndex,
      distance: lap.distance,
      movingTime: lap.movingTime,
      elapsedTime: lap.elapsedTime,
      averageSpeed: lap.averageSpeed,
      averageHeartrate: lap.averageHeartrate,
    })),
    streams,
  };
}
