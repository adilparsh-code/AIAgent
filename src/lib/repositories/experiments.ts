import type { Experiment } from "../types";
import type { Repository } from "./base";
import { generateId, getCurrentTimestamp } from "./base";
import { SAMPLE_EXPERIMENTS } from "../data/catalog";

class InMemoryExperimentRepository implements Repository<Experiment> {
  private experiments: Map<string, Experiment>;
  private isSampleData: Map<string, boolean>;

  constructor() {
    this.experiments = new Map();
    this.isSampleData = new Map();
    
    // Initialize with sample data
    SAMPLE_EXPERIMENTS.forEach(exp => {
      this.experiments.set(exp.id, { ...exp });
      this.isSampleData.set(exp.id, true);
    });
  }

  async getAll(): Promise<Experiment[]> {
    return Array.from(this.experiments.values()).sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async getByOpportunityId(opportunityId: string): Promise<Experiment[]> {
    return Array.from(this.experiments.values())
      .filter(exp => exp.opportunityId === opportunityId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async getById(id: string): Promise<Experiment | null> {
    const exp = this.experiments.get(id);
    return exp ? { ...exp } : null;
  }

  async isSample(id: string): Promise<boolean> {
    return this.isSampleData.get(id) || false;
  }

  async create(item: Omit<Experiment, 'id' | 'createdAt' | 'updatedAt'>): Promise<Experiment> {
    const id = `exp-${generateId().slice(0, 8)}`;
    const now = getCurrentTimestamp();

    const newExperiment: Experiment = {
      ...item,
      id,
      createdAt: now,
      updatedAt: now,
    };

    this.experiments.set(id, newExperiment);
    this.isSampleData.set(id, false);
    
    return { ...newExperiment };
  }

  async update(id: string, updates: Partial<Experiment>): Promise<Experiment | null> {
    const existing = this.experiments.get(id);
    if (!existing) return null;

    const updated: Experiment = {
      ...existing,
      ...updates,
      updatedAt: getCurrentTimestamp(),
    };

    this.experiments.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<boolean> {
    if (this.isSampleData.get(id)) return false;
    return this.experiments.delete(id);
  }
}

export const experimentRepository = new InMemoryExperimentRepository();