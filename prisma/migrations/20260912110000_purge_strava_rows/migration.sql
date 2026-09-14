-- Post-Strava-removal cleanup. No producer, deleter, or UI references
-- source='STRAVA' rows anymore, so any survivors are purged (laps/streams
-- cascade via onDelete) rather than left as phantom runs in stats.
DELETE FROM "Activity" WHERE source = 'STRAVA';

-- Align the column default with the Prisma schema (@default("GARMIN")) so a
-- raw-SQL INSERT omitting source can never silently create a STRAVA row.
ALTER TABLE "Activity" ALTER COLUMN source SET DEFAULT 'GARMIN';
