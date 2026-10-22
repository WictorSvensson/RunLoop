// One-off Suunto export backfill into the reused Activity table.
//
// Usage:
//   node scripts/import-suunto/import.ts \
//     --export-dir /path/to/wictorsvensson \
//     [--user-email dev@runloop.local] [--dry-run] [--limit 10] [--skip-sleep]
//
// Idempotent: Activity rows upsert on (userId, source, externalId) and
// DailyCheckin rows only fill empty sleep fields, so re-running after a new
// manual export imports just the new files.
//
// Plain Node + `pg` (already a dependency) by design — Node strips types
// natively, so no tsx/ts-node is needed. Keep this file free of non-erasable
// syntax (enums, parameter properties, namespaces) so it runs uncompiled.
// Pure GPX math lives in gpx.ts (unit-tested); this file is the thin DB rim.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import {
  parseGpxTrackPoints,
  summarizeTrack,
  parseSuuntoFilename,
  suuntoSportToActivityType,
  resolveSuspiciousTrack,
  type TrackPoint,
  type TrackSummary,
} from "./gpx.ts";
import {
  decodeFit,
  fitStreamPayload,
  mergeSummaryWithFit,
  type FitLap,
  type FitSummary,
} from "./fit.ts";
const { Client } = pg;

interface ImportOpts {
  exportDir: string | null;
  userEmail: string;
  dryRun: boolean;
  limit: number | null;
  skipSleep: boolean;
}

interface PendingRow {
  file: string;
  stem: string;
  type: string;
  startDateIso: string;
  summary: TrackSummary;
  /** FIT gap-fill result (null when no/unreadable .fit mate). */
  fit: FitSummary | null;
  distance: number | null;
  averageSpeed: number | null;
  maxSpeed: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  averageCadence: number | null;
  averageWatts: number | null;
  maxWatts: number | null;
  calories: number | null;
  totalElevationGain: number | null;
  distanceFromFit: boolean;
}

interface ImportStats {
  imported: number;
  updated: number;
  skipped: number;
  duplicates: number;
  byType: Record<string, number>;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv: string[]): ImportOpts {
  const opts: ImportOpts = {
    exportDir: null,
    userEmail: "dev@runloop.local",
    dryRun: false,
    limit: null,
    skipSleep: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--export-dir") {
      const v: string | undefined = argv[++i];
      if (v === undefined || v.startsWith("--")) fail("Missing value for --export-dir (see --help)");
      opts.exportDir = v as string;
    } else if (a === "--user-email") {
      const v: string | undefined = argv[++i];
      if (v === undefined || v.startsWith("--")) fail("Missing value for --user-email (see --help)");
      opts.userEmail = v as string;
    } else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) fail("--limit must be a positive integer.");
      opts.limit = n;
    } else if (a === "--skip-sleep") opts.skipSleep = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Suunto backfill importer (idempotent).

Options:
  --export-dir <path>   Suunto export root (contains workouts/, sleep/, user/) [required]
  --user-email <email>  Target user (default dev@runloop.local)
  --dry-run             Parse + report without writing to the DB
  --limit <n>           Only process the first n GPX files (oldest first)
  --skip-sleep          Skip the sleep -> DailyCheckin backfill
  --help                This text`);
      process.exit(0);
    } else {
      fail(`Unknown arg: ${a} (see --help)`);
    }
  }
  if (!opts.exportDir) fail("Missing required --export-dir (see --help)");
  if (!opts.userEmail.includes("@")) fail("Missing or invalid --user-email (see --help)");
  return opts;
}

// Minimal .env loader for DATABASE_URL only (no dotenv dependency).
function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) throw new Error("DATABASE_URL is not set and no .env file found.");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?\s*$/.exec(line);
    if (m) return m[1];
  }
  throw new Error("DATABASE_URL not found in environment or .env file.");
}

function qualityToSleepQuality(q: number | null | undefined): string | null {
  // Import heuristic, documented: Suunto sleep `quality` is 0..1.
  if (q == null || Number.isNaN(q)) return null;
  if (q >= 0.9) return "EXCELLENT";
  if (q >= 0.7) return "GOOD";
  if (q >= 0.5) return "OKAY";
  return "POOR";
}

function readExportMeta(exportDir: string): { timezone: string; deviceName: string | null } {
  let timezone = "Europe/Stockholm";
  let deviceName: string | null = null;
  try {
    const user: unknown = JSON.parse(readFileSync(join(exportDir, "user", "user.json"), "utf8"));
    const u = (Array.isArray(user) ? user[0] : user) as Record<string, unknown>;
    if (typeof u?.timezone === "string") timezone = u.timezone;
    if (u?.hrRest != null || u?.hrMax != null) {
      console.log(
        `Export athlete profile: hrRest=${String(u.hrRest ?? "?")} hrMax=${String(u.hrMax ?? "?")} ` +
          `weight=${String(u.weight ?? "?")}kg — seed HR zones from these (no manual entry needed).`,
      );
    }
  } catch {
    console.log("No user/user.json found; using default timezone Europe/Stockholm.");
  }
  try {
    const gears: unknown = JSON.parse(readFileSync(join(exportDir, "user", "gears.json"), "utf8"));
    const g = (Array.isArray(gears) ? gears[0] : gears) as Record<string, unknown>;
    if (typeof g?.name === "string") deviceName = g.name;
  } catch {
    /* optional */
  }
  return { timezone, deviceName };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  const exportDir = opts.exportDir as string;
  const { timezone, deviceName } = readExportMeta(exportDir);

  const workoutsDir = join(exportDir, "workouts");
  if (!existsSync(workoutsDir)) {
    fail(`No workouts/ directory in ${exportDir} — is this a Suunto export root?`);
  }
  const gpxFiles = readdirSync(workoutsDir)
    .filter((f) => f.endsWith(".gpx"))
    .sort();
  const files = opts.limit != null ? gpxFiles.slice(0, opts.limit) : gpxFiles;
  console.log(`Found ${gpxFiles.length} GPX files${opts.limit != null ? ` (processing ${files.length})` : ""}.`);

  const stats: ImportStats = { imported: 0, updated: 0, skipped: 0, duplicates: 0, byType: {} };
  const pending: PendingRow[] = []; // parsed rows (also used for --dry-run report)

  for (const file of files) {
    const stem = file.replace(/\.gpx$/, "");
    const parsed = parseSuuntoFilename(file);
    if (!parsed) {
      stats.skipped++;
      continue;
    }
    const type = suuntoSportToActivityType(parsed.sport);
    let summary: TrackSummary | null = null;
    let points: TrackPoint[] = [];
    try {
      const xml = readFileSync(join(workoutsDir, file), "utf8");
      points = parseGpxTrackPoints(xml);
      summary = summarizeTrack(points);
    } catch (err) {
      console.warn(`skip ${file}: ${err instanceof Error ? err.message : err}`);
      stats.skipped++;
      continue;
    }
    if (!summary) {
      stats.skipped++;
      continue;
    }
    // GPS-dead effort (treadmill drift: meters recorded over an hour at HR
    // 160) keeps duration + HR with distance nulled; dead recordings skip.
    const resolved = resolveSuspiciousTrack(summary);
    if (resolved.skipped) {
      console.warn(`skip ${file}: dead recording (${summary.movingTime}s moving of ${summary.elapsedTime}s elapsed)`);
      stats.skipped++;
      continue;
    }
    if (resolved.distance === null && summary.distance !== null) {
      console.log(`note ${file}: GPS-dead effort — storing duration+HR, distance unknown`);
    }
    summary = {
      ...summary,
      distance: resolved.distance,
      movingTime: resolved.movingTime,
      averageSpeed: resolved.averageSpeed,
      maxSpeed: resolved.maxSpeed,
    };
    // Authoritative start: first track-point instant (filename clock can drift).
    // Stored as an ISO UTC string: node-postgres formats Date params in local
    // time for TIMESTAMP columns, which would shift instants by the UTC offset.
    const trackStart = points.length > 0 ? points[0].time : parsed.startDate;

    // Paired .fit mate (same stem): gap-fill only — treadmill/pool distance,
    // cadence + power streams, calories, laps. Absent or unreadable is fine;
    // GPX stands alone (as it did before FIT existed).
    let fit: FitSummary | null = null;
    const fitPath = join(workoutsDir, `${stem}.fit`);
    if (existsSync(fitPath)) {
      try {
        const raw = readFileSync(fitPath);
        fit = decodeFit(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
      } catch (err) {
        console.warn(`note ${file}: ignoring unreadable .fit mate (${err instanceof Error ? err.message : err})`);
      }
    }
    const merged = mergeSummaryWithFit(summary, fit);
    if (merged.distanceFromFit) {
      console.log(`note ${file}: distance from FIT (${merged.distance} m)`);
    }
    pending.push({
      file, stem, type, startDateIso: trackStart.toISOString(), summary,
      fit,
      distance: merged.distance,
      averageSpeed: merged.averageSpeed,
      maxSpeed: merged.maxSpeed,
      averageHeartrate: merged.averageHeartrate,
      maxHeartrate: merged.maxHeartrate,
      averageCadence: merged.averageCadence,
      averageWatts: merged.averageWatts,
      maxWatts: merged.maxWatts,
      calories: merged.calories,
      totalElevationGain: merged.totalElevationGain,
      distanceFromFit: merged.distanceFromFit,
    });
  }
  // Counted from pending so dry-run and live runs report the same basis.
  const parsedByType: Record<string, number> = {};
  for (const row of pending) {
    parsedByType[row.type] = (parsedByType[row.type] ?? 0) + 1;
  }

  if (opts.dryRun) {
    console.log(`[dry-run] would upsert ${pending.length} activities, skipped ${stats.skipped}.`);
    console.log("[dry-run] by type:", JSON.stringify(parsedByType));
    const noDist = pending.filter((p) => p.distance === null).length;
    const fitDist = pending.filter((p) => p.distanceFromFit).length;
    console.log(`[dry-run] ${noDist} still without distance; ${fitDist} with distance from FIT.`);
    const withLaps = pending.filter((p) => (p.fit?.laps.length ?? 0) > 0).length;
    console.log(`[dry-run] ${withLaps} with laps from FIT.`);
    return;
  }

  const client = new Client({ connectionString: loadDatabaseUrl() });
  await client.connect();
  try {
    const userRes = await client.query(`SELECT id FROM "User" WHERE email = $1`, [opts.userEmail]);
    let userId: string;
    if (userRes.rowCount === 0) {
      const created = await client.query(
        `INSERT INTO "User" (id, email, "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, NOW(), NOW()) RETURNING id`,
        [opts.userEmail],
      );
      userId = created.rows[0].id as string;
      console.log(`Created user ${opts.userEmail}.`);
    } else {
      userId = userRes.rows[0].id as string;
    }

    const nowIso = new Date().toISOString();
    for (const row of pending) {
      const s = row.summary;
      stats.byType[row.type] = (stats.byType[row.type] ?? 0) + 1;
      // Activity + stream commit atomically: analysisDataFetchedAt claims
      // "streams stored", so the two must never diverge on a crash mid-row.
      await client.query("BEGIN");
      try {
        const existing = await client.query(
          `SELECT id FROM "Activity" WHERE "userId" = $1 AND source = 'SUUNTO' AND "externalId" = $2`,
          [userId, row.stem],
        );
        let activityId: string;
        if (existing.rowCount === 0) {
          const inserted = await client.query(
            `INSERT INTO "Activity"
               (id, "userId", source, "externalId", name, type, "startDate",
                distance, "movingTime", "elapsedTime", "averageSpeed", "maxSpeed",
                "averageHeartrate", "maxHeartrate", "totalElevationGain",
                "averageCadence", "averageWatts", "maxWatts", calories,
                "startDateLocal", timezone, "deviceName",
                "detailFetchedAt", "analysisDataFetchedAt", "createdAt", "updatedAt")
             VALUES (gen_random_uuid(), $1, 'SUUNTO', $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                NULL, $18, $19, $20, $20, $20, $20)
             RETURNING id`,
            [
              userId, row.stem, row.stem, row.type, row.startDateIso,
              row.distance, s.movingTime, s.elapsedTime, row.averageSpeed, row.maxSpeed,
              row.averageHeartrate, row.maxHeartrate, row.totalElevationGain,
              row.averageCadence, row.averageWatts, row.maxWatts, row.calories,
              timezone, deviceName, nowIso,
            ],
          );
          activityId = inserted.rows[0].id as string;
          stats.imported++;
        } else {
          activityId = existing.rows[0].id as string;
          await client.query(
            `UPDATE "Activity" SET name = $2, type = $3, "startDate" = $4,
                distance = $5, "movingTime" = $6, "elapsedTime" = $7,
                "averageSpeed" = $8, "maxSpeed" = $9,
                "averageHeartrate" = $10, "maxHeartrate" = $11,
                "totalElevationGain" = $12,
                "averageCadence" = $13, "averageWatts" = $14, "maxWatts" = $15, calories = $16,
                timezone = $17, "deviceName" = $18,
                "detailFetchedAt" = $19, "analysisDataFetchedAt" = $19, "updatedAt" = $19
             WHERE id = $1`,
            [
              activityId, row.stem, row.type, row.startDateIso,
              row.distance, s.movingTime, s.elapsedTime, row.averageSpeed, row.maxSpeed,
              row.averageHeartrate, row.maxHeartrate, row.totalElevationGain,
              row.averageCadence, row.averageWatts, row.maxWatts, row.calories,
              timezone, deviceName, nowIso,
            ],
          );
          stats.updated++;
        }

        // Laps from FIT replace stored laps — but only when FIT actually
        // delivered laps. An unconditional wipe would destroy 7000 laps on
        // any re-run where a .fit mate goes missing or fails to decode.
        const fitLaps: FitLap[] = row.fit?.laps ?? [];
        if (fitLaps.length > 0) {
          await client.query(`DELETE FROM "ActivityLap" WHERE "activityId" = $1`, [activityId]);
          for (const lap of fitLaps) {
            await client.query(
              `INSERT INTO "ActivityLap"
                 (id, "activityId", "lapIndex", "startDate", distance, "movingTime", "elapsedTime",
                  "startIndex", "endIndex",
                  "averageSpeed", "maxSpeed", "averageHeartrate", "maxHeartrate",
                  "averageCadence", "averageWatts", "totalElevationGain", "createdAt", "updatedAt")
               VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)`,
              [
                activityId, lap.lapIndex,
                lap.startDate !== null ? lap.startDate.toISOString() : null,
                lap.distance, lap.movingTime, lap.elapsedTime,
                lap.startIndex, lap.endIndex,
                lap.averageSpeed, lap.maxSpeed, lap.averageHeartrate, lap.maxHeartrate,
                lap.averageCadence, lap.averageWatts, lap.totalElevationGain, nowIso,
              ],
            );
          }
        }

        // Stream payload contract (Suunto): keys time/distance/heartrate/
        // altitude are GPX-derived (GPX stays the source of truth for track,
        // pace, HR and elevation); FIT contributes only the keys GPX lacks —
        // fitTime/cadence/watts/speed — all record-indexed on the FIT clock
        // (offset seconds from the first record, see fit.ts), so consumers
        // must join FIT series on `fitTime`, never by index against `time`.
        // FIT heartrate/altitude are intentionally NOT stored here (GPX
        // already carries them); FIT-only sync paths store them from FIT.
        // Entries may be null; empty [] means absent.
        const fitDistance = row.fit?.series.distance ?? [];
        const distanceSeries =
          row.distance !== null ? s.series.distance : (fitDistance.length > 0 ? fitDistance : s.series.distance);
        const payload: Record<string, { data: unknown }> = {
          time: { data: s.series.time },
          distance: { data: distanceSeries },
          heartrate: { data: s.series.heartrate },
          altitude: { data: s.series.altitude },
        };
        if (row.fit) {
          const fitKeys = fitStreamPayload(row.fit.series);
          // GPX-owned keys (heartrate/altitude) keep their GPX values above.
          for (const key of ["fitTime", "cadence", "watts", "speed"] as const) {
            if (fitKeys[key]) payload[key] = fitKeys[key];
          }
        }
        if (!row.fit) {
          // No FIT this run (mate missing/unreadable): preserve previously
          // stored FIT keys instead of dropping cadence/watts/speed/fitTime.
          const prev = await client.query(
            `SELECT payload FROM "ActivityStream" WHERE "activityId" = $1`,
            [activityId],
          );
          const prevPayload = prev.rowCount !== 0
            ? (prev.rows[0].payload as Record<string, { data: unknown }>)
            : null;
          for (const key of ["cadence", "watts", "speed", "fitTime"] as const) {
            if (prevPayload !== null && typeof prevPayload === "object" && key in prevPayload) {
              payload[key] = prevPayload[key];
            }
          }
        }
        await client.query(
          `INSERT INTO "ActivityStream" (id, "activityId", payload, "fetchedAt", "updatedAt")
           VALUES (gen_random_uuid(), $1, $2, $3, $3)
           ON CONFLICT ("activityId") DO UPDATE SET payload = EXCLUDED.payload, "updatedAt" = EXCLUDED."updatedAt"`,
          [activityId, JSON.stringify(payload), nowIso],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    // Sleep -> DailyCheckin: longest non-nap sleep per *athlete-local* date,
    // filling only empty check-in fields (manual entries always win).
    // Local bucketing matters: UTC dating misattributes ~19% of sessions
    // (bedtimes 00:00-02:00 local fall on the previous UTC day).
    let sleepUpserted = 0;
    if (!opts.skipSleep) {
      const sleepDir = join(exportDir, "sleep");
      if (existsSync(sleepDir)) {
        const dayFmt = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const byDate = new Map<string, { minutes: number; quality: string | null }>();
        for (const f of readdirSync(sleepDir).filter((x) => x.endsWith(".ndjson"))) {
          for (const line of readFileSync(join(sleepDir, f), "utf8").split("\n")) {
            if (!line.trim()) continue;
            let entry: unknown;
            try {
              entry = JSON.parse(line);
            } catch {
              continue;
            }
            const d = (entry as { entryData?: Record<string, unknown> })?.entryData;
            if (!d || d.isNap || !d.duration) continue;
            const anchor = new Date(String(d.bedtimeStart ?? (entry as { timestamp: string }).timestamp));
            if (isNaN(anchor.getTime())) continue;
            const key = dayFmt.format(anchor);
            const minutes = Math.round(Number(d.duration) / 60);
            const quality = qualityToSleepQuality(
              typeof d.quality === "number" ? d.quality : null,
            );
            const prev = byDate.get(key);
            if (!prev || minutes > prev.minutes) byDate.set(key, { minutes, quality });
          }
        }
        for (const [date, v] of byDate) {
          await client.query(
            `INSERT INTO "DailyCheckin"
               (id, "userId", date, "sleepDuration", "sleepQuality", "createdAt", "updatedAt")
             VALUES (gen_random_uuid(), $1, $2::date, $3, $4::"SleepQuality", NOW(), NOW())
             ON CONFLICT ("userId", date) DO UPDATE SET
               "sleepDuration" = COALESCE("DailyCheckin"."sleepDuration", EXCLUDED."sleepDuration"),
               "sleepQuality" = COALESCE("DailyCheckin"."sleepQuality", EXCLUDED."sleepQuality"),
               "updatedAt" = NOW()`,
            [userId, date, v.minutes, v.quality],
          );
          sleepUpserted++;
        }
      } else {
        console.log("No sleep/ directory; skipping sleep backfill.");
      }
    }

    console.log(
      `Done: imported=${stats.imported} updated=${stats.updated} skipped=${stats.skipped} ` +
        `duplicates=${stats.duplicates} sleepDays=${sleepUpserted} byType=${JSON.stringify(stats.byType)}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
