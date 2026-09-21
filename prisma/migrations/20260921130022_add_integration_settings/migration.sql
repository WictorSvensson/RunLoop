-- CreateTable
CREATE TABLE "IntegrationSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationSetting_userId_idx" ON "IntegrationSetting"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationSetting_userId_source_key" ON "IntegrationSetting"("userId", "source");

-- AddForeignKey
ALTER TABLE "IntegrationSetting" ADD CONSTRAINT "IntegrationSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
