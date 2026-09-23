-- Phase 6B: persistent time-series experiment metrics.
-- Non-destructive: creates one enum, one table, and indexes. Existing
-- Phase 1-5 data (including Experiment.metrics JSON) is untouched.

-- CreateEnum
CREATE TYPE "MetricDataClass" AS ENUM ('REAL_DATA', 'ESTIMATED_DATA');

-- CreateTable
CREATE TABLE "ExperimentMetric" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "impressions" INTEGER,
    "clicks" INTEGER,
    "visits" INTEGER,
    "leads" INTEGER,
    "conversions" INTEGER,
    "revenue" DECIMAL(14,2),
    "cost" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "source" TEXT NOT NULL DEFAULT '',
    "dataClass" "MetricDataClass" NOT NULL DEFAULT 'REAL_DATA',
    "notes" TEXT NOT NULL DEFAULT '',
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExperimentMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentMetric_experimentId_periodStart_periodEnd_source_key" ON "ExperimentMetric"("experimentId", "periodStart", "periodEnd", "source");

-- CreateIndex
CREATE INDEX "ExperimentMetric_experimentId_idx" ON "ExperimentMetric"("experimentId");

-- CreateIndex
CREATE INDEX "ExperimentMetric_experimentId_recordedAt_idx" ON "ExperimentMetric"("experimentId", "recordedAt");

-- CreateIndex
CREATE INDEX "ExperimentMetric_periodStart_idx" ON "ExperimentMetric"("periodStart");

-- AddForeignKey
ALTER TABLE "ExperimentMetric" ADD CONSTRAINT "ExperimentMetric_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
