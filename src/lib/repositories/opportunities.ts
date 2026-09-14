import type { Opportunity } from "../types";
import type { Repository } from "./base";
import { generateId, getCurrentTimestamp } from "./base";
import { calculateOverallScore } from "../scoring";
import { SAMPLE_OPPORTUNITIES } from "../data/opportunities";

// In-memory implementation - will be replaced with database in production
class InMemoryOpportunityRepository implements Repository<Opportunity> {
  private opportunities: Map<string, Opportunity>;
  private isSampleData: Map<string, boolean>;

  constructor() {
    this.opportunities = new Map();
    this.isSampleData = new Map();
    
    // Initialize with sample data
    SAMPLE_OPPORTUNITIES.forEach(opp => {
      this.opportunities.set(opp.id, { ...opp });
      this.isSampleData.set(opp.id, true);
    });
  }

  async getAll(): Promise<Opportunity[]> {
    return Array.from(this.opportunities.values()).sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async getById(id: string): Promise<Opportunity | null> {
    const opp = this.opportunities.get(id);
    return opp ? { ...opp } : null;
  }

  async isSample(id: string): Promise<boolean> {
    return this.isSampleData.get(id) || false;
  }

  async create(item: Omit<Opportunity, 'id' | 'createdAt' | 'updatedAt'>): Promise<Opportunity> {
    const id = `opp-${generateId().slice(0, 8)}`;
    const now = getCurrentTimestamp();
    
    // Calculate score breakdown for the new opportunity
    const scoreBreakdown = {
      demand: item.demandScore,
      commercialIntent: item.commercialIntentScore,
      competitionOpportunity: 100 - item.competitionScore,
      startupCost: Math.max(0, 100 - item.estimatedStartupCost / 2),
      automationPotential: item.automationScore,
      differentiation: item.differentiationScore,
      monetizationStrength: item.monetizationStrengthScore,
      halalCompliance: item.halalScore,
    };

    const newOpportunity: Opportunity = {
      ...item,
      id,
      createdAt: now,
      updatedAt: now,
      overallScore: calculateOverallScore(scoreBreakdown),
    };

    this.opportunities.set(id, newOpportunity);
    this.isSampleData.set(id, false); // User-created, not sample data
    
    return { ...newOpportunity };
  }

  async update(id: string, updates: Partial<Opportunity>): Promise<Opportunity | null> {
    const existing = this.opportunities.get(id);
    if (!existing) return null;

    // Recalculate scores if relevant fields change
    const shouldRecalculate = [
      'demandScore', 'commercialIntentScore', 'competitionScore', 
      'estimatedStartupCost', 'automationScore', 'differentiationScore',
      'monetizationStrengthScore', 'halalScore'
    ].some(field => field in updates);

    const updated: Opportunity = {
      ...existing,
      ...updates,
      updatedAt: getCurrentTimestamp(),
    };

    if (shouldRecalculate) {
      const scoreBreakdown = {
        demand: updated.demandScore,
        commercialIntent: updated.commercialIntentScore,
        competitionOpportunity: 100 - updated.competitionScore,
        startupCost: Math.max(0, 100 - updated.estimatedStartupCost / 2),
        automationPotential: updated.automationScore,
        differentiation: updated.differentiationScore,
        monetizationStrength: updated.monetizationStrengthScore,
        halalCompliance: updated.halalScore,
      };
      updated.overallScore = calculateOverallScore(scoreBreakdown);
    }

    this.opportunities.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<boolean> {
    // Only allow deleting user-created (non-sample) opportunities
    if (this.isSampleData.get(id)) return false;
    return this.opportunities.delete(id);
  }

  async archive(id: string): Promise<Opportunity | null> {
    return this.update(id, { status: 'PAUSED' });
  }
}

// Singleton instance
export const opportunityRepository = new InMemoryOpportunityRepository();