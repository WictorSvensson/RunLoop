// Suunto Cloud API activity import into the reused Activity table.
// Paginated incremental sync by default: server-side `since` (high-water
// mark minus 24 h overlap, modification-time filtered so backdated edits
// surface) plus a client-side cutoff backstop. Whole-history backfill on
// fullResync (`since` omitted). Every workout gets its FIT downloaded and
// merged — FIT is the device record and wins every conflict; the list
// summary (SummaryExtension watts/cadence, energyConsumption calories,
// totalAscent) fills whatever FIT leaves null.
//
// Detail endpoint (GET /v3/workouts/{key}) is deliberately NOT called: the
// list payload already carries extensions, and the dev-tier quota
// (10 calls/min, 200/week) is spent on FIT downloads instead.
//
// Dedup: same ±10 min / ±300 s twin rule as the other importers, via the
// shared matcher in lib/analysis/duplicate.ts (multi-brand safe). Own
// SUUNTO rows upsert on (userId, source, externalId) where externalId is the
// Cloud API workoutKey — the same stable key the manual zip upload would
// never produce (it uses filename stems), so API and zip rows twin-match via
// the time window instead of colliding on keys.
//
// Quota note: the Developer API tier allows 10 calls/min up to 200/week. A
// sync costs ~1 list call per page + 1 FIT download per workout, so a large
// FIRST full resync can exhaust the weekly quota — prefer ?limit=N to stage
// it across weeks, then rely on cheap incremental syncs afterwards.

import { prisma } from "@/lib/prisma";
import { decodeFit, fitStreamPayload, mergeSummaryWithFit } from "../../scripts/import-suunto/fit";
import type { TrackSummary } from "../../scripts/import-suunto/gpx";
import { findDuplicateCandidate } from "@/lib/analysis/duplicate";
import { mapSuuntoWorkout, type MappedSuuntoWorkout, type SuuntoApiWorkout } from "./suunto-types";
import { SUUNTO_DUP_START_WINDOW_S, SUUNTO_WORKOUTS_PATH } from "./config";
import {
  downloadSuuntoFitBytes,
  isSuuntoAuthFailure,
  isSuuntoRateLimitFailure,
  listSuuntoWorkouts,
  refreshSuuntoCredentials,
  SuuntoRateLimitError,
  withSuuntoClient,
  type SuuntoCredentials,
} from "./client";

export interface SuuntoImportResult {
  imported: number; // newly created activities
  updated: number; // existing activities refreshed
  skipped: number; // rows we couldn't parse
  duplicates: number; // rows twinning another source, skipped
  fitMerged: number; // rows enriched with FIT data
  fitFailed: number; // rows kept summary-only (download/decode failed)
  pagesFetched: number;
  /** True when ≥1 FIT download failed with 401/403 even after a fresh-token
   * retry — i.e. authorization (scope/subscription), not expiry. The
   * affected rows are kept summary-only; re-running the sync cannot help,
   * check the Suunto API Zone subscription + granted scopes instead. */
  fitUnauthorized: boolean;
  /** FIT failure reasons (truncated messages) → count. Diagnostic only. */
  fitErrors: Record<string, number>;
  /** True when the run stopped early on API quota (10/min, 200/week): the
   * counts above are partial progress (already saved via upserts) — wait,
   * then resume with ?limit=N. Never paired with fitUnauthorized/reconnect:
   * quota is not a dead grant. */
  rateLimited: boolean;
  /** Seconds from the gateway's Retry-After header, when provided. */
  retryAfterSeconds: number | null;
}

/** Mutable per-run sync state: the live credentials (rotated once mid-sync
 * when a FIT 401 reveals the access token expired after the list calls
 * succeeded) plus whether that one mid-sync refresh already happened. */
interface SyncState {
  creds: SuuntoCredentials;
  fitRefreshedMidSync: boolean;
}

const PAGE_SIZE = 50;

// Safety cap so a runaway loop can never hammer the API past sane limits.
// 50 pages × 50 = 2500 activities per run; resume by re-running (upserts
// make it idempotent). PAGE_SIZE matches the documented list default: the
// short-page stop rule below is only correct when the server honors the
// requested size, and 50 is the one size the spec guarantees.
const MAX_PAGES = 50;

export const SUUNTO_SOURCE = "SUUNTO";

/**
 * List one page, retrying the SAME offset once with a fresh token on an
 * auth-shaped failure — but only when no refresh has happened yet this run.
 * Without this, a list 401 escapes to withSuuntoClient, which re-invokes the
 * whole import closure from offset=0 (losing the page cursor and re-spending
 * quota). When the token was already refreshed seconds ago (FIT path set
 * fitRefreshedMidSync), the fresh token itself is rejected — authorization,
 * not expiry — so the error propagates to the outer retry, whose
 * fresh-token guard converts it straight to reconnect instead of a doomed
 * second full pass.
 */
async function listPageWithRefresh(
  userId: string,
  state: SyncState,
  args: { offset: number; limit: number; sinceMs: number | null },
  path: string,
): Promise<SuuntoApiWorkout[]> {
  try {
    return await listSuuntoWorkouts(state.creds, args, path);
  } catch (err) {
    // Quota is never refreshed (a refresh burns more of the same 10/min
    // quota) — propagate so the run aborts gracefully with partial counts.
    if (isSuuntoRateLimitFailure(err)) throw err;
    if (!isSuuntoAuthFailure(err) || state.fitRefreshedMidSync) throw err;
    state.fitRefreshedMidSync = true;
    console.warn(
      `Suunto workout list unauthorized at offset=${args.offset}; refreshing token in place and retrying same offset once.`,
    );
    state.creds = await refreshSuuntoCredentials(userId);
    return await listSuuntoWorkouts(state.creds, args, path);
  }
}

/** Counts a FIT failure by (truncated) reason; warns the first few in full. */
function recordFitError(
  result: SuuntoImportResult,
  externalId: string,
  message: string,
): void {
  const reason = message.slice(0, 160);
  result.fitErrors[reason] = (result.fitErrors[reason] ?? 0) + 1;
  if (result.fitFailed < 5) {
    console.warn(`Suunto FIT failed for workout ${externalId}: ${reason}`);
  }
}

/** Minimal summary so the shared FIT merge applies unchanged. API list
 * values the merge ignores (maxSpeed, ascent) ride along so FIT fills only
 * what the summary truly lacks. */
function summaryFromMapped(m: MappedSuuntoWorkout): TrackSummary {
  return {
    distance: m.distance,
    elapsedTime: m.elapsedTime ?? 0,
    movingTime: m.movingTime ?? m.elapsedTime ?? 0,
    averageSpeed: m.averageSpeed,
    maxSpeed: m.maxSpeed,
    averageHeartrate: m.averageHeartrate,
    maxHeartrate: m.maxHeartrate,
    totalElevationGain: m.totalElevationGain,
    series: { time: [], distance: [], heartrate: [], altitude: [] },
  };
}

async function importPage(
  userId: string,
  state: SyncState,
  workouts: SuuntoApiWorkout[],
  result: SuuntoImportResult,
  cutoff: Date | null,
  maxActivities: number | null,
  processed: { count: number },
): Promise<boolean> {
  // Returns true when the cutoff — or the diagnostic cap — was reached
  // (caller stops paginating). One twin-check query per page (not per
  // activity): cover the page's full date range ± window, then match in
  // memory with the shared matcher.
  const mappedAll: (MappedSuuntoWorkout | null)[] = workouts.map((w) => {
    const m = mapSuuntoWorkout(w);
    if (!m) result.skipped++;
    return m;
  });
  const mapped = mappedAll.filter((m): m is MappedSuuntoWorkout => m !== null);

  let twins: { startDate: Date; elapsedTime: number | null }[] = [];
  if (mapped.length > 0) {
    const starts = mapped.map((m) => m.startDate.getTime());
    twins = await prisma.activity.findMany({
      where: {
        userId,
        source: { not: SUUNTO_SOURCE },
        startDate: {
          gt: new Date(Math.min(...starts) - SUUNTO_DUP_START_WINDOW_S * 1000),
          lt: new Date(Math.max(...starts) + SUUNTO_DUP_START_WINDOW_S * 1000),
        },
      },
      select: { startDate: true, elapsedTime: true },
    });
  }

  // The list API documents no sort order, so never trust page order: sort
  // newest-first locally, then import the whole page — a row older than the
  // cutoff only stops pagination, never the current page (an unsorted page
  // can mix newer rows behind an older one).
  const order = mappedAll
    .filter((m): m is MappedSuuntoWorkout => m !== null)
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());

  let reachedCutoff = false;
  for (const m of order) {
    if (cutoff && m.startDate < cutoff) {
      reachedCutoff = true;
      continue;
    }
    if (maxActivities !== null && processed.count >= maxActivities) return true;
    await importOne(userId, state, m, twins, result);
    processed.count++;
  }
  return reachedCutoff;
}

async function importOne(
  userId: string,
  state: SyncState,
  mapped: MappedSuuntoWorkout,
  twins: { startDate: Date; elapsedTime: number | null }[],
  result: SuuntoImportResult,
): Promise<void> {
  // Twin check against non-Suunto rows (own SUUNTO rows are handled by the
  // externalId upsert below — matching them here would freeze updates).
  if (findDuplicateCandidate(twins, mapped.startDate, mapped.elapsedTime)) {
    result.duplicates++;
    return;
  }

  // FIT download (best-effort; summary-only row when it fails). Failures
  // are counted by reason and the first few logged in full. Auth-shaped
  // failures get exactly one mid-sync token refresh + retry: the list calls
  // may have succeeded with a token that expired before the FIT loop
  // reached this workout, and swallowing that 401 would pin every
  // remaining download to the stale token (withSuuntoClient's retry never
  // fires — fn itself doesn't throw). A 401 that survives a fresh token is
  // authorization (scope/subscription), not expiry: the row stays
  // summary-only and fitUnauthorized flags it instead of failing the sync.
  let fit = null;
  try {
    const bytes = await downloadSuuntoFitBytes(state.creds, mapped.externalId);
    fit = decodeFit(bytes);
    if (!fit) {
      recordFitError(result, mapped.externalId, `decoded no session (${bytes.byteLength} bytes)`);
    }
  } catch (err) {
    // Quota aborts the whole run (propagates to importSuuntoActivities,
    // which keeps partial counts): swallowing it here would pin every
    // remaining download to hammering an exhausted quota, and it must never
    // set fitUnauthorized (quota is not a dead grant).
    if (isSuuntoRateLimitFailure(err)) throw err;
    if (isSuuntoAuthFailure(err) && !state.fitRefreshedMidSync) {
      state.fitRefreshedMidSync = true;
      console.warn(
        `Suunto FIT unauthorized for workout ${mapped.externalId}; refreshing token mid-sync and retrying once.`,
      );
      try {
        state.creds = await refreshSuuntoCredentials(userId);
        const bytes = await downloadSuuntoFitBytes(state.creds, mapped.externalId);
        fit = decodeFit(bytes);
        if (!fit) {
          recordFitError(result, mapped.externalId, `decoded no session (${bytes.byteLength} bytes)`);
        }
      } catch (retryErr) {
        if (isSuuntoRateLimitFailure(retryErr)) throw retryErr;
        fit = null;
        if (isSuuntoAuthFailure(retryErr)) result.fitUnauthorized = true;
        recordFitError(
          result,
          mapped.externalId,
          retryErr instanceof Error ? retryErr.message : String(retryErr),
        );
      }
    } else {
      fit = null;
      if (isSuuntoAuthFailure(err)) result.fitUnauthorized = true;
      recordFitError(
        result,
        mapped.externalId,
        err instanceof Error ? err.message : String(err),
      );
    }
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
    startDateLocal: mapped.startDateLocal,
    distance: merged.distance,
    movingTime: mapped.movingTime,
    elapsedTime: mapped.elapsedTime,
    averageSpeed: merged.averageSpeed,
    maxSpeed: merged.maxSpeed,
    averageHeartrate: merged.averageHeartrate,
    maxHeartrate: merged.maxHeartrate,
    totalElevationGain: merged.totalElevationGain,
    // mergeSummaryWithFit overwrites these unconditionally from FIT (the
    // TrackSummary carries no API values for them): FIT wins, API fills.
    averageCadence: merged.averageCadence ?? mapped.averageCadence,
    averageWatts: merged.averageWatts ?? mapped.averageWatts,
    maxWatts: merged.maxWatts ?? mapped.maxWatts,
    calories: merged.calories ?? mapped.calories,
    detailFetchedAt: now,
    analysisDataFetchedAt: analysisReady ? now : null,
  };

  const existing = await prisma.activity.findUnique({
    where: { userId_source_externalId: { userId, source: SUUNTO_SOURCE, externalId: mapped.externalId } },
    select: { id: true },
  });

  const activity = await prisma.activity.upsert({
    where: { userId_source_externalId: { userId, source: SUUNTO_SOURCE, externalId: mapped.externalId } },
    create: { userId, source: SUUNTO_SOURCE, externalId: mapped.externalId, ...data },
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

export async function importSuuntoActivities(
  userId: string,
  options: { fullResync?: boolean; maxActivities?: number } = {},
): Promise<SuuntoImportResult> {
  // maxActivities caps total rows processed (diagnostics: reproduce on a
  // couple of workouts via ?limit=N instead of a long full sync).
  const maxActivities =
    options.maxActivities !== undefined && options.maxActivities > 0
      ? Math.floor(options.maxActivities)
      : null;
  const processed = { count: 0 };
  return withSuuntoClient(userId, async (creds) => {
    const result: SuuntoImportResult = {
      imported: 0,
      updated: 0,
      skipped: 0,
      duplicates: 0,
      fitMerged: 0,
      fitFailed: 0,
      pagesFetched: 0,
      fitUnauthorized: false,
      fitErrors: {},
      rateLimited: false,
      retryAfterSeconds: null,
    };
    const state: SyncState = { creds, fitRefreshedMidSync: false };

    // Quota aborts the run gracefully: the result accumulated so far is
    // partial progress (rows are upserted as they import), so it is
    // returned as-is with rateLimited set — lastSyncedAt is deliberately
    // NOT advanced, so the next run resumes where this one stopped.
    // withSuuntoClient passes SuuntoRateLimitError through untouched (no
    // refresh, no reconnect conversion); only this catch interprets it.
    try {
      if (options.fullResync) {
        // Whole history, newest-first pages until a short page (capped).
        // sinceMs omitted: server defaults to 0 (everything).
        let start = 0;
        for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
          const page = await listPageWithRefresh(
            userId,
            state,
            { offset: start, limit: PAGE_SIZE, sinceMs: null },
            SUUNTO_WORKOUTS_PATH,
          );
          result.pagesFetched++;
          const done = await importPage(userId, state, page, result, null, maxActivities, processed);
          if (done || page.length < PAGE_SIZE) break;
          start += PAGE_SIZE;
        }
        await prisma.suuntoConnection.update({
          where: { userId },
          data: { lastSyncedAt: new Date() },
        });
        return result;
      }

      // Incremental: newest-first pages, stopping past a 1-day overlap before
      // the high-water mark (catches backdated edits). Paginates — not just
      // the first page — so a fresh user (no high-water mark yet) imports
      // everything, not just the newest 100.
      const latest = await prisma.activity.findFirst({
        where: { userId, source: SUUNTO_SOURCE },
        orderBy: { startDate: "desc" },
        select: { startDate: true },
      });
      const cutoff = latest
        ? new Date(latest.startDate.getTime() - 24 * 60 * 60 * 1000)
        : null;
      let start = 0;
      // Server-side `since` (modification-time filtered, so backdated edits
      // surface) plus the client-side cutoff backstop in importPage.
      const sinceMs = cutoff ? cutoff.getTime() : null;
      for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
        const page = await listPageWithRefresh(
          userId,
          state,
          { offset: start, limit: PAGE_SIZE, sinceMs },
          SUUNTO_WORKOUTS_PATH,
        );
        result.pagesFetched++;
        if (page.length === 0) break;
        const reachedCutoff = await importPage(userId, state, page, result, cutoff, maxActivities, processed);
        if (reachedCutoff || page.length < PAGE_SIZE) break;
        start += PAGE_SIZE;
      }
      await prisma.suuntoConnection.update({
        where: { userId },
        data: { lastSyncedAt: new Date() },
      });
      return result;
    } catch (err) {
      if (err instanceof SuuntoRateLimitError || isSuuntoRateLimitFailure(err)) {
        result.rateLimited = true;
        result.retryAfterSeconds =
          err instanceof SuuntoRateLimitError && typeof err.retryAfterSeconds === "number"
            ? err.retryAfterSeconds
            : null;
        console.warn(
          `Suunto sync rate-limited after ${processed.count} rows (${result.pagesFetched} pages): ` +
            `keeping partial progress, resume with ?limit=N.` +
            (result.retryAfterSeconds !== null ? ` Retry after ${result.retryAfterSeconds}s.` : ""),
        );
        return result;
      }
      throw err;
    }
  });
}
