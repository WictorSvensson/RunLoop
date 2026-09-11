-- Fresh-start wipe for the Suunto-native database.
--
-- Run: docker exec -i runloop-postgres psql -U runloop -d runloop < scripts/import-suunto/reset.sql
-- (same docker setup that `npm run db:up` already assumes)
--
-- What survives: the User row, and the single manually-entered DailyCheckin
-- (notes/energy/soreness/symptoms/weight all set). Everything else —
-- Strava + Suunto activities with laps/streams, auto-imported sleep
-- check-ins, stale coach briefs, the Strava connection — is deleted in one
-- transaction. Re-run `npm run import:suunto` afterwards to rebuild from the
-- Suunto export.
BEGIN;

-- Before counts (dry-run readable: replace COMMIT with ROLLBACK to rehearse)
SELECT source, COUNT(*) AS activities FROM "Activity" GROUP BY 1;
SELECT COUNT(*) AS auto_checkins FROM "DailyCheckin"
  WHERE notes IS NULL AND energy IS NULL AND soreness IS NULL AND symptoms IS NULL AND weight IS NULL;
SELECT COUNT(*) AS manual_checkins FROM "DailyCheckin"
  WHERE NOT (notes IS NULL AND energy IS NULL AND soreness IS NULL AND symptoms IS NULL AND weight IS NULL);
SELECT COUNT(*) AS briefs FROM "CoachBrief";
SELECT COUNT(*) AS strava_connections FROM "StravaConnection";

-- The wipe (FK order: children before parents)
DELETE FROM "ActivityLap" WHERE "activityId" IN (SELECT id FROM "Activity");
DELETE FROM "ActivityStream" WHERE "activityId" IN (SELECT id FROM "Activity");
DELETE FROM "Activity";
DELETE FROM "CoachBrief";
DELETE FROM "DailyCheckin"
  WHERE notes IS NULL AND energy IS NULL AND soreness IS NULL AND symptoms IS NULL AND weight IS NULL;
DELETE FROM "StravaConnection";

-- After counts (all must be 0 except users + the manual check-in)
SELECT COUNT(*) AS activities FROM "Activity";
SELECT COUNT(*) AS checkins FROM "DailyCheckin";
SELECT COUNT(*) AS briefs FROM "CoachBrief";
SELECT COUNT(*) AS strava_connections FROM "StravaConnection";
SELECT COUNT(*) AS users FROM "User";

COMMIT;
