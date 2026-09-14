import type { RevenueEntry } from "../types";
import type { Repository } from "./base";
import { generateId, getCurrentTimestamp } from "./base";
import { SAMPLE_REVENUE } from "../data/catalog";

class InMemoryRevenueRepository implements Repository<RevenueEntry> {
  private revenue: Map<string, RevenueEntry>;
  private isSampleData: Map<string, boolean>;

  constructor() {
    this.revenue = new Map();
    this.isSampleData = new Map();
    
    // Initialize with sample data
    SAMPLE_REVENUE.forEach(rev => {
      this.revenue.set(rev.id, { ...rev });
      this.isSampleData.set(rev.id, true);
    });
  }

  async getAll(): Promise<RevenueEntry[]> {
    return Array.from(this.revenue.values()).sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }

  async getByOpportunityId(opportunityId: string): Promise<RevenueEntry[]> {
    return Array.from(this.revenue.values())
      .filter(rev => rev.opportunityId === opportunityId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  async getByProductId(productId: string): Promise<RevenueEntry[]> {
    return Array.from(this.revenue.values())
      .filter(rev => rev.productId === productId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  async getById(id: string): Promise<RevenueEntry | null> {
    const rev = this.revenue.get(id);
    return rev ? { ...rev } : null;
  }

  async isSample(id: string): Promise<boolean> {
    return this.isSampleData.get(id) || false;
  }

  async create(item: Omit<RevenueEntry, 'id'>): Promise<RevenueEntry> {
    const id = `rev-${generateId().slice(0, 8)}`;
    
    // Calculate net revenue automatically if not provided
    const netRevenue = item.netRevenue ?? (item.grossRevenue - (item.fees || 0) - (item.advertisingCost || 0) - (item.otherCosts || 0));
    
    const newRevenue: RevenueEntry = {
      ...item,
      id,
      netRevenue,
    };

    this.revenue.set(id, newRevenue);
    this.isSampleData.set(id, false);
    
    return { ...newRevenue };
  }

  async update(id: string, updates: Partial<RevenueEntry>): Promise<RevenueEntry | null> {
    const existing = this.revenue.get(id);
    if (!existing) return null;

    const updated: RevenueEntry = {
      ...existing,
      ...updates,
    };

    // Recalculate net revenue if financial fields changed
    if ('grossRevenue' in updates || 'fees' in updates || 'advertisingCost' in updates || 'otherCosts' in updates) {
      updated.netRevenue = updated.grossRevenue - (updated.fees || 0) - (updated.advertisingCost || 0) - (updated.otherCosts || 0);
    }

    this.revenue.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<boolean> {
    if (this.isSampleData.get(id)) return false;
    return this.revenue.delete(id);
  }

  async getTotalNetRevenue(): Promise<number> {
    const metrics = await this.calculateMetrics();
    return metrics.totalNet;
  }

  async getMonthlyRevenue(): Promise<number> {
    const metrics = await this.calculateMetrics();
    return metrics.monthlyNet;
  }

  // Calculate aggregated metrics
  async calculateMetrics() {
    const all = await this.getAll();
    
    const totalGross = all.reduce((sum, rev) => sum + rev.grossRevenue, 0);
    const totalNet = all.reduce((sum, rev) => sum + rev.netRevenue, 0);
    const totalFees = all.reduce((sum, rev) => sum + (rev.fees || 0), 0);

    // Calculate monthly revenue (current month)
    const now = new Date();
    const currentMonthEntries = all.filter(rev => {
      const revDate = new Date(rev.date);
      return revDate.getMonth() === now.getMonth() && revDate.getFullYear() === now.getFullYear();
    });
    const monthlyNet = currentMonthEntries.reduce((sum, rev) => sum + rev.netRevenue, 0);

    // Revenue by opportunity
    const byOpportunity: Record<string, number> = {};
    all.forEach(rev => {
      if (rev.opportunityId) {
        byOpportunity[rev.opportunityId] = (byOpportunity[rev.opportunityId] || 0) + rev.netRevenue;
      }
    });

    // Revenue by business model will need opportunity lookup, handled at higher level
    return {
      totalGross,
      totalNet,
      totalFees,
      monthlyNet,
      byOpportunity,
    };
  }
}

export const revenueRepository = new InMemoryRevenueRepository();