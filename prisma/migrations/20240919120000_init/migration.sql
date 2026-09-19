-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('IDEA', 'RESEARCHING', 'VALIDATING', 'VALIDATED', 'BUILDING', 'PUBLISHED', 'EARNING', 'SCALING', 'PAUSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "HalalStatus" AS ENUM ('HALAL', 'REVIEW_REQUIRED', 'NOT_ALLOWED');

-- CreateEnum
CREATE TYPE "BusinessModel" AS ENUM ('DIGITAL_PRODUCT', 'AFFILIATE', 'SAAS', 'PRINTABLE', 'EDUCATIONAL', 'MARKETPLACE');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('CHILDRENS_BOOKS', 'EDUCATIONAL_RESOURCES', 'TEACHER_RESOURCES', 'PRINTABLES', 'AFFILIATE', 'DIGITAL_TOOLS', 'SAAS');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('COLORING_BOOK', 'DRAWING_BOOK', 'ACTIVITY_BOOK', 'WORKSHEET', 'WORKBOOK', 'PRINTABLE', 'TEACHER_RESOURCE', 'DIGITAL_TOOL', 'AFFILIATE_WEBSITE', 'SAAS');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('PLANNED', 'IN_DEVELOPMENT', 'READY', 'PUBLISHED', 'PAUSED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'FAILED', 'PAUSED');

-- CreateEnum
CREATE TYPE "ExperimentDecision" AS ENUM ('SCALE', 'ITERATE', 'PAUSE', 'KILL');

-- CreateEnum
CREATE TYPE "RevenueSource" AS ENUM ('PRODUCT_SALES', 'AFFILIATE_COMMISSION', 'SAAS_SUBSCRIPTION', 'ADS', 'OTHER');

-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('RESEARCH', 'VALIDATION', 'PRODUCT', 'AFFILIATE', 'SEO', 'QA', 'ANALYTICS', 'GROWTH', 'BUSINESS_MANAGER');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'IDLE', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "ResearchRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "businessModel" "BusinessModel" NOT NULL,
    "targetAudience" TEXT NOT NULL DEFAULT '',
    "problemSolved" TEXT NOT NULL DEFAULT '',
    "monetizationMethod" TEXT NOT NULL DEFAULT '',
    "estimatedStartupCost" DECIMAL(12,2) NOT NULL,
    "demandScore" INTEGER NOT NULL,
    "competitionScore" INTEGER NOT NULL,
    "commercialIntentScore" INTEGER NOT NULL,
    "automationScore" INTEGER NOT NULL,
    "differentiationScore" INTEGER NOT NULL,
    "monetizationStrengthScore" INTEGER NOT NULL,
    "halalScore" INTEGER NOT NULL,
    "halalStatus" "HalalStatus" NOT NULL,
    "overallScore" DECIMAL(6,1) NOT NULL,
    "confidence" INTEGER NOT NULL,
    "status" "OpportunityStatus" NOT NULL,
    "evidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "risks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nextAction" TEXT NOT NULL DEFAULT '',
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ProductType" NOT NULL,
    "targetAudience" TEXT NOT NULL DEFAULT '',
    "opportunityId" TEXT,
    "status" "ProductStatus" NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL,
    "revenue" DECIMAL(12,2) NOT NULL,
    "platform" TEXT NOT NULL DEFAULT '',
    "productUrl" TEXT,
    "affiliateUrl" TEXT,
    "metrics" JSONB,
    "notes" TEXT NOT NULL DEFAULT '',
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "budget" DECIMAL(12,2) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "expectedResult" TEXT NOT NULL DEFAULT '',
    "actualResult" TEXT,
    "visitors" INTEGER NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "sales" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(12,2) NOT NULL,
    "profit" DECIMAL(12,2) NOT NULL,
    "conversionRate" DECIMAL(8,4) NOT NULL,
    "decision" "ExperimentDecision",
    "status" "ExperimentStatus" NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueEntry" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "productId" TEXT,
    "opportunityId" TEXT,
    "revenueSource" "RevenueSource" NOT NULL,
    "grossRevenue" DECIMAL(12,2) NOT NULL,
    "fees" DECIMAL(12,2) NOT NULL,
    "advertisingCost" DECIMAL(12,2) NOT NULL,
    "otherCosts" DECIMAL(12,2) NOT NULL,
    "netRevenue" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "referenceNote" TEXT NOT NULL DEFAULT '',
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AgentType" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "AgentStatus" NOT NULL DEFAULT 'DISABLED',
    "lastRun" TIMESTAMP(3),
    "placeholder" BOOLEAN NOT NULL DEFAULT true,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "status" "ResearchRunStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "confidence" DECIMAL(6,4) NOT NULL,
    "providersAttempted" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "providersSucceeded" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "errors" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchQuery" (
    "id" TEXT NOT NULL,
    "researchRunId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "researchRunId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "snippet" TEXT NOT NULL DEFAULT '',
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "relevanceScore" DECIMAL(6,4) NOT NULL,
    "qualityScore" DECIMAL(6,4) NOT NULL,
    "hash" TEXT NOT NULL,
    "supports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contradicts" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchFinding" (
    "id" TEXT NOT NULL,
    "researchRunId" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "confidence" DECIMAL(6,4) NOT NULL,
    "evidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contradictions" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "ResearchFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_FindingEvidence" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "Opportunity_status_idx" ON "Opportunity"("status");
CREATE INDEX "Opportunity_category_idx" ON "Opportunity"("category");
CREATE INDEX "Opportunity_halalStatus_idx" ON "Opportunity"("halalStatus");
CREATE INDEX "Opportunity_overallScore_idx" ON "Opportunity"("overallScore");
CREATE INDEX "Opportunity_updatedAt_idx" ON "Opportunity"("updatedAt");
CREATE INDEX "Opportunity_isSample_idx" ON "Opportunity"("isSample");

CREATE INDEX "Product_opportunityId_idx" ON "Product"("opportunityId");
CREATE INDEX "Product_status_idx" ON "Product"("status");
CREATE INDEX "Product_isSample_idx" ON "Product"("isSample");

CREATE INDEX "Experiment_opportunityId_idx" ON "Experiment"("opportunityId");
CREATE INDEX "Experiment_status_idx" ON "Experiment"("status");
CREATE INDEX "Experiment_updatedAt_idx" ON "Experiment"("updatedAt");
CREATE INDEX "Experiment_isSample_idx" ON "Experiment"("isSample");

CREATE INDEX "RevenueEntry_date_idx" ON "RevenueEntry"("date");
CREATE INDEX "RevenueEntry_opportunityId_idx" ON "RevenueEntry"("opportunityId");
CREATE INDEX "RevenueEntry_productId_idx" ON "RevenueEntry"("productId");
CREATE INDEX "RevenueEntry_revenueSource_idx" ON "RevenueEntry"("revenueSource");
CREATE INDEX "RevenueEntry_isSample_idx" ON "RevenueEntry"("isSample");

CREATE INDEX "Agent_type_idx" ON "Agent"("type");
CREATE INDEX "Agent_status_idx" ON "Agent"("status");
CREATE INDEX "Agent_isSample_idx" ON "Agent"("isSample");

CREATE INDEX "ResearchRun_opportunityId_idx" ON "ResearchRun"("opportunityId");
CREATE INDEX "ResearchRun_startedAt_idx" ON "ResearchRun"("startedAt");
CREATE INDEX "ResearchRun_status_idx" ON "ResearchRun"("status");

CREATE INDEX "ResearchQuery_researchRunId_idx" ON "ResearchQuery"("researchRunId");
CREATE INDEX "ResearchQuery_source_idx" ON "ResearchQuery"("source");

CREATE UNIQUE INDEX "Evidence_researchRunId_hash_key" ON "Evidence"("researchRunId", "hash");
CREATE INDEX "Evidence_researchRunId_idx" ON "Evidence"("researchRunId");
CREATE INDEX "Evidence_hash_idx" ON "Evidence"("hash");
CREATE INDEX "Evidence_source_idx" ON "Evidence"("source");

CREATE INDEX "ResearchFinding_researchRunId_idx" ON "ResearchFinding"("researchRunId");

CREATE UNIQUE INDEX "_FindingEvidence_AB_unique" ON "_FindingEvidence"("A", "B");
CREATE INDEX "_FindingEvidence_B_index" ON "_FindingEvidence"("B");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RevenueEntry" ADD CONSTRAINT "RevenueEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RevenueEntry" ADD CONSTRAINT "RevenueEntry_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchQuery" ADD CONSTRAINT "ResearchQuery_researchRunId_fkey" FOREIGN KEY ("researchRunId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_researchRunId_fkey" FOREIGN KEY ("researchRunId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchFinding" ADD CONSTRAINT "ResearchFinding_researchRunId_fkey" FOREIGN KEY ("researchRunId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_FindingEvidence" ADD CONSTRAINT "_FindingEvidence_A_fkey" FOREIGN KEY ("A") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_FindingEvidence" ADD CONSTRAINT "_FindingEvidence_B_fkey" FOREIGN KEY ("B") REFERENCES "ResearchFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
