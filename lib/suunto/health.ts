// Suunto 24/7 health sync into DailyCheckin.
// Covers sleep (duration + quality) from the 24/7 sleep samples plus nightly
// resting HR (HRMin) and HRV (AvgHRV) when the samples carry them. Steps,
// joules aggregates and intraday activity samples, and recovery Balance, have
// no DailyCheckin columns — deliberately not synced, honest gap.
//
// Manual-wins semantics everywhere: only empty fields are filled (COALESCE),
// so a user-edited check-in is never clobbered by a backfill.
//
// Real shapes (new-247-api.yaml, servers https://cloudapi.suunto.com/247samples):
// GET /247samples/sleep?from=&to= (epoch ms, max 28-day window,
// Content-Type: application/json required) returns SleepEntryArray:
// [{ timestamp, entryData: { Duration (s), Feeling 1-5, SleepQualityScore
// 0-100, HRAvg, HRMin, AvgHRV, IsNap, BedtimeStart, ... } }]. Naps (IsNap)
// are skipped; longest sleep per athlete-local date wins (mirrors the zip
// importer: naps and duplicates collapse to one honest night).

import { prisma } from "@/lib/prisma";
import {
  isSuuntoAuthFailure,
  isSuuntoRateLimitFailure,
  suuntoGetJson,
  SuuntoRateLimitError,
  withSuuntoClient,
  type SuuntoCredentials,
} from "./client";
import { SUUNTO_SLEEP_PATH } from "./config";
import {
  suuntoFeelingToQuality,
  suuntoSleepQualityToQuality,
  parseSuuntoDateTime,
} from "./suunto-types";

export interface SuuntoHealthResult {
  daysChecked: number;
  sleepFilled: number;
  restingHrFilled: number;
  hrvFilled: number;
  /** True when ≥1 sleep window failed (429/5xx/network) — fills are partial. */
  degraded: boolean;
  /** Failed ≤28-day sleep windows (429/5xx/network; 404 excluded). */
  sleepWindowsFailed: number;
  /** True when the run stopped early on API quota: fills above are partial
   * (already saved via upserts) — wait, then retry. Never a reconnect. */
  rateLimited: boolean;
  /** Seconds from the gateway's Retry-After header, when provided. */
  retryAfterSeconds: number | null;
}

/** Max 247 fetch window per the spec (requests wider than this 400). */
export const SUUNTO_247_MAX_WINDOW_MS = 28 * 24 * 3600 * 1000;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Past `daysBack` days oldest-first, normalized to UTC midnight. */
export function pastDates(daysBack: number, now: Date = new Date()): Date[] {
  const days: Date[] = [];
  const count = Math.max(0, Math.floor(daysBack));
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i),
    );
    days.push(d);
  }
  return days;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

interface SleepValues {
  sleepDuration?: number; // minutes
  sleepQuality?: "POOR" | "OKAY" | "GOOD" | "EXCELLENT";
  restingHr?: number;
  avgHrv?: number;
}

/** Tolerant parse of one 24/7 sleep entry into fill values (null dateIso =
 * unusable or a nap — naps never fill a night). Reads the real entryData
 * fields: Duration (s) → minutes, Feeling (1-5) → quality (SleepQualityScore
 * /100 fallback), HRMin → restingHr, AvgHRV → avgHrv. Anchored on
 * BedtimeStart, falling back to the entry timestamp. */
export function parseSleepRecord(record: unknown): { dateIso: string | null; values: SleepValues } {
  if (typeof record !== "object" || record === null) return { dateIso: null, values: {} };
  const r = record as Record<string, unknown>;
  const rawEntry = r.entryData;
  const entry =
    typeof rawEntry === "object" && rawEntry !== null
      ? (rawEntry as Record<string, unknown>)
      : r;
  // Naps are not nights: skip even when they carry a duration.
  if (entry.IsNap === true) return { dateIso: null, values: {} };
  const values: SleepValues = {};

  const durationS = num(entry.Duration);
  if (durationS !== null && durationS > 0) {
    values.sleepDuration = Math.round(durationS / 60);
  }
  const quality =
    suuntoFeelingToQuality(num(entry.Feeling)) ??
    suuntoSleepQualityToQuality(
      num(entry.SleepQualityScore) !== null ? (num(entry.SleepQualityScore) as number) / 100 : null,
    );
  if (quality) values.sleepQuality = quality;
  const restingHr = num(entry.HRMin);
  if (restingHr !== null && restingHr > 0) values.restingHr = Math.round(restingHr);
  const hrv = num(entry.AvgHRV);
  if (hrv !== null && hrv > 0) values.avgHrv = Math.round(hrv);

  const anchor = parseSuuntoDateTime(
    str(entry.BedtimeStart) ?? str(r.timestamp) ?? str(r.BedtimeStart),
  );
  return { dateIso: anchor ? isoDate(anchor) : null, values };
}

async function fillEmptyFields(
  userId: string,
  dateIso: string,
  values: SleepValues,
): Promise<{ sleep: boolean; hr: boolean; hrv: boolean }> {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  const existing = await prisma.dailyCheckin.findUnique({
    where: { userId_date: { userId, date } },
    select: { sleepDuration: true, sleepQuality: true, restingHr: true, avgHrv: true },
  });
  const patch: Record<string, unknown> = {};
  if (values.sleepDuration !== undefined && (existing?.sleepDuration ?? null) === null) {
    patch.sleepDuration = values.sleepDuration;
  }
  if (values.sleepQuality !== undefined && (existing?.sleepQuality ?? null) === null) {
    patch.sleepQuality = values.sleepQuality;
  }
  if (values.restingHr !== undefined && (existing?.restingHr ?? null) === null) {
    patch.restingHr = values.restingHr;
  }
  if (values.avgHrv !== undefined && (existing?.avgHrv ?? null) === null) {
    patch.avgHrv = values.avgHrv;
  }
  if (Object.keys(patch).length === 0) return { sleep: false, hr: false, hrv: false };
  await prisma.dailyCheckin.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, ...patch },
    update: patch,
  });
  return {
    sleep: patch.sleepDuration !== undefined || patch.sleepQuality !== undefined,
    hr: patch.restingHr !== undefined,
    hrv: patch.avgHrv !== undefined,
  };
}

function asArray(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (typeof body === "object" && body !== null) {
    const payload = (body as { payload?: unknown }).payload;
    if (Array.isArray(payload)) return payload as unknown[];
  }
  return [];
}

/** One 28-day window fetch (from/to epoch ms + Content-Type required).
 * A 404/unsupported path degrades to an empty set, never a failed sync.
 * Anything else (429/5xx/network) is reported via `failed` so the caller
 * can surface partial fills instead of silent ok:true zeros. Quota
 * (SuuntoRateLimitError) propagates — never converted to auth, never
 * swallowed into `failed` — so the run aborts gracefully with partial
 * counts instead of hammering an exhausted quota window-by-window. */
async function fetchSleepWindow(
  creds: SuuntoCredentials,
  fromMs: number,
  toMs: number,
): Promise<{ records: unknown[]; failed: boolean }> {
  try {
    const body = await suuntoGetJson(
      creds,
      SUUNTO_SLEEP_PATH,
      { from: String(Math.floor(fromMs)), to: String(Math.floor(toMs)) },
      { "Content-Type": "application/json" },
    );
    return { records: asArray(body), failed: false };
  } catch (err) {
    // Quota first: the gateway reuses 401 for rate limits, and the message
    // carries the status — an auth check first would misroute it.
    if (isSuuntoRateLimitFailure(err)) throw err;
    // Auth failures must still surface as "reconnect needed".
    if (err instanceof Error && isSuuntoAuthFailure(err)) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    // 404 means the endpoint is unsupported for this user/app: honest
    // empty, not a failure. Status format matches throwForStatus
    // (`... failed (404): ...`).
    if (/\(404\)/.test(msg)) return { records: [], failed: false };
    console.warn(`Suunto sleep fetch degraded (continuing without health): ${msg.slice(0, 160)}`);
    return { records: [], failed: true };
  }
}

/** Whole-range sleep fetch, chunked into ≤28-day windows (spec max).
 * One range fetch per chunk, not per day — rate-limit friendly. On quota,
 * remaining windows are skipped (more calls cannot help) and the records
 * fetched so far are kept as partial progress with rateLimited set. */
async function fetchSleepRecords(
  creds: SuuntoCredentials,
  from: Date,
  to: Date,
): Promise<{ records: unknown[]; failedWindows: number; rateLimited: boolean; retryAfterSeconds: number | null }> {
  const records: unknown[] = [];
  let failedWindows = 0;
  let rateLimited = false;
  let retryAfterSeconds: number | null = null;
  let cursor = from.getTime();
  const end = to.getTime();
  if (!(cursor < end)) return { records, failedWindows, rateLimited, retryAfterSeconds };
  while (cursor < end) {
    const windowEnd = Math.min(cursor + SUUNTO_247_MAX_WINDOW_MS, end);
    try {
      const window = await fetchSleepWindow(creds, cursor, windowEnd);
      records.push(...window.records);
      if (window.failed) failedWindows++;
    } catch (err) {
      if (err instanceof SuuntoRateLimitError || isSuuntoRateLimitFailure(err)) {
        rateLimited = true;
        failedWindows++;
        if (err instanceof SuuntoRateLimitError && typeof err.retryAfterSeconds === "number") {
          retryAfterSeconds = err.retryAfterSeconds;
        }
        console.warn(
          `Suunto sleep fetch rate-limited: keeping ${records.length} records so far, skipping remaining windows.` +
            (retryAfterSeconds !== null ? ` Retry after ${retryAfterSeconds}s.` : ""),
        );
        break;
      }
      throw err;
    }
    if (windowEnd >= end) break;
    cursor = windowEnd;
  }
  return { records, failedWindows, rateLimited, retryAfterSeconds };
}

export async function importSuuntoHealth(
  userId: string,
  options: { daysBack?: number; fullResync?: boolean } = {},
): Promise<SuuntoHealthResult> {
  // Full resync = past year (365), matching ?full=1 → 365 in the job
  // route and the "past year of health" UI copy.
  const daysBack = options.fullResync ? 365 : (options.daysBack ?? 30);
  return withSuuntoClient(userId, async (creds) => {
    const result: SuuntoHealthResult = {
      daysChecked: 0,
      sleepFilled: 0,
      restingHrFilled: 0,
      hrvFilled: 0,
      degraded: false,
      sleepWindowsFailed: 0,
      rateLimited: false,
      retryAfterSeconds: null,
    };
    const days = pastDates(daysBack);
    if (days.length === 0) return result;
    const from = days[0];
    const to = new Date(days[days.length - 1].getTime() + 24 * 3600 * 1000);

    const { records: sleepRecords, failedWindows, rateLimited, retryAfterSeconds } =
      await fetchSleepRecords(creds, from, to);
    result.sleepWindowsFailed = failedWindows;
    result.rateLimited = rateLimited;
    result.retryAfterSeconds = retryAfterSeconds;
    result.degraded = failedWindows > 0;

    // Longest sleep per athlete-local date wins (mirrors the zip importer:
    // duplicates collapse to one honest night; naps never reach this map).
    // Any usable value keys the date — HR-only/HRV-only rows without a
    // Duration must survive, not just full sleep nights.
    const sleepByDate = new Map<string, SleepValues>();
    for (const record of sleepRecords) {
      const { dateIso, values } = parseSleepRecord(record);
      if (!dateIso) continue;
      const usable =
        values.sleepDuration !== undefined ||
        values.sleepQuality !== undefined ||
        values.restingHr !== undefined ||
        values.avgHrv !== undefined;
      if (!usable) continue;
      const prev = sleepByDate.get(dateIso);
      if (!prev || (values.sleepDuration ?? 0) > (prev.sleepDuration ?? 0)) {
        sleepByDate.set(dateIso, values);
      }
    }

    for (const day of days) {
      result.daysChecked++;
      const key = isoDate(day);
      const sleep = sleepByDate.get(key) ?? {};
      const filled = await fillEmptyFields(userId, key, sleep);
      if (filled.sleep) result.sleepFilled++;
      if (filled.hr) result.restingHrFilled++;
      if (filled.hrv) result.hrvFilled++;
    }
    return result;
  });
}
