-- DropIndex
DROP INDEX "CoachBrief_userId_idx";

-- CreateIndex
CREATE INDEX "CoachBrief_userId_createdAt_idx" ON "CoachBrief"("userId", "createdAt");
