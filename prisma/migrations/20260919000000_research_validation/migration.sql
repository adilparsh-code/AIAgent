-- Add validation/conclusion/provider-status fields to ResearchRun,
-- and the evidence data-class field for honest data provenance.
ALTER TABLE "ResearchRun" ADD COLUMN "conclusion" TEXT;
ALTER TABLE "ResearchRun" ADD COLUMN "conclusionBasis" TEXT;
ALTER TABLE "ResearchRun" ADD COLUMN "providerStatuses" JSONB;
ALTER TABLE "ResearchRun" ADD COLUMN "validationSignals" JSONB;
ALTER TABLE "ResearchRun" ADD COLUMN "scoreIntegration" JSONB;
ALTER TABLE "Evidence" ADD COLUMN "dataClass" TEXT NOT NULL DEFAULT 'REAL_LIVE_DATA';
