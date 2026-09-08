-- AddAnalysisIngestion
ALTER TABLE "Activity" ADD COLUMN "analysisDataFetchedAt" TIMESTAMP(3);

CREATE TABLE "ActivityLap" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "lapIndex" INTEGER NOT NULL,
    "name" TEXT,
    "startDate" TIMESTAMP(3),
    "distance" DOUBLE PRECISION,
    "movingTime" INTEGER,
    "elapsedTime" INTEGER,
    "startIndex" INTEGER,
    "endIndex" INTEGER,
    "averageSpeed" DOUBLE PRECISION,
    "maxSpeed" DOUBLE PRECISION,
    "averageHeartrate" DOUBLE PRECISION,
    "maxHeartrate" DOUBLE PRECISION,
    "averageCadence" DOUBLE PRECISION,
    "averageWatts" DOUBLE PRECISION,
    "totalElevationGain" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityLap_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActivityStream" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityStream_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActivityLap_activityId_lapIndex_key" ON "ActivityLap"("activityId", "lapIndex");
CREATE INDEX "ActivityLap_activityId_idx" ON "ActivityLap"("activityId");
CREATE UNIQUE INDEX "ActivityStream_activityId_key" ON "ActivityStream"("activityId");

ALTER TABLE "ActivityLap" ADD CONSTRAINT "ActivityLap_activityId_fkey"
FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivityStream" ADD CONSTRAINT "ActivityStream_activityId_fkey"
FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
