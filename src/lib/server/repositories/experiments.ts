import "server-only";
import type { Experiment } from "../../types";
import type { Repository } from "../../repositories/base";
import { getPrisma } from "../../db";
import { mapExperiment } from "../../db-mappers";

export class PrismaExperimentRepository implements Repository<Experiment> {
  async getAll(): Promise<Experiment[]> {
    const rows = await getPrisma().experiment.findMany({
      where: { isSample: false },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(mapExperiment);
  }

  async getByOpportunityId(opportunityId: string): Promise<Experiment[]> {
    const rows = await getPrisma().experiment.findMany({
      where: { opportunityId, isSample: false },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(mapExperiment);
  }

  async getById(id: string): Promise<Experiment | null> {
    const row = await getPrisma().experiment.findFirst({
      where: { id, isSample: false },
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
        visitors: item.visitors,
        leads: item.leads,
        clicks: item.clicks,
        sales: item.sales,
        revenue: item.revenue,
        profit: item.profit,
        conversionRate: item.conversionRate,
        decision: item.decision,
        status: item.status,
        isSample: false,
      },
    });
    return mapExperiment(row);
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
        visitors: merged.visitors,
        leads: merged.leads,
        clicks: merged.clicks,
        sales: merged.sales,
        revenue: merged.revenue,
        profit: merged.profit,
        conversionRate: merged.conversionRate,
        decision: merged.decision,
        status: merged.status,
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
