-- CreateTable
CREATE TABLE "CoachBrief" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "interpretation" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachBrief_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachBrief_userId_idx" ON "CoachBrief"("userId");

-- AddForeignKey
ALTER TABLE "CoachBrief" ADD CONSTRAINT "CoachBrief_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
