-- Reuse Activity for Suunto: add source + externalId dedup key, relax stravaId.
ALTER TABLE "Activity" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'STRAVA';
ALTER TABLE "Activity" ADD COLUMN "externalId" TEXT;

-- Backfill existing Strava rows so the new unique constraint holds.
UPDATE "Activity" SET "externalId" = "stravaId"::TEXT WHERE "externalId" IS NULL;

ALTER TABLE "Activity" ALTER COLUMN "stravaId" DROP NOT NULL;

DROP INDEX "Activity_userId_stravaId_key";
CREATE UNIQUE INDEX "Activity_userId_source_externalId_key" ON "Activity"("userId", "source", "externalId");
