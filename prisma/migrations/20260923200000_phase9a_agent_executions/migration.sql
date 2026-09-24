-- Phase 9A: provider-independent execution foundation (AgentExecution).
-- Non-destructive: adds one enum, one table, and indexes. Existing Phase 1-8
-- rows are untouched. Secrets are never stored in this table — sanitized
-- summaries only. One row per idempotency key (unique) so duplicate requests
-- resolve to the existing execution instead of creating duplicates.

-- CreateEnum
CREATE TYPE "AgentExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMEOUT', 'RATE_LIMITED', 'AUTH_FAILED', 'UNAVAILABLE', 'BLOCKED', 'CANCELLED');

-- CreateTable
CREATE TABLE "AgentExecution" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "taskId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "experimentId" TEXT,
    "integration" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "capability" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "idempotencyKey" TEXT NOT NULL,
    "status" "AgentExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "mode" TEXT NOT NULL DEFAULT 'LIVE',
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "result" JSONB,
    "error" TEXT,
    "dataClass" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentExecution_idempotencyKey_key" ON "AgentExecution"("idempotencyKey");
CREATE INDEX "AgentExecution_taskId_idx" ON "AgentExecution"("taskId");
CREATE INDEX "AgentExecution_ownerId_idx" ON "AgentExecution"("ownerId");
CREATE INDEX "AgentExecution_status_idx" ON "AgentExecution"("status");
CREATE INDEX "AgentExecution_taskId_createdAt_idx" ON "AgentExecution"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
