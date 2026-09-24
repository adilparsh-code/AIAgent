-- Phase 17: persist safe health-check metadata for controlled live activation.
ALTER TABLE "IntegrationHealth" ADD COLUMN "latencyMs" INTEGER;
ALTER TABLE "IntegrationHealth" ADD COLUMN "dataClass" TEXT NOT NULL DEFAULT 'UNKNOWN';
