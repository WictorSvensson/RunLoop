-- Garmin Connect support (unofficial API): per-user token connection plus
-- daily health fields on check-ins. Password is never stored — only the
-- exported token pair persists (see GarminConnection.tokenJson).
CREATE TABLE "GarminConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "garminUserId" TEXT,
    "username" TEXT,
    "tokenJson" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GarminConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GarminConnection_userId_key" ON "GarminConnection"("userId");

ALTER TABLE "GarminConnection" ADD CONSTRAINT "GarminConnection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DailyCheckin" ADD COLUMN "avgHrv" INTEGER;
ALTER TABLE "DailyCheckin" ADD COLUMN "restingHr" INTEGER;
ALTER TABLE "DailyCheckin" ADD COLUMN "bodyBattery" INTEGER;
