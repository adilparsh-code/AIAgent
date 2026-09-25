import "server-only";
import type { Experiment } from "../../types";
import type { Repository } from "../../repositories/base";
import { getPrisma } from "../../db";
import { mapExperiment } from "../../db-mappers";
import { boundedListRows, LIST_READ_LIMITS } from "./list-limits";

const SELECT = {
  id: true,
  hypothesis: true,
  opportunityId: true,
  target: true,
  budget: true,
  startDate: true,
  endDate: true,
  expectedResult: true,
  actualResult: true,
  objective: true,
  successCriteria: true,
  metrics: true,
  result: true,
  notes: true,
  feedback: true,
  visitors: true,
  leads: true,
  clicks: true,
  sales: true,
  revenue: true,
  profit: true,
  conversionRate: true,
  decision: true,
  status: true,
  handoffId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class PrismaExperimentRepository implements Repository<Experiment> {
  async getAll(ownerId?: string, limit?: number): Promise<Experiment[]> {
    const rows = await getPrisma().experiment.findMany({
      where: ownerId ? { isSample: false, opportunity: { ownerId } } : { isSample: false },
      orderBy: { updatedAt: "desc" },
      // MEDIUM-3: bounded read; a full-table read must not be reachable.
      take: boundedListRows(limit),
    });
    return rows.map(mapExperiment);
  }

  async getByOpportunityId(opportunityId: string): Promise<Experiment[]> {
    const rows = await getPrisma().experiment.findMany({
      where: { opportunityId, isSample: false },
      orderBy: { updatedAt: "desc" },
      take: LIST_READ_LIMITS.MAX_SCOPED_ROWS,
    });
    return rows.map(mapExperiment);
  }

  /** Owner-scoped through the owning Opportunity (Phase 6A ownership model). */
  async getById(id: string, ownerId?: string): Promise<Experiment | null> {
    const row = await getPrisma().experiment.findFirst({
      where: ownerId
        ? { id, isSample: false, opportunity: { ownerId } }
        : { id, isSample: false },
    });
    return row ? mapExperiment(row) : null;
  }

  async isSample(id: string): Promise<boolean> {
    const row = await getPrisma().experiment.findUnique({
      where: { id },
      select: { isSample: true },
    });
    return row?.isSample ?? false;
  }

  async create(item: Omit<Experiment, "id" | "createdAt" | "updatedAt">): Promise<Experiment> {
    const row = await getPrisma().experiment.create({
      data: {
        hypothesis: item.hypothesis,
        opportunityId: item.opportunityId,
        target: item.target,
        budget: item.budget,
        startDate: new Date(item.startDate),
        endDate: item.endDate ? new Date(item.endDate) : null,
        expectedResult: item.expectedResult,
        actualResult: item.actualResult,
        objective: item.objective ?? "",
        successCriteria: item.successCriteria ?? [],
        metrics: (item.metrics ?? undefined) as never,
        result: item.result ?? null,
        notes: item.notes ?? "",
        feedback: (item.feedback ?? undefined) as never,
        visitors: item.visitors,
        leads: item.leads,
        clicks: item.clicks,
        sales: item.sales,
        revenue: item.revenue,
        profit: item.profit,
        conversionRate: item.conversionRate,
        decision: item.decision,
        status: item.status,
        handoffId: item.handoffId ?? null,
        isSample: false,
      },
    });
    return mapExperiment(row);
  }

  /** Owner-scoped update through the owning Opportunity. */
  async updateForOwner(
    id: string,
    ownerId: string,
    updates: Partial<Experiment>,
  ): Promise<Experiment | null> {
    const existing = await getPrisma().experiment.findFirst({
      where: { id, isSample: false, opportunity: { ownerId } },
    });
    if (!existing) return null;
    return this.update(id, updates);
  }

  /** Owner-scoped delete through the owning Opportunity. */
  async deleteForOwner(id: string, ownerId: string): Promise<boolean> {
    const result = await getPrisma().experiment.deleteMany({
      where: { id, isSample: false, opportunity: { ownerId } },
    });
    return result.count > 0;
  }

  async update(id: string, updates: Partial<Experiment>): Promise<Experiment | null> {
    const existing = await getPrisma().experiment.findFirst({
      where: { id, isSample: false },
    });
    if (!existing) return null;
    const mapped = mapExperiment(existing);
    const merged = { ...mapped, ...updates };
    const row = await getPrisma().experiment.update({
      where: { id },
      data: {
        hypothesis: merged.hypothesis,
        opportunityId: merged.opportunityId,
        target: merged.target,
        budget: merged.budget,
        startDate: new Date(merged.startDate),
        endDate: merged.endDate ? new Date(merged.endDate) : null,
        expectedResult: merged.expectedResult,
        actualResult: merged.actualResult,
        objective: merged.objective ?? "",
        successCriteria: merged.successCriteria ?? [],
        metrics: (merged.metrics ?? undefined) as never,
        result: merged.result ?? null,
        notes: merged.notes ?? "",
        feedback: (merged.feedback ?? undefined) as never,
        visitors: merged.visitors,
        leads: merged.leads,
        clicks: merged.clicks,
        sales: merged.sales,
        revenue: merged.revenue,
        profit: merged.profit,
        conversionRate: merged.conversionRate,
        decision: merged.decision,
        status: merged.status,
        handoffId: merged.handoffId ?? null,
      },
    });
    return mapExperiment(row);
  }

  async delete(id: string): Promise<boolean> {
    const existing = await getPrisma().experiment.findUnique({ where: { id } });
    if (!existing || existing.isSample) return false;
    await getPrisma().experiment.delete({ where: { id } });
    return true;
  }
}

export const experimentRepository = new PrismaExperimentRepository();
