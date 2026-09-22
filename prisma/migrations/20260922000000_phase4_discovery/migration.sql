-- Phase 4: autonomous opportunity discovery runs and candidates.

-- CreateEnum
CREATE TYPE "DiscoveryRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "DiscoveryCandidateStatus" AS ENUM ('GENERATED', 'RESEARCHING', 'RESEARCHED', 'SKIPPED_DUPLICATE');

-- CreateEnum
CREATE TYPE "HandoffStatus" AS ENUM ('NOT_READY', 'READY', 'PREPARED');

-- CreateTable
CREATE TABLE "DiscoveryRun" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "DiscoveryRunStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "researchedCount" INTEGER NOT NULL DEFAULT 0,
    "readyForHandoffCount" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "DiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryCandidate" (
    "id" TEXT NOT NULL,
    "discoveryRunId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "problemHypothesis" TEXT NOT NULL DEFAULT '',
    "targetAudience" TEXT NOT NULL DEFAULT '',
    "normalizedKey" TEXT NOT NULL,
    "status" "DiscoveryCandidateStatus" NOT NULL DEFAULT 'GENERATED',
    "opportunityId" TEXT,
    "researchRunId" TEXT,
    "rank" INTEGER,
    "rankingScore" DECIMAL(6,1),
    "confidence" DECIMAL(6,4),
    "validationConclusion" TEXT,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "evidenceCoverage" INTEGER NOT NULL DEFAULT 0,
    "sourceDiversity" INTEGER NOT NULL DEFAULT 0,
    "contradictionCount" INTEGER NOT NULL DEFAULT 0,
    "brief" JSONB,
    "rankingBreakdown" JSONB,
    "handoffPayload" JSONB,
    "handoffStatus" "HandoffStatus" NOT NULL DEFAULT 'NOT_READY',
    "errors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveryRun_status_idx" ON "DiscoveryRun"("status");

-- CreateIndex
CREATE INDEX "DiscoveryRun_startedAt_idx" ON "DiscoveryRun"("startedAt");

-- CreateIndex
CREATE INDEX "DiscoveryRun_category_idx" ON "DiscoveryRun"("category");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryCandidate_discoveryRunId_normalizedKey_key" ON "DiscoveryCandidate"("discoveryRunId", "normalizedKey");

-- CreateIndex
CREATE INDEX "DiscoveryCandidate_discoveryRunId_idx" ON "DiscoveryCandidate"("discoveryRunId");

-- CreateIndex
CREATE INDEX "DiscoveryCandidate_status_idx" ON "DiscoveryCandidate"("status");

-- CreateIndex
CREATE INDEX "DiscoveryCandidate_handoffStatus_idx" ON "DiscoveryCandidate"("handoffStatus");

-- CreateIndex
CREATE INDEX "DiscoveryCandidate_opportunityId_idx" ON "DiscoveryCandidate"("opportunityId");

-- CreateIndex
CREATE INDEX "DiscoveryCandidate_researchRunId_idx" ON "DiscoveryCandidate"("researchRunId");

-- AddForeignKey
ALTER TABLE "DiscoveryCandidate" ADD CONSTRAINT "DiscoveryCandidate_discoveryRunId_fkey" FOREIGN KEY ("discoveryRunId") REFERENCES "DiscoveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryCandidate" ADD CONSTRAINT "DiscoveryCandidate_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
