// Garmin activity import into the reused Activity table.
// Paginated full-history backfill by default (Garmin cloud holds everything,
// unlike the Suunto manual export), incremental high-water-mark sync
// afterwards. Every activity gets its
// original FIT downloaded and merged — FIT is the device record, so the
// shared merge (scripts/import-suunto/fit.ts) fills distance/HR/cadence/
// power/calories/laps wherever the list summary is thin.
//
// Dedup: same ±10 min / ±300 s twin rule as the other importers, via the
// shared matcher in lib/analysis/duplicate.ts (multi-brand safe).

import { GarminConnect } from "@flow-js/garmin-connect";
import type { IActivity } from "@flow-js/garmin-connect";
import { prisma } from "@/lib/prisma";
import { decodeFit, fitStreamPayload, mergeSummaryWithFit } from "../../scripts/import-suunto/fit";
import type { TrackSummary } from "../../scripts/import-suunto/gpx";
import { findDuplicateCandidate } from "@/lib/analysis/duplicate";
import {
  mapGarminActivity,
  type MappedGarminActivity,
} from "./garmin-types";
import { GARMIN_DUP_START_WINDOW_S } from "./config";
import { downloadFitBytes, withGarminClient } from "./client";

export interface GarminImportResult {
  imported: number; // newly created activities
  updated: number; // existing activities refreshed
  skipped: number; // rows we couldn't parse
  duplicates: number; // rows twinning another source, skipped
  fitMerged: number; // rows enriched with FIT data
  fitFailed: number; // rows kept summary-only (download/decode failed)
  pagesFetched: number;
  /** FIT failure reasons (truncated messages) → count. Diagnostic only. */
  fitErrors: Record<string, number>;
}

const PAGE_SIZE = 100;

// Safety cap so a runaway loop can never hammer the API past sane limits.
// 50 pages × 100 = 5000 activities per run; resume by re-running (upserts
// make it idempotent).
const MAX_PAGES = 50;

export const GARMIN_SOURCE = "GARMIN";

/** Counts a FIT failure by (truncated) reason; warns the first few in full. */
function recordFitError(
  result: GarminImportResult,
  externalId: string,
  message: string,
): void {
  const reason = message.slice(0, 160);
  result.fitErrors[reason] = (result.fitErrors[reason] ?? 0) + 1;
  if (result.fitFailed < 5) {
    console.warn(`Garmin FIT failed for activity ${externalId}: ${reason}`);
  }
}

/** Minimal summary so the shared FIT merge applies unchanged (no GPX here). */
function summaryFromMapped(m: MappedGarminActivity): TrackSummary {
  return {
    distance: m.distance,
    elapsedTime: m.elapsedTime ?? 0,
    movingTime: m.movingTime ?? m.elapsedTime ?? 0,
    averageSpeed: m.averageSpeed,
    maxSpeed: null,
    averageHeartrate: m.averageHeartrate,
    maxHeartrate: m.maxHeartrate,
    totalElevationGain: null,
    series: { time: [], distance: [], heartrate: [], altitude: [] },
  };
}

async function importPage(
  userId: string,
  client: GarminConnect,
  activities: IActivity[],
  result: GarminImportResult,
  cutoff: Date | null,
  maxActivities: number | null,
  processed: { count: number },
): Promise<boolean> {
  // Returns true when the cutoff — or the diagnostic cap — was reached
  // (caller stops paginating). One twin-check query per page (not per
  // activity): cover the page's full date range ± window, then match in
  // memory with the shared matcher.
  const mappedAll: (MappedGarminActivity | null)[] = activities.map((a) => {
    const m = mapGarminActivity(a);
    if (!m) result.skipped++;
    return m;
  });
  const mapped = mappedAll.filter((m): m is MappedGarminActivity => m !== null);

  let twins: { startDate: Date; elapsedTime: number | null }[] = [];
  if (mapped.length > 0) {
    const starts = mapped.map((m) => m.startDate.getTime());
    twins = await prisma.activity.findMany({
      where: {
        userId,
        source: { not: GARMIN_SOURCE },
        startDate: {
          gt: new Date(Math.min(...starts) - GARMIN_DUP_START_WINDOW_S * 1000),
          lt: new Date(Math.max(...starts) + GARMIN_DUP_START_WINDOW_S * 1000),
        },
      },
      select: { startDate: true, elapsedTime: true },
    });
  }

  for (let i = 0; i < activities.length; i++) {
    const m = mappedAll[i];
    if (!m) continue; // already counted as skipped
    if (cutoff && m.startDate < cutoff) return true;
    if (maxActivities !== null && processed.count >= maxActivities) return true;
    await importOne(userId, client, activities[i], m, twins, result);
    processed.count++;
  }
  return false;
}

async function importOne(
  userId: string,
  client: GarminConnect,
  a: IActivity,
  mapped: MappedGarminActivity,
  twins: { startDate: Date; elapsedTime: number | null }[],
  result: GarminImportResult,
): Promise<void> {
  // Twin check against non-Garmin rows (own GARMIN rows are handled by the
  // externalId upsert below — matching them here would freeze updates).
  if (findDuplicateCandidate(twins, mapped.startDate, mapped.elapsedTime)) {
    result.duplicates++;
    return;
  }

  // FIT download (best-effort; summary-only row when it fails). Failures
  // are counted by reason and the first few logged in full — a silent catch
  // here once hid a 467-row systematic FIT outage.
  let fit = null;
  try {
    const bytes = await downloadFitBytes(client, a.activityId);
    fit = decodeFit(bytes);
    if (!fit) {
      recordFitError(result, mapped.externalId, `decoded no session (${bytes.byteLength} bytes)`);
    }
  } catch (err) {
    fit = null;
    recordFitError(
      result,
      mapped.externalId,
      err instanceof Error ? err.message : String(err),
    );
  }
  if (fit) result.fitMerged++;
  else result.fitFailed++;

  const merged = mergeSummaryWithFit(summaryFromMapped(mapped), fit);
  const now = new Date();
  // analysisDataFetchedAt claims "streams stored" — only set it when FIT
  // actually delivered. Summary-only rows stay honestly not-ready (volume,
  // pace and coach facts work from columns regardless).
  const analysisReady = fit !== null && fit.series.time.length > 0;

  const data = {
    name: mapped.name,
    type: mapped.type,
    startDate: mapped.startDate,
    distance: merged.distance,
    movingTime: mapped.movingTime,
    elapsedTime: mapped.elapsedTime,
    averageSpeed: merged.averageSpeed,
    maxSpeed: merged.maxSpeed,
    averageHeartrate: merged.averageHeartrate,
    maxHeartrate: merged.maxHeartrate,
    totalElevationGain: merged.totalElevationGain,
    startDateLocal: mapped.startDateLocal,
    averageCadence: merged.averageCadence,
    averageWatts: merged.averageWatts,
    maxWatts: merged.maxWatts,
    calories: merged.calories,
    detailFetchedAt: now,
    analysisDataFetchedAt: analysisReady ? now : null,
  };

  const existing = await prisma.activity.findUnique({
    where: { userId_source_externalId: { userId, source: GARMIN_SOURCE, externalId: mapped.externalId } },
    select: { id: true },
  });

  const activity = await prisma.activity.upsert({
    where: { userId_source_externalId: { userId, source: GARMIN_SOURCE, externalId: mapped.externalId } },
    create: { userId, source: GARMIN_SOURCE, externalId: mapped.externalId, ...data },
    // A FIT-less re-run must not unmark a previously ready row: undefined
    // fields are left untouched by Prisma.
    update: analysisReady ? data : { ...data, analysisDataFetchedAt: undefined },
    select: { id: true },
  });
  if (existing) result.updated++;
  else result.imported++;

  // Laps + streams, same replace-and-mark-ready contract as the other
  // importers. FIT series carry their own fitTime offsets (record-indexed);
  // lap startIndex/endIndex address those same series arrays, with absolute
  // startDate as the cross-clock anchor (FIT fitTime vs GPX time differ).
  const fitLaps = fit?.laps ?? [];
  await prisma.$transaction(async (tx) => {
    if (fitLaps.length > 0) {
      await tx.activityLap.deleteMany({ where: { activityId: activity.id } });
      await tx.activityLap.createMany({
        data: fitLaps.map((lap) => ({
          activityId: activity.id,
          lapIndex: lap.lapIndex,
          startDate: lap.startDate,
          distance: lap.distance,
          movingTime: lap.movingTime,
          elapsedTime: lap.elapsedTime,
          startIndex: lap.startIndex,
          endIndex: lap.endIndex,
          averageSpeed: lap.averageSpeed,
          maxSpeed: lap.maxSpeed,
          averageHeartrate: lap.averageHeartrate,
          maxHeartrate: lap.maxHeartrate,
          averageCadence: lap.averageCadence,
          averageWatts: lap.averageWatts,
          totalElevationGain: lap.totalElevationGain,
        })),
      });
    }
    const payload: Record<string, { data: (number | null)[] }> = {};
    if (fit && fit.series.time.length > 0) {
      Object.assign(payload, fitStreamPayload(fit.series));
      if (fit.series.distance.length > 0) payload.distance = { data: fit.series.distance };
      await tx.activityStream.upsert({
        where: { activityId: activity.id },
        create: { activityId: activity.id, payload, fetchedAt: now },
        update: { payload, fetchedAt: now },
      });
    }
    // No FIT this run: laps and streams are left untouched (a transient
    // download failure must never wipe previously stored analysis data).
  });
}

export async function importGarminActivities(
  userId: string,
  options: { fullResync?: boolean; maxActivities?: number } = {},
): Promise<GarminImportResult> {
  // maxActivities caps total rows processed (diagnostics: reproduce on a
  // couple of activities via ?limit=N instead of a 6-minute full sync).
  const maxActivities =
    options.maxActivities !== undefined && options.maxActivities > 0
      ? Math.floor(options.maxActivities)
      : null;
  const processed = { count: 0 };
  return withGarminClient(userId, async (client) => {
    const result: GarminImportResult = {
      imported: 0,
      updated: 0,
      skipped: 0,
      duplicates: 0,
      fitMerged: 0,
      fitFailed: 0,
      pagesFetched: 0,
      fitErrors: {},
    };

    if (options.fullResync) {
      // Whole history, newest-first pages until a short page (capped).
      let start = 0;
      for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
        const page = await client.getActivities(start, PAGE_SIZE);
        result.pagesFetched++;
        const done = await importPage(userId, client, page, result, null, maxActivities, processed);
        if (done || page.length < PAGE_SIZE) break;
        start += PAGE_SIZE;
      }
      await prisma.garminConnection.update({
        where: { userId },
        data: { lastSyncedAt: new Date() },
      });
      return result;
    }

    // Incremental: newest-first pages, stopping past a 1-day overlap before
    // the high-water mark (catches backdated edits). Paginates — not just the first page — so a fresh user (no
    // high-water mark yet) imports everything, not just the newest 100.
    const latest = await prisma.activity.findFirst({
      where: { userId, source: GARMIN_SOURCE },
      orderBy: { startDate: "desc" },
      select: { startDate: true },
    });
    const cutoff = latest
      ? new Date(latest.startDate.getTime() - 24 * 60 * 60 * 1000)
      : null;
    let start = 0;
    for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
      const page = await client.getActivities(start, PAGE_SIZE);
      result.pagesFetched++;
      if (page.length === 0) break;
      const reachedCutoff = await importPage(userId, client, page, result, cutoff, maxActivities, processed);
      if (reachedCutoff || page.length < PAGE_SIZE) break;
      start += PAGE_SIZE;
    }
    await prisma.garminConnection.update({
      where: { userId },
      data: { lastSyncedAt: new Date() },
    });
    return result;
  });
}
