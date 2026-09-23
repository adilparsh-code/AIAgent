-- Phase 7: AgentTask contract + AgentArtifact persistence.
-- Non-destructive: adds enums, two tables, a nullable agentTaskId column on
-- AgentRun, and indexes. Existing Phase 1-6C rows are untouched. AgentRun's
-- legacy lifecycle and AgentRunStatus are unchanged.

-- CreateEnum
CREATE TYPE "AgentTaskStatus" AS ENUM ('QUEUED', 'READY', 'WAITING_APPROVAL', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AgentTaskType" AS ENUM ('RESEARCH', 'CONTENT_DRAFT', 'PRODUCT_OUTLINE', 'LANDING_PAGE_DRAFT', 'SEO_RESEARCH', 'AFFILIATE_RESEARCH', 'PIN_CONTENT_DRAFT', 'EXPERIMENT_ANALYSIS', 'REPORT_GENERATION');

-- CreateEnum
CREATE TYPE "AgentArtifactDataClass" AS ENUM ('REAL_DATA', 'AI_GENERATED', 'AI_ESTIMATE', 'SAMPLE_DATA');

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "contractVersion" INTEGER NOT NULL DEFAULT 1,
    "agentId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "experimentId" TEXT,
    "taskType" "AgentTaskType" NOT NULL,
    "objective" TEXT NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "inputs" JSONB,
    "expectedOutputs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "constraints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "budgetLimit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "timeLimitSeconds" INTEGER NOT NULL DEFAULT 120,
    "maxOutputChars" INTEGER NOT NULL DEFAULT 20000,
    "maxRetries" INTEGER NOT NULL DEFAULT 2,
    "maxActions" INTEGER NOT NULL DEFAULT 10,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvalState" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "status" "AgentTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "actionCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "result" JSONB,
    "errors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "blockedReason" TEXT,
    "cancellation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentArtifact" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "data" JSONB,
    "dataClass" "AgentArtifactDataClass" NOT NULL DEFAULT 'AI_GENERATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentTask_ownerId_status_idx" ON "AgentTask"("ownerId", "status");
CREATE INDEX "AgentTask_agentId_idx" ON "AgentTask"("agentId");
CREATE INDEX "AgentTask_opportunityId_idx" ON "AgentTask"("opportunityId");
CREATE INDEX "AgentTask_experimentId_idx" ON "AgentTask"("experimentId");
CREATE INDEX "AgentTask_status_idx" ON "AgentTask"("status");
CREATE INDEX "AgentTask_createdAt_idx" ON "AgentTask"("createdAt");

-- CreateIndex
CREATE INDEX "AgentArtifact_taskId_idx" ON "AgentArtifact"("taskId");
CREATE INDEX "AgentArtifact_type_idx" ON "AgentArtifact"("type");

-- AlterTable: link AgentRun executions FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentArtifact" ADD CONSTRAINT "AgentArtifact_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: link AgentRun executions to their originating task (nullable,
-- SetNull on task deletion so historical runs are preserved).
ALTER TABLE "AgentRun" ADD COLUMN "agentTaskId" TEXT;

-- CreateIndex
CREATE INDEX "AgentRun_agentTaskId_idx" ON "AgentRun"("agentTaskId");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentTaskId_fkey" FOREIGN KEY ("agentTaskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
