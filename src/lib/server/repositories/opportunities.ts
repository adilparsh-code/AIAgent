import "server-only";
import type { Opportunity } from "../../types";
import type { Repository } from "../../repositories/base";
import { calculateOverallScore } from "../../scoring";
import { getPrisma } from "../../db";
import { mapOpportunity, opportunityCreateData } from "../../db-mappers";

function scoreBreakdown(item: Pick<
  Opportunity,
  | "demandScore"
  | "commercialIntentScore"
  | "competitionScore"
  | "estimatedStartupCost"
  | "automationScore"
  | "differentiationScore"
  | "monetizationStrengthScore"
  | "halalScore"
>) {
  return {
    demand: item.demandScore,
    commercialIntent: item.commercialIntentScore,
    competitionOpportunity: 100 - item.competitionScore,
    startupCost: Math.max(0, 100 - item.estimatedStartupCost / 2),
    automationPotential: item.automationScore,
    differentiation: item.differentiationScore,
    monetizationStrength: item.monetizationStrengthScore,
    halalCompliance: item.halalScore,
  };
}

const SCORE_FIELDS = [
  "demandScore",
  "commercialIntentScore",
  "competitionScore",
  "estimatedStartupCost",
  "automationScore",
  "differentiationScore",
  "monetizationStrengthScore",
  "halalScore",
] as const;

export class PrismaOpportunityRepository implements Repository<Opportunity> {
  async getAll(): Promise<Opportunity[]> {
    const rows = await getPrisma().opportunity.findMany({
      where: { isSample: false },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(mapOpportunity);
  }

  async getById(id: string): Promise<Opportunity | null> {
    const row = await getPrisma().opportunity.findFirst({
      where: { id, isSample: false },
    });
    return row ? mapOpportunity(row) : null;
  }

  async isSample(id: string): Promise<boolean> {
    const row = await getPrisma().opportunity.findUnique({
      where: { id },
      select: { isSample: true },
    });
    return row?.isSample ?? false;
  }

  async create(item: Omit<Opportunity, "id" | "createdAt" | "updatedAt">): Promise<Opportunity> {
    const overallScore = calculateOverallScore(scoreBreakdown(item));
    const row = await getPrisma().opportunity.create({
      data: opportunityCreateData({ ...item, overallScore }),
    });
    return mapOpportunity(row);
  }

  async update(id: string, updates: Partial<Opportunity>): Promise<Opportunity | null> {
    const existing = await getPrisma().opportunity.findFirst({
      where: { id, isSample: false },
    });
    if (!existing) return null;

    const mapped = mapOpportunity(existing);
    const merged = { ...mapped, ...updates };
    const shouldRecalculate = SCORE_FIELDS.some((field) => field in updates);
    const overallScore = shouldRecalculate
      ? calculateOverallScore(scoreBreakdown(merged))
      : merged.overallScore;

    const row = await getPrisma().opportunity.update({
      where: { id },
      data: {
        title: merged.title,
        category: merged.category,
        businessModel: merged.businessModel,
        targetAudience: merged.targetAudience,
        problemSolved: merged.problemSolved,
        monetizationMethod: merged.monetizationMethod,
        estimatedStartupCost: merged.estimatedStartupCost,
        demandScore: merged.demandScore,
        competitionScore: merged.competitionScore,
        commercialIntentScore: merged.commercialIntentScore,
        automationScore: merged.automationScore,
        differentiationScore: merged.differentiationScore,
        monetizationStrengthScore: merged.monetizationStrengthScore,
        halalScore: merged.halalScore,
        halalStatus: merged.halalStatus,
        overallScore,
        confidence: merged.confidence,
        status: merged.status,
        evidence: merged.evidence,
        risks: merged.risks,
        nextAction: merged.nextAction,
      },
    });
    return mapOpportunity(row);
  }

  async delete(id: string): Promise<boolean> {
    const existing = await getPrisma().opportunity.findUnique({ where: { id } });
    if (!existing || existing.isSample) return false;
    await getPrisma().opportunity.delete({ where: { id } });
    return true;
  }

  async archive(id: string): Promise<Opportunity | null> {
    return this.update(id, { status: "PAUSED" });
  }
}

export const opportunityRepository = new PrismaOpportunityRepository();
