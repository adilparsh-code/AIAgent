import type { Experiment } from "../types";
import type { Repository } from "./base";
import { SAMPLE_EXPERIMENTS } from "../data/catalog";
import { apiGet, apiSend } from "../http";

function sampleById(id: string) {
  return SAMPLE_EXPERIMENTS.find((item) => item.id === id) ?? null;
}

class HttpExperimentRepository implements Repository<Experiment> {
  async getAll(): Promise<Experiment[]> {
    let persisted: Experiment[] = [];
    try {
      persisted = await apiGet<Experiment[]>("/api/experiments");
    } catch {
      persisted = [];
    }
    const persistedIds = new Set(persisted.map((item) => item.id));
    const samples = SAMPLE_EXPERIMENTS.filter((item) => !persistedIds.has(item.id));
    return [...persisted, ...samples].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  async getByOpportunityId(opportunityId: string): Promise<Experiment[]> {
    const all = await this.getAll();
    return all.filter((item) => item.opportunityId === opportunityId);
  }

  async getById(id: string): Promise<Experiment | null> {
    try {
      return await apiGet<Experiment>(`/api/experiments/${id}`);
    } catch {
      return sampleById(id);
    }
  }

  async isSample(id: string): Promise<boolean> {
    return Boolean(sampleById(id));
  }

  async create(item: Omit<Experiment, "id" | "createdAt" | "updatedAt">): Promise<Experiment> {
    return apiSend<Experiment>("/api/experiments", "POST", item);
  }

  async update(id: string, updates: Partial<Experiment>): Promise<Experiment | null> {
    if (sampleById(id)) return null;
    try {
      return await apiSend<Experiment>(`/api/experiments/${id}`, "PATCH", updates);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    if (sampleById(id)) return false;
    try {
      await apiSend(`/api/experiments/${id}`, "DELETE");
      return true;
    } catch {
      return false;
    }
  }
}

export const experimentRepository = new HttpExperimentRepository();
