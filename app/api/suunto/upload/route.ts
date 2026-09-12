import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentUser } from "@/lib/current-user";
import { extractZip } from "@/lib/zip";
import { normalizeExportPaths, qualityToSleepQuality } from "@/lib/suunto-files";
import {
  parseGpxTrackPoints,
  summarizeTrack,
  parseSuuntoFilename,
  suuntoSportToActivityType,
  resolveSuspiciousTrack,
} from "@/scripts/import-suunto/gpx.ts";
import {
  decodeFit,
  mergeSummaryWithFit,
  type FitLap,
  type FitSummary,
} from "@/scripts/import-suunto/fit.ts";

// POST /api/suunto/upload — import a Suunto history export (.zip from the
// Suunto app, field "zip") for the current user.
//
// Parsing reuses scripts/import-suunto/{gpx,fit}.ts; persistence mirrors the
// CLI backfiller (scripts/import-suunto/import.ts) via Prisma instead of raw
// pg: idempotent upsert on (userId, source, externalId), FIT laps/streams
// gap-fill, and sleep backfill that only fills empty check-in fields
// that only fills empty check-in fields (manual entries always win).
//
// Robustness: session required; 512 MB cap; extraction and parsing fully
// in-memory (never written to disk); the export timezone is validated before
// any write; each workout and each sleep day is isolated so one bad file
// counts as skipped instead of failing the whole batch.
// Long histories can take minutes — this is a local-app route, not an edge
// function (see runtime/maxDuration below).

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_FILES = 30000;
const FALLBACK_TIMEZONE = "Europe/Stockholm";

type UploadStats = {
  imported: number;
  updated: number;
  skipped: number;
  byType: Record<string, number>;
};

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : "";
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

function isKnownTimezone(value: string): boolean {
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      return (Intl.supportedValuesOf("timeZone") as string[]).includes(value);
    }
  } catch {
    // Fall through to the probe below.
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const zipPart = form.get("zip");
  if (!(zipPart instanceof File) || zipPart.size === 0) {
    return NextResponse.json(
      { error: "No zip received. Upload the Suunto history export (.zip)." },
      { status: 400 },
    );
  }
  if (zipPart.size > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      { error: "Zip is larger than 512 MB. Split the export and upload in parts." },
      { status: 400 },
    );
  }

  let rawEntries;
  try {
    rawEntries = extractZip(new Uint8Array(await zipPart.arrayBuffer()));
  } catch {
    return NextResponse.json(
      { error: "Could not read that zip (unsupported or corrupt archive)." },
      { status: 400 },
    );
  }
  if (rawEntries.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Too many files (${rawEntries.length}, max ${MAX_FILES}). Split the export and upload in parts.` },
      { status: 400 },
    );
  }

  // Normalize + dedupe by normalized path (keep first): a zip mixing a
  // wrapper root with loose files can otherwise process one workout twice.
  const stats: UploadStats = { imported: 0, updated: 0, skipped: 0, byType: {} };
  const byPath = new Map<string, Uint8Array>();
  const normalized = normalizeExportPaths(rawEntries.map((e) => e.name));
  rawEntries.forEach((entry, i) => {
    const path = normalized[i];
    if (!byPath.has(path)) {
      byPath.set(path, entry.data);
    } else {
      stats.skipped++;
    }
  });
  // Case-insensitive lookup index (Windows-style .GPX/.FIT mates): original
  // paths are preserved for parsing and externalIds.
  const lowerIndex = new Map<string, string>();
  for (const path of byPath.keys()) {
    const lower = path.toLowerCase();
    if (!lowerIndex.has(lower)) lowerIndex.set(lower, path);
  }
  const resolveCI = (path: string): string | null => {
    if (byPath.has(path)) return path;
    return lowerIndex.get(path.toLowerCase()) ?? null;
  };

  const gpxPaths = [...byPath.keys()].filter((p) => p.toLowerCase().endsWith(".gpx"));
  if (gpxPaths.length === 0) {
    return NextResponse.json(
      { error: "No workouts found — this doesn't look like a Suunto export (expected workouts/*.gpx)." },
      { status: 400 },
    );
  }

  // Export athlete profile: timezone for sleep bucketing, device name.
  // Validated before any write — a corrupt user.json must never persist a
  // bogus timezone onto activity rows or crash sleep bucketing midway.
  let timezone = FALLBACK_TIMEZONE;
  let deviceName: string | null = null;
  const userJsonPath = resolveCI("user/user.json");
  if (userJsonPath) {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(byPath.get(userJsonPath)!).toString("utf8"));
      const u = (Array.isArray(parsed) ? parsed[0] : parsed) as Record<string, unknown>;
      if (typeof u?.timezone === "string" && isKnownTimezone(u.timezone)) {
        timezone = u.timezone;
      }
    } catch {
      // Optional — default stands.
    }
  }
  const gearsJsonPath = resolveCI("user/gears.json");
  if (gearsJsonPath) {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(byPath.get(gearsJsonPath)!).toString("utf8"));
      const g = (Array.isArray(parsed) ? parsed[0] : parsed) as Record<string, unknown>;
      if (typeof g?.name === "string") deviceName = g.name;
    } catch {
      // Optional.
    }
  }

  // Every import source shares the Activity table with idempotent upserts on
  // (userId, source, externalId), so re-uploads only ever add new workouts.

  const decoder = new TextDecoder();

  for (const gpxPath of gpxPaths.sort()) {
    try {
      const file = basename(gpxPath);
      // Parse case-insensitively (Windows-style ".GPX"); the original stem
      // stays the stable externalId.
      const parsed = parseSuuntoFilename(file.replace(/\.([^.]+)$/, (_m, ext: string) => `.${ext.toLowerCase()}`));
      if (!parsed) {
        stats.skipped++;
        continue;
      }
      const type = suuntoSportToActivityType(parsed.sport);
      const stem = file.replace(/\.[^.]+$/, "");

      const points = parseGpxTrackPoints(decoder.decode(byPath.get(gpxPath)));
      const s = summarizeTrack(points);
      if (!s) {
        stats.skipped++;
        continue;
      }
      // GPS-dead effort keeps duration + HR with distance nulled; dead
      // recordings skip (mirrors the CLI backfiller).
      const resolved = resolveSuspiciousTrack(s);
      if (resolved.skipped) {
        stats.skipped++;
        continue;
      }
      const summary = {
        ...s,
        distance: resolved.distance,
        movingTime: resolved.movingTime,
        averageSpeed: resolved.averageSpeed,
        maxSpeed: resolved.maxSpeed,
      };
      // Authoritative start: first track-point instant (filename clock drifts).
      const startDate = points.length > 0 ? points[0].time : parsed.startDate;

      // Paired .fit mate (same dir + stem): gap-fill only. Absent or
      // unreadable is fine — GPX stands alone.
      let fit: FitSummary | null = null;
      const dir = dirOf(gpxPath);
      const fitPath = resolveCI(`${dir ? `${dir}/` : ""}${stem}.fit`);
      if (fitPath) {
        try {
          fit = decodeFit(byPath.get(fitPath)!);
        } catch {
          fit = null;
        }
      }
      const merged = mergeSummaryWithFit(summary, fit);

      const now = new Date();
      const fitDistance = fit?.series.distance ?? [];
      const distanceSeries =
        merged.distance !== null
          ? summary.series.distance
          : fitDistance.length > 0
            ? fitDistance
            : summary.series.distance;
      const payload: Record<string, { data: unknown }> = {
        time: { data: summary.series.time },
        distance: { data: distanceSeries },
        heartrate: { data: summary.series.heartrate },
        altitude: { data: summary.series.altitude },
      };
      if (fit && fit.series.cadence.length > 0) {
        payload.cadence = { data: fit.series.cadence };
        payload.fitTime = { data: fit.series.time };
      }
      if (fit && fit.series.watts.length > 0) {
        payload.watts = { data: fit.series.watts };
        payload.fitTime = { data: fit.series.time };
      }

      // Activity + laps + stream commit atomically: analysisDataFetchedAt
      // claims "streams stored", so the three must never diverge mid-row.
      await prisma.$transaction(async (tx) => {
        const existing = await tx.activity.findUnique({
          where: { userId_source_externalId: { userId: user.id, source: "SUUNTO", externalId: stem } },
          select: { id: true },
        });

        const data = {
          name: stem,
          type,
          startDate,
          distance: merged.distance,
          movingTime: summary.movingTime,
          elapsedTime: summary.elapsedTime,
          averageSpeed: merged.averageSpeed,
          maxSpeed: merged.maxSpeed,
          averageHeartrate: merged.averageHeartrate,
          maxHeartrate: merged.maxHeartrate,
          totalElevationGain: merged.totalElevationGain,
          averageCadence: merged.averageCadence,
          averageWatts: merged.averageWatts,
          maxWatts: merged.maxWatts,
          calories: merged.calories,
          timezone,
          deviceName,
          detailFetchedAt: now,
          analysisDataFetchedAt: now,
        };

        let activityId: string;
        if (!existing) {
          const created = await tx.activity.create({
            data: {
              ...data,
              userId: user.id,
              source: "SUUNTO",
              externalId: stem,
              startDateLocal: null,
            },
            select: { id: true },
          });
          activityId = created.id;
          stats.imported++;
        } else {
          activityId = existing.id;
          await tx.activity.update({ where: { id: activityId }, data });
          stats.updated++;
        }
        stats.byType[type] = (stats.byType[type] ?? 0) + 1;

        // Laps from FIT replace stored laps — but only when FIT actually
        // delivered laps, so a re-upload with a missing mate never wipes them.
        const fitLaps: FitLap[] = fit?.laps ?? [];
        if (fitLaps.length > 0) {
          await tx.activityLap.deleteMany({ where: { activityId } });
          await tx.activityLap.createMany({
            data: fitLaps.map((lap) => ({
              activityId,
              lapIndex: lap.lapIndex,
              name: null,
              startDate: lap.startDate,
              distance: lap.distance,
              movingTime: lap.movingTime,
              elapsedTime: lap.elapsedTime,
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

        if (!fit) {
          // No FIT this upload: preserve previously stored FIT keys instead
          // of dropping cadence/watts/fitTime.
          const prev = await tx.activityStream.findUnique({
            where: { activityId },
            select: { payload: true },
          });
          const prevPayload =
            prev?.payload !== null &&
            typeof prev?.payload === "object" &&
            !Array.isArray(prev?.payload)
              ? (prev.payload as Record<string, unknown>)
              : null;
          for (const key of ["cadence", "watts", "fitTime"] as const) {
            if (prevPayload && key in prevPayload) {
              payload[key] = prevPayload[key] as { data: unknown };
            }
          }
        }
        await tx.activityStream.upsert({
          where: { activityId },
          create: { activityId, payload: payload as Prisma.InputJsonObject, fetchedAt: now },
          update: { payload: payload as Prisma.InputJsonObject },
        });
      });
    } catch {
      // One bad file (DB constraint, corrupt track, oversized payload) must
      // never abort the whole batch — count it and keep going.
      stats.skipped++;
    }
  }

  // Sleep → DailyCheckin: longest non-nap sleep per athlete-local date.
  // sleepDays counts only dates where this upload actually filled a field —
  // no-op COALESCE hits are not reported as progress.
  let sleepDays = 0;
  const sleepPaths = [...byPath.keys()].filter((p) => p.toLowerCase().endsWith(".ndjson"));
  if (sleepPaths.length > 0) {
    const dayFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const byDate = new Map<string, { minutes: number; quality: string | null }>();
    for (const p of sleepPaths) {
      const text = decoder.decode(byPath.get(p));
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let entry: unknown;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        const d = (entry as { entryData?: Record<string, unknown> })?.entryData;
        if (!d || d.isNap || !d.duration) continue;
        const anchor = new Date(
          String(d.bedtimeStart ?? (entry as { timestamp: string }).timestamp),
        );
        if (isNaN(anchor.getTime())) continue;
        const key = dayFmt.format(anchor);
        const minutes = Math.round(Number(d.duration) / 60);
        const quality = qualityToSleepQuality(typeof d.quality === "number" ? d.quality : null);
        const prev = byDate.get(key);
        if (!prev || minutes > prev.minutes) byDate.set(key, { minutes, quality });
      }
    }
    for (const [date, v] of byDate) {
      try {
        const existing = await prisma.dailyCheckin.findUnique({
          where: { userId_date: { userId: user.id, date: new Date(`${date}T00:00:00Z`) } },
          select: { sleepDuration: true, sleepQuality: true },
        });
        const fillDuration = v.minutes;
        const fillQuality = v.quality as "POOR" | "OKAY" | "GOOD" | "EXCELLENT" | null;
        if (!existing) {
          await prisma.dailyCheckin.create({
            data: {
              userId: user.id,
              date: new Date(`${date}T00:00:00Z`),
              sleepDuration: fillDuration,
              sleepQuality: fillQuality,
            },
          });
          sleepDays++;
        } else if (
          (existing.sleepDuration == null && fillDuration != null) ||
          (existing.sleepQuality == null && fillQuality != null)
        ) {
          await prisma.dailyCheckin.update({
            where: { userId_date: { userId: user.id, date: new Date(`${date}T00:00:00Z`) } },
            data: {
              ...(existing.sleepDuration == null ? { sleepDuration: fillDuration } : {}),
              ...(existing.sleepQuality == null ? { sleepQuality: fillQuality } : {}),
            },
          });
          sleepDays++;
        }
      } catch {
        // One bad sleep day never aborts the batch.
      }
    }
  }

  return NextResponse.json({ ...stats, sleepDays });
}
