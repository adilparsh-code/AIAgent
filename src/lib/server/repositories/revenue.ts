import "server-only";
import type { RevenueEntry } from "../../types";
import type { Repository } from "../../repositories/base";
import { getPrisma } from "../../db";
import { mapRevenue } from "../../db-mappers";

function netOf(item: Pick<RevenueEntry, "grossRevenue" | "fees" | "advertisingCost" | "otherCosts" | "netRevenue">) {
  if (typeof item.netRevenue === "number" && !Number.isNaN(item.netRevenue)) {
    return item.grossRevenue - (item.fees || 0) - (item.advertisingCost || 0) - (item.otherCosts || 0);
  }
  return item.grossRevenue - (item.fees || 0) - (item.advertisingCost || 0) - (item.otherCosts || 0);
}

export class PrismaRevenueRepository implements Repository<RevenueEntry> {
  async getAll(ownerId?: string): Promise<RevenueEntry[]> {
    const rows = await getPrisma().revenueEntry.findMany({
      where: ownerId ? { isSample: false, ownerId } : { isSample: false },
      orderBy: { date: "desc" },
    });
    return rows.map(mapRevenue);
  }

  async getByOpportunityId(opportunityId: string): Promise<RevenueEntry[]> {
    const rows = await getPrisma().revenueEntry.findMany({
      where: { opportunityId, isSample: false },
      orderBy: { date: "desc" },
    });
    return rows.map(mapRevenue);
  }

  async getByProductId(productId: string): Promise<RevenueEntry[]> {
    const rows = await getPrisma().revenueEntry.findMany({
      where: { productId, isSample: false },
      orderBy: { date: "desc" },
    });
    return rows.map(mapRevenue);
  }

  async getById(id: string, ownerId?: string): Promise<RevenueEntry | null> {
    const row = await getPrisma().revenueEntry.findFirst({
      where: ownerId ? { id, isSample: false, ownerId } : { id, isSample: false },
    });
    return row ? mapRevenue(row) : null;
  }

  async isSample(id: string): Promise<boolean> {
    const row = await getPrisma().revenueEntry.findUnique({
      where: { id },
      select: { isSample: true },
    });
    return row?.isSample ?? false;
  }

  async create(item: Omit<RevenueEntry, "id"> & { ownerId?: string | null }): Promise<RevenueEntry> {
    const netRevenue = netOf(item);
    const row = await getPrisma().revenueEntry.create({
      data: {
        date: new Date(item.date),
        productId: item.productId ?? null,
        opportunityId: item.opportunityId,
        revenueSource: item.revenueSource,
        grossRevenue: item.grossRevenue,
        fees: item.fees,
        advertisingCost: item.advertisingCost,
        otherCosts: item.otherCosts,
        netRevenue,
        currency: item.currency,
        referenceNote: item.referenceNote,
        isSample: false,
        ownerId: item.ownerId ?? null,
      },
    });
    return mapRevenue(row);
  }

  async update(id: string, updates: Partial<RevenueEntry>): Promise<RevenueEntry | null> {
    const existing = await getPrisma().revenueEntry.findFirst({
      where: { id, isSample: false },
    });
    if (!existing) return null;
    const mapped = mapRevenue(existing);
    const merged = { ...mapped, ...updates };
    const shouldRecalc =
      "grossRevenue" in updates || "fees" in updates || "advertisingCost" in updates || "otherCosts" in updates;
    const netRevenue = shouldRecalc ? netOf(merged) : merged.netRevenue;
    const row = await getPrisma().revenueEntry.update({
      where: { id },
      data: {
        date: new Date(merged.date),
        productId: merged.productId ?? null,
        opportunityId: merged.opportunityId,
        revenueSource: merged.revenueSource,
        grossRevenue: merged.grossRevenue,
        fees: merged.fees,
        advertisingCost: merged.advertisingCost,
        otherCosts: merged.otherCosts,
        netRevenue,
        currency: merged.currency,
        referenceNote: merged.referenceNote,
      },
    });
    return mapRevenue(row);
  }

  async delete(id: string): Promise<boolean> {
    const existing = await getPrisma().revenueEntry.findUnique({ where: { id } });
    if (!existing || existing.isSample) return false;
    await getPrisma().revenueEntry.delete({ where: { id } });
    return true;
  }

  /** Owner-scoped delete used by protected routes. */
  async deleteForOwner(id: string, ownerId: string): Promise<boolean> {
    const result = await getPrisma().revenueEntry.deleteMany({
      where: { id, ownerId, isSample: false },
    });
    return result.count > 0;
  }

  async getTotalNetRevenue(): Promise<number> {
    const metrics = await this.calculateMetrics();
    return metrics.totalNet;
  }

  async getMonthlyRevenue(): Promise<number> {
    const metrics = await this.calculateMetrics();
    return metrics.monthlyNet;
  }

  async calculateMetrics() {
    const all = await this.getAll();
    const totalGross = all.reduce((sum, rev) => sum + rev.grossRevenue, 0);
    const totalNet = all.reduce((sum, rev) => sum + rev.netRevenue, 0);
    const totalFees = all.reduce((sum, rev) => sum + (rev.fees || 0), 0);
    const now = new Date();
    const currentMonthEntries = all.filter((rev) => {
      const revDate = new Date(rev.date);
      return revDate.getMonth() === now.getMonth() && revDate.getFullYear() === now.getFullYear();
    });
    const monthlyNet = currentMonthEntries.reduce((sum, rev) => sum + rev.netRevenue, 0);
    const byOpportunity: Record<string, number> = {};
    all.forEach((rev) => {
      if (rev.opportunityId) {
        byOpportunity[rev.opportunityId] = (byOpportunity[rev.opportunityId] || 0) + rev.netRevenue;
      }
    });
    return { totalGross, totalNet, totalFees, monthlyNet, byOpportunity };
  }
}

export const revenueRepository = new PrismaRevenueRepository();
