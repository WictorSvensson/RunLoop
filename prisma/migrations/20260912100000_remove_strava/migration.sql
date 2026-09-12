-- Remove the Strava integration: drop the (empty) StravaConnection table and
-- the Activity.stravaId column. Garmin/Suunto rows never used stravaId.

ALTER TABLE "StravaConnection" DROP CONSTRAINT "StravaConnection_userId_fkey";
DROP TABLE "StravaConnection";

ALTER TABLE "Activity" DROP COLUMN "stravaId";
