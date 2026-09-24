-- Phase 8: integration framework persistence (health + execution audit).
-- Non-destructive: adds one enum, two tables, and indexes. No secrets are
-- ever stored in these tables — env var names and sanitized summaries only.

-- CreateEnum
CREATE TYPE "IntegrationExecutionStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'TIMEOUT', 'RATE_LIMITED', 'AUTH_FAILED', 'UNAVAILABLE', 'BLOCKED');

-- CreateTable
CREATE TABLE "IntegrationHealth" (
    "id" TEXT NOT NULL,
    "adapterName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastError" TEXT,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL,
    "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "environment" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationExecution" (
    "id" TEXT NOT NULL,
    "adapterName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "taskId" TEXT,
    "status" "IntegrationExecutionStatus" NOT NULL,
    "externalId" TEXT,
    "dataClass" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "error" TEXT,
    "outputSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationHealth_adapterName_key" ON "IntegrationHealth"("adapterName");
CREATE INDEX "IntegrationHealth_status_idx" ON "IntegrationHealth"("status");
CREATE INDEX "IntegrationExecution_adapterName_createdAt_idx" ON "IntegrationExecution"("adapterName", "createdAt");
CREATE INDEX "IntegrationExecution_ownerId_createdAt_idx" ON "IntegrationExecution"("ownerId", "createdAt");
CREATE INDEX "IntegrationExecution_taskId_idx" ON "IntegrationExecution"("taskId");
CREATE INDEX "IntegrationExecution_status_idx" ON "IntegrationExecution"("status");

-- AddForeignKey
ALTER TABLE "IntegrationExecution" ADD CONSTRAINT "IntegrationExecution_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
