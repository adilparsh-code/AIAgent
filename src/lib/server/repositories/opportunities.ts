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
  /** Unscoped access — API routes must apply ownership checks (Phase 6A). */
  async getAllUnscoped(): Promise<Opportunity[]> {
    const rows = await getPrisma().opportunity.findMany({
      where: { isSample: false },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(mapOpportunity);
  }

  async getAll(ownerId?: string): Promise<Opportunity[]> {
    const rows = await getPrisma().opportunity.findMany({
      where: ownerId ? { isSample: false, ownerId } : { isSample: false },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(mapOpportunity);
  }

  /** Unscoped by-id fetch — authorization is applied by the caller. */
  async getByIdUnscoped(id: string): Promise<Opportunity | null> {
    const row = await getPrisma().opportunity.findFirst({
      where: { id, isSample: false },
    });
    return row ? mapOpportunity(row) : null;
  }

  async getById(id: string, ownerId?: string): Promise<Opportunity | null> {
    const row = await getPrisma().opportunity.findFirst({
      where: ownerId ? { id, isSample: false, ownerId } : { id, isSample: false },
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

  async create(
    item: Omit<Opportunity, "id" | "createdAt" | "updatedAt"> & { ownerId?: string | null },
  ): Promise<Opportunity> {
    const overallScore = calculateOverallScore(scoreBreakdown(item));
    const { ownerId, ...rest } = item;
    const row = await getPrisma().opportunity.create({
      data: {
        ...opportunityCreateData({ ...rest, overallScore }),
        // Ownership is ALWAYS assigned server-side from the authenticated
        // session (Phase 6A); client-supplied values are ignored by routes.
        ownerId: ownerId ?? null,
      },
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

  /** Owner-scoped update used by protected routes; no-ops on another user's row. */
  async updateForOwner(
    id: string,
    ownerId: string,
    updates: Partial<Opportunity>,
  ): Promise<Opportunity | null> {
    const existing = await getPrisma().opportunity.findFirst({
      where: { id, isSample: false, ownerId },
    });
    if (!existing) return null;
    return this.update(id, updates);
  }

  async delete(id: string): Promise<boolean> {
    const existing = await getPrisma().opportunity.findUnique({ where: { id } });
    if (!existing || existing.isSample) return false;
    await getPrisma().opportunity.delete({ where: { id } });
    return true;
  }

  /** Owner-scoped delete used by protected routes; no-ops on another user's row. */
  async deleteForOwner(id: string, ownerId: string): Promise<boolean> {
    const result = await getPrisma().opportunity.deleteMany({
      where: { id, ownerId, isSample: false },
    });
    return result.count > 0;
  }

  async archive(id: string): Promise<Opportunity | null> {
    return this.update(id, { status: "PAUSED" });
  }
}

export const opportunityRepository = new PrismaOpportunityRepository();
