// Garmin daily health sync into DailyCheckin.
// Covers sleep (duration + quality), overnight HRV and resting HR — all
// nested in the getSleepData response, plus a getHeartRate fallback for
// resting HR. Absolute Body Battery (0-100) is not exposed by this library
// version (only deltas), so it stays empty rather than fabricated.
//
// Manual-wins semantics everywhere: only empty fields are filled (COALESCE),
// so a user-edited check-in is never clobbered by a backfill.

import { GarminConnect } from "@flow-js/garmin-connect";
import { prisma } from "@/lib/prisma";
import { garminSleepQualifierToQuality } from "./garmin-types";
import { withGarminClient } from "./client";

export interface GarminHealthResult {
  daysChecked: number;
  sleepFilled: number;
  restingHrFilled: number;
  hrvFilled: number;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Past `daysBack` days oldest-first, normalized to UTC midnight (sequential = rate-limit friendly). */
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

async function fillEmptyFields(
  userId: string,
  dateIso: string,
  values: {
    sleepDuration?: number;
    sleepQuality?: "POOR" | "OKAY" | "GOOD" | "EXCELLENT";
    restingHr?: number;
    avgHrv?: number;
  },
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

async function syncOneDay(
  userId: string,
  client: GarminConnect,
  day: Date,
  result: GarminHealthResult,
): Promise<void> {
  result.daysChecked++;
  const values: {
    sleepDuration?: number;
    sleepQuality?: "POOR" | "OKAY" | "GOOD" | "EXCELLENT";
    restingHr?: number;
    avgHrv?: number;
  } = {};

  // One call carries sleep + overnight HRV + resting HR (SleepData nests
  // dailySleepDTO alongside avgOvernightHrv/restingHeartRate). Absolute Body
  // Battery (0-100) is not exposed here — only deltas — so it stays empty
  // rather than fabricated.
  let anchorIso = isoDate(day);
  try {
    const sleep = await client.getSleepData(day);
    const dto = sleep?.dailySleepDTO;
    // Garmin's calendarDate is already the athlete-local day — anchor on it
    // so near-midnight sleep lands on the right check-in (the Suunto importer
    // needed explicit TZ bucketing for exactly this reason).
    if (dto && typeof dto.calendarDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dto.calendarDate)) {
      anchorIso = dto.calendarDate;
    }
    if (dto && typeof dto.sleepTimeSeconds === "number" && dto.sleepTimeSeconds > 0) {
      values.sleepDuration = Math.round(dto.sleepTimeSeconds / 60);
      const quality = garminSleepQualifierToQuality(
        dto.sleepScores?.overall?.qualifierKey ?? null,
      );
      if (quality) values.sleepQuality = quality;
    }
    if (sleep && typeof sleep.avgOvernightHrv === "number" && sleep.avgOvernightHrv > 0) {
      values.avgHrv = Math.round(sleep.avgOvernightHrv);
    }
    if (sleep && typeof sleep.restingHeartRate === "number" && sleep.restingHeartRate > 0) {
      values.restingHr = Math.round(sleep.restingHeartRate);
    }
  } catch {
    // No sleep recorded that day — not an error.
  }

  if (values.restingHr === undefined) {
    try {
      const hr = await client.getHeartRate(day);
      if (hr && typeof hr.restingHeartRate === "number" && hr.restingHeartRate > 0) {
        values.restingHr = Math.round(hr.restingHeartRate);
      }
    } catch {
      // No HR data that day — not an error.
    }
  }

  // Garmin calendarDate is already the athlete-local day; anchor the upsert
  // on it when sleep exists, otherwise the iterated UTC day.
  const filled = await fillEmptyFields(userId, anchorIso, values);
  if (filled.sleep) result.sleepFilled++;
  if (filled.hr) result.restingHrFilled++;
  if (filled.hrv) result.hrvFilled++;
}

export async function importGarminHealth(
  userId: string,
  options: { daysBack?: number; fullResync?: boolean } = {},
): Promise<GarminHealthResult> {
  const daysBack = options.fullResync ? 1095 : (options.daysBack ?? 30);
  return withGarminClient(userId, async (client) => {
    const result: GarminHealthResult = {
      daysChecked: 0,
      sleepFilled: 0,
      restingHrFilled: 0,
      hrvFilled: 0,
    };
    for (const day of pastDates(daysBack)) {
      await syncOneDay(userId, client, day, result);
    }
    return result;
  });
}
