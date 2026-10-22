-- Suunto Cloud API (OAuth2) auto-sync: per-user token connection mirroring
-- GarminConnection. The auth code / client secret are never stored — only
-- the exported token pair persists (see SuuntoConnection.tokenJson).
CREATE TABLE "SuuntoConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "suuntoUserId" TEXT,
    "username" TEXT,
    "tokenJson" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuuntoConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SuuntoConnection_userId_key" ON "SuuntoConnection"("userId");

ALTER TABLE "SuuntoConnection" ADD CONSTRAINT "SuuntoConnection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
