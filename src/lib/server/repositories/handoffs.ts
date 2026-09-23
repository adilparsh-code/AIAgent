import "server-only";
import { getPrisma } from "../../db";
import { mapHandoff } from "../../db-mappers";
import type { HandoffRecord } from "../../types";

/**
 * Phase 5 — persistence for the Opportunity Handoff Contract.
 * The contract JSON is stored alongside typed columns so the boundary stays
 * machine-readable while remaining queryable.
 */
export class PrismaHandoffRepository {
  async getById(id: string): Promise<HandoffRecord | null> {
    const row = await getPrisma().handoff.findUnique({ where: { id } });
    return row ? mapHandoff(row) : null;
  }

  async getByOpportunityId(opportunityId: string): Promise<HandoffRecord[]> {
    const rows = await getPrisma().handoff.findMany({
      where: { opportunityId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(mapHandoff);
  }

  async getAll(limit = 50): Promise<HandoffRecord[]> {
    const rows = await getPrisma().handoff.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(100, Math.max(1, limit)),
    });
    return rows.map(mapHandoff);
  }

  async getLatestByOpportunityId(opportunityId: string): Promise<HandoffRecord | null> {
    const row = await getPrisma().handoff.findFirst({
      where: { opportunityId },
      orderBy: { createdAt: "desc" },
    });
    return row ? mapHandoff(row) : null;
  }

  async create(data: {
    id: string;
    opportunityId: string;
    contract: unknown;
    validationConclusion: string | null;
    confidence: number | null;
    score: number | null;
    recommendedExperiment: string;
    experimentHypothesis: string;
    successCriteria: string[];
    budgetLimit: number | null;
    timeLimitDays: number | null;
    status: string;
  }): Promise<HandoffRecord> {
    const row = await getPrisma().handoff.create({
      data: {
        id: data.id,
        opportunityId: data.opportunityId,
        contractVersion: 1,
        contract: data.contract as never,
        status: data.status as never,
        validationConclusion: data.validationConclusion,
        confidence: data.confidence,
        score: data.score,
        recommendedExperiment: data.recommendedExperiment as never,
        experimentHypothesis: data.experimentHypothesis,
        successCriteria: data.successCriteria,
        budgetLimit: data.budgetLimit,
        timeLimitDays: data.timeLimitDays,
      },
    });
    return mapHandoff(row);
  }

  async updateStatus(
    id: string,
    updates: {
      status: string;
      acceptedAt?: Date | null;
      rejectedAt?: Date | null;
      rejectionReason?: string | null;
    },
  ): Promise<HandoffRecord | null> {
    const existing = await getPrisma().handoff.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await getPrisma().handoff.update({
      where: { id },
      data: {
        status: updates.status as never,
        contract: {
          ...(existing.contract as Record<string, unknown>),
          handoffStatus: updates.status,
        } as never,
        acceptedAt: updates.acceptedAt ?? existing.acceptedAt,
        rejectedAt: updates.rejectedAt ?? existing.rejectedAt,
        rejectionReason: updates.rejectionReason ?? existing.rejectionReason,
      },
    });
    return mapHandoff(row);
  }
}

export const handoffRepository = new PrismaHandoffRepository();
