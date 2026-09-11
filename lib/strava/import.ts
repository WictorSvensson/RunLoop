import { prisma } from "@/lib/prisma";
import { getValidAccessToken, listActivities } from "./client";

export interface ImportResult {
  imported: number; // newly created activities
  updated: number; // existing activities refreshed
  skipped: number; // rows we couldn't parse (e.g. bad date)
  duplicates: number; // rows matching an existing Suunto session, skipped
  pagesFetched: number;
}

const PER_PAGE = 200;
// Safety cap so a runaway loop can never hammer the API past sane limits.
// 25 pages * 200 = 5000 activities per run, well under the daily request cap.
const MAX_PAGES = 25;

// Imports activities for a user's Strava connection into the Activity table.
// - Refreshes the access token if needed (handled by getValidAccessToken).
// - Upserts so re-running is safe and never duplicates.
// - By default does an incremental import (activities on/after the latest one we
//   already have, minus a day of overlap). Pass fullResync=true to sweep the
//   entire history — needed because Strava's `after` filter is by activity
//   start_date, so backdated / manually-added activities can otherwise be missed.
export async function importStravaActivities(
  userId: string,
  options: { fullResync?: boolean } = {},
): Promise<ImportResult> {
  const connection = await prisma.stravaConnection.findUnique({
    where: { userId },
  });
  if (!connection) {
    throw new Error("No Strava connection found for this user. Connect Strava first.");
  }

  const accessToken = await getValidAccessToken(connection);

  // High-water mark: the latest activity start date we've already imported.
  // Fetch after that (minus overlap) so edits near the boundary are caught.
  // A full resync ignores this and pulls the entire history (idempotent upsert).
  // High-water mark scoped to STRAVA rows only: Suunto backfill rows share
  // the table and can be newer than the last Strava sync — including them
  // would jump `after` forward and silently skip unseen Strava activities.
  let after: number | undefined;
  if (!options.fullResync) {
    const latest = await prisma.activity.findFirst({
      where: { userId, source: "STRAVA" },
      orderBy: { startDate: "desc" },
      select: { startDate: true },
    });
    if (latest) {
      after = Math.floor(latest.startDate.getTime() / 1000) - 24 * 60 * 60; // 1 day overlap
    }
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let duplicates = 0;
  let page = 1;
  let pagesFetched = 0;

  while (page <= MAX_PAGES) {
    const activities = await listActivities(accessToken, {
      after,
      page,
      perPage: PER_PAGE,
    });
    pagesFetched++;

    if (activities.length === 0) break;

    for (const a of activities) {
      // Skip rows with an unparseable start date instead of aborting the batch.
      const startDate = new Date(a.start_date);
      if (isNaN(startDate.getTime())) {
        skipped++;
        continue;
      }

      const stravaId = BigInt(a.id);
      const externalId = String(a.id);

      // Suunto-first database: skip Strava rows that duplicate an already
      // imported Suunto session (same ±10 min start window and comparable
      // elapsed time). Mirror of the guard in scripts/import-suunto/import.ts.
      // With no Strava connection this never runs; it exists so a future
      // reconnect can't silently double-count history. Strict `< 600`
      // matches the Suunto side exactly (a twin 600 s out is distinct both
      // ways). Null elapsed on either side falls back to the time window
      // alone — safer against duplicates than importing blind.
      const windowStart = new Date(startDate.getTime() - 10 * 60 * 1000);
      const windowEnd = new Date(startDate.getTime() + 10 * 60 * 1000);
      const suuntoTwin = await prisma.activity.findFirst({
        where: {
          userId,
          source: "SUUNTO",
          startDate: { gt: windowStart, lt: windowEnd },
        },
        select: { id: true, elapsedTime: true },
      });
      const elapsed = a.elapsed_time ?? null;
      const isDuplicate =
        suuntoTwin !== null &&
        (elapsed === null ||
          suuntoTwin.elapsedTime === null ||
          Math.abs(suuntoTwin.elapsedTime - elapsed) <= 300);
      if (isDuplicate) {
        duplicates++;
        continue;
      }

      const data = {
        name: a.name ?? null,
        type: a.sport_type ?? a.type ?? null,
        startDate,
        distance: a.distance ?? null,
        movingTime: a.moving_time ?? null,
        elapsedTime: a.elapsed_time ?? null,
        averageSpeed: a.average_speed ?? null,
        maxSpeed: a.max_speed ?? null,
        averageHeartrate: a.average_heartrate ?? null,
        maxHeartrate: a.max_heartrate ?? null,
        totalElevationGain: a.total_elevation_gain ?? null,
      };

      // Determine new-vs-existing explicitly (reliable, unlike comparing
      // createdAt/updatedAt timestamps).
      const existing = await prisma.activity.findUnique({
        where: { userId_source_externalId: { userId, source: "STRAVA", externalId } },
        select: { id: true },
      });

      await prisma.activity.upsert({
        where: { userId_source_externalId: { userId, source: "STRAVA", externalId } },
        create: { userId, stravaId, source: "STRAVA", externalId, ...data },
        update: data,
      });

      if (existing) updated++;
      else imported++;
    }

    // Last (partial) page reached.
    if (activities.length < PER_PAGE) break;
    page++;
  }

  await prisma.stravaConnection.update({
    where: { id: connection.id },
    data: { lastSyncedAt: new Date() },
  });

  return { imported, updated, skipped, duplicates, pagesFetched };
}
