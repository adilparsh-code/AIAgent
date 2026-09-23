-- Phase 5: AI Income Lab handoff contract + experiment engine.
-- Extends Experiment with objective/successCriteria/metrics/result/notes/feedback
-- and a link to its Handoff; adds the Handoff model and new enum values.

-- AlterEnum
ALTER TYPE "ExperimentStatus" ADD VALUE 'READY';
ALTER TYPE "ExperimentStatus" ADD VALUE 'RUNNING';
ALTER TYPE "ExperimentStatus" ADD VALUE 'STOPPED';
ALTER TYPE "ExperimentStatus" ADD VALUE 'ITERATING';

-- AlterEnum
ALTER TYPE "ExperimentDecision" ADD VALUE 'WIN';
ALTER TYPE "ExperimentDecision" ADD VALUE 'STOP';
ALTER TYPE "ExperimentDecision" ADD VALUE 'INSUFFICIENT_DATA';

-- CreateEnum
CREATE TYPE "HandoffStatus" AS ENUM ('DRAFT', 'HANDOFF_READY', 'ACCEPTED', 'REJECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "HandoffRecommendedExperimentType" AS ENUM ('MVP_BUILD', 'ASSET_LAUNCH');

-- AlterTable
ALTER TABLE "Experiment" ADD COLUMN     "objective" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "successCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "metrics" JSONB,
ADD COLUMN     "result" TEXT,
ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "feedback" JSONB,
ADD COLUMN     "handoffId" TEXT;

-- CreateTable
CREATE TABLE "Handoff" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "contractVersion" INTEGER NOT NULL DEFAULT 1,
    "contract" JSONB NOT NULL,
    "status" "HandoffStatus" NOT NULL DEFAULT 'DRAFT',
    "validationConclusion" TEXT,
    "confidence" DECIMAL(6,4),
    "score" DECIMAL(6,1),
    "recommendedExperiment" "HandoffRecommendedExperimentType" NOT NULL DEFAULT 'MVP_BUILD',
    "experimentHypothesis" TEXT NOT NULL,
    "successCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "budgetLimit" DECIMAL(12,2),
    "timeLimitDays" INTEGER,
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Handoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Handoff_opportunityId_idx" ON "Handoff"("opportunityId");

-- CreateIndex
CREATE INDEX "Handoff_status_idx" ON "Handoff"("status");

-- CreateIndex
CREATE INDEX "Handoff_createdAt_idx" ON "Handoff"("createdAt");

-- CreateIndex
CREATE INDEX "Experiment_handoffId_idx" ON "Experiment"("handoffId");

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_handoffId_fkey" FOREIGN KEY ("handoffId") REFERENCES "Handoff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
