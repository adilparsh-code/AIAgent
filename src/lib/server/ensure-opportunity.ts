import "server-only";
import { getPrisma } from "../db";
import { SAMPLE_OPPORTUNITIES } from "../data/opportunities";

export async function ensureOpportunityExists(opportunityId: string) {
  const prisma = getPrisma();
  const existing = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
  if (existing) return existing;

  const sample = SAMPLE_OPPORTUNITIES.find((item) => item.id === opportunityId);
  if (sample) {
    return prisma.opportunity.create({
      data: {
        id: sample.id,
        title: sample.title,
        category: sample.category,
        businessModel: sample.businessModel,
        targetAudience: sample.targetAudience,
        problemSolved: sample.problemSolved,
        monetizationMethod: sample.monetizationMethod,
        estimatedStartupCost: sample.estimatedStartupCost,
        demandScore: sample.demandScore,
        competitionScore: sample.competitionScore,
        commercialIntentScore: sample.commercialIntentScore,
        automationScore: sample.automationScore,
        differentiationScore: sample.differentiationScore,
        monetizationStrengthScore: sample.monetizationStrengthScore,
        halalScore: sample.halalScore,
        halalStatus: sample.halalStatus,
        overallScore: sample.overallScore,
        confidence: sample.confidence,
        status: sample.status,
        evidence: sample.evidence,
        risks: sample.risks,
        nextAction: sample.nextAction,
        createdAt: new Date(sample.createdAt),
        updatedAt: new Date(sample.updatedAt),
        isSample: true,
      },
    });
  }

  throw new Error(`Opportunity ${opportunityId} was not found`);
}
