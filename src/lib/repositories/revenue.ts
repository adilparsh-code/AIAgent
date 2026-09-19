import type { RevenueEntry } from "../types";
import type { Repository } from "./base";
import { SAMPLE_REVENUE } from "../data/catalog";
import { apiGet, apiSend } from "../http";

function sampleById(id: string) {
  return SAMPLE_REVENUE.find((item) => item.id === id) ?? null;
}

class HttpRevenueRepository implements Repository<RevenueEntry> {
  async getAll(): Promise<RevenueEntry[]> {
    let persisted: RevenueEntry[] = [];
    try {
      persisted = await apiGet<RevenueEntry[]>("/api/revenue");
    } catch {
      persisted = [];
    }
    const persistedIds = new Set(persisted.map((item) => item.id));
    const samples = SAMPLE_REVENUE.filter((item) => !persistedIds.has(item.id));
    return [...persisted, ...samples].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }

  async getByOpportunityId(opportunityId: string): Promise<RevenueEntry[]> {
    return (await this.getAll()).filter((item) => item.opportunityId === opportunityId);
  }

  async getByProductId(productId: string): Promise<RevenueEntry[]> {
    return (await this.getAll()).filter((item) => item.productId === productId);
  }

  async getById(id: string): Promise<RevenueEntry | null> {
    try {
      return await apiGet<RevenueEntry>(`/api/revenue/${id}`);
    } catch {
      return sampleById(id);
    }
  }

  async isSample(id: string): Promise<boolean> {
    return Boolean(sampleById(id));
  }

  async create(item: Omit<RevenueEntry, "id">): Promise<RevenueEntry> {
    return apiSend<RevenueEntry>("/api/revenue", "POST", item);
  }

  async update(id: string, updates: Partial<RevenueEntry>): Promise<RevenueEntry | null> {
    if (sampleById(id)) return null;
    try {
      return await apiSend<RevenueEntry>(`/api/revenue/${id}`, "PATCH", updates);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    if (sampleById(id)) return false;
    try {
      await apiSend(`/api/revenue/${id}`, "DELETE");
      return true;
    } catch {
      return false;
    }
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
    const monthlyNet = all
      .filter((rev) => {
        const revDate = new Date(rev.date);
        return revDate.getMonth() === now.getMonth() && revDate.getFullYear() === now.getFullYear();
      })
      .reduce((sum, rev) => sum + rev.netRevenue, 0);
    const byOpportunity: Record<string, number> = {};
    all.forEach((rev) => {
      if (rev.opportunityId) {
        byOpportunity[rev.opportunityId] = (byOpportunity[rev.opportunityId] || 0) + rev.netRevenue;
      }
    });
    return { totalGross, totalNet, totalFees, monthlyNet, byOpportunity };
  }
}

export const revenueRepository = new HttpRevenueRepository();
