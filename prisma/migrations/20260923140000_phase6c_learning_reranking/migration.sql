-- Phase 6C: experiment feedback learning + auditable re-ranking.
-- Non-destructive: adds nullable columns, one table, and indexes. Existing
-- Phase 1-6B rows are untouched (new columns stay NULL until a rerank runs).

-- CreateTable
CREATE TABLE "RankingSnapshot" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "ownerId" TEXT,
    "previousScore" DECIMAL(6,1),
    "newScore" DECIMAL(6,1) NOT NULL,
    "previousRank" INTEGER,
    "newRank" INTEGER,
    "experimentDelta" DECIMAL(5,1) NOT NULL,
    "contradiction" TEXT NOT NULL DEFAULT 'NONE',
    "validationContext" TEXT NOT NULL DEFAULT 'INSUFFICIENT',
    "confidence" DECIMAL(4,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "contributingSignals" JSONB NOT NULL,
    "experimentIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RankingSnapshot_opportunityId_idx" ON "RankingSnapshot"("opportunityId");

-- CreateIndex
CREATE INDEX "RankingSnapshot_ownerId_idx" ON "RankingSnapshot"("ownerId");

-- CreateIndex
CREATE INDEX "RankingSnapshot_createdAt_idx" ON "RankingSnapshot"("createdAt");

-- AlterTable: bounded, nullable learning columns on Opportunity.
ALTER TABLE "Opportunity" ADD COLUMN "experimentScoreDelta" DECIMAL(5,1);
ALTER TABLE "Opportunity" ADD COLUMN "experimentEvidence" JSONB;
ALTER TABLE "Opportunity" ADD COLUMN "lastRankingAt" TIMESTAMP(3);
ALTER TABLE "Opportunity" ADD COLUMN "lastRankingSnapshotId" TEXT;

-- CreateIndex
CREATE INDEX "Opportunity_lastRankingAt_idx" ON "Opportunity"("lastRankingAt");

-- AddForeignKey
ALTER TABLE "RankingSnapshot" ADD CONSTRAINT "RankingSnapshot_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RankingSnapshot" ADD CONSTRAINT "RankingSnapshot_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
