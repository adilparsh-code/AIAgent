-- Phase 2: first-class ResearchSource, Validation, and AgentRun models;
-- evidence -> source traceability; opportunity research metadata.

-- CreateEnum
CREATE TYPE "SignalStatus" AS ENUM ('SUPPORTED', 'MIXED', 'INSUFFICIENT');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "researchSourceId" TEXT;

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "lastResearchRunId" TEXT,
ADD COLUMN     "lastResearchAt" TIMESTAMP(3),
ADD COLUMN     "lastResearchConclusion" TEXT,
ADD COLUMN     "researchRunCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "input" JSONB,
    "output" JSONB,
    "errors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSource" (
    "id" TEXT NOT NULL,
    "researchRunId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "queries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Validation" (
    "id" TEXT NOT NULL,
    "researchRunId" TEXT NOT NULL,
    "demandStatus" "SignalStatus" NOT NULL,
    "demandEvidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "painPointStatus" "SignalStatus" NOT NULL,
    "painPointEvidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "commercialIntentStatus" "SignalStatus" NOT NULL,
    "commercialIntentEvidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trendStatus" "SignalStatus" NOT NULL,
    "trendEvidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "competitionStatus" "SignalStatus" NOT NULL,
    "competitionEvidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidenceCoverage" INTEGER NOT NULL DEFAULT 0,
    "sourceDiversity" INTEGER NOT NULL DEFAULT 0,
    "contradictionCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" DECIMAL(6,4) NOT NULL,
    "conclusion" TEXT NOT NULL,
    "conclusionBasis" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Validation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_agentId_idx" ON "AgentRun"("agentId");

-- CreateIndex
CREATE INDEX "AgentRun_status_idx" ON "AgentRun"("status");

-- CreateIndex
CREATE INDEX "AgentRun_startedAt_idx" ON "AgentRun"("startedAt");

-- CreateIndex
CREATE INDEX "ResearchSource_researchRunId_idx" ON "ResearchSource"("researchRunId");

-- CreateIndex
CREATE INDEX "ResearchSource_provider_idx" ON "ResearchSource"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSource_researchRunId_provider_key" ON "ResearchSource"("researchRunId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "Validation_researchRunId_key" ON "Validation"("researchRunId");

-- CreateIndex
CREATE INDEX "Validation_conclusion_idx" ON "Validation"("conclusion");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_name_type_key" ON "Agent"("name", "type");

-- CreateIndex
CREATE INDEX "Evidence_researchSourceId_idx" ON "Evidence"("researchSourceId");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_researchSourceId_fkey" FOREIGN KEY ("researchSourceId") REFERENCES "ResearchSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSource" ADD CONSTRAINT "ResearchSource_researchRunId_fkey" FOREIGN KEY ("researchRunId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Validation" ADD CONSTRAINT "Validation_researchRunId_fkey" FOREIGN KEY ("researchRunId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
