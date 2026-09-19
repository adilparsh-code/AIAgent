import type { Opportunity } from "../types";
import type { Repository } from "./base";
import { SAMPLE_OPPORTUNITIES } from "../data/opportunities";
import { apiGet, apiSend } from "../http";

function sampleById(id: string) {
  return SAMPLE_OPPORTUNITIES.find((item) => item.id === id) ?? null;
}

class HttpOpportunityRepository implements Repository<Opportunity> {
  async getAll(): Promise<Opportunity[]> {
    let persisted: Opportunity[] = [];
    try {
      persisted = await apiGet<Opportunity[]>("/api/opportunities");
    } catch {
      persisted = [];
    }
    const persistedIds = new Set(persisted.map((item) => item.id));
    const samples = SAMPLE_OPPORTUNITIES.filter((item) => !persistedIds.has(item.id));
    return [...persisted, ...samples].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  async getById(id: string): Promise<Opportunity | null> {
    try {
      return await apiGet<Opportunity>(`/api/opportunities/${id}`);
    } catch {
      return sampleById(id);
    }
  }

  async isSample(id: string): Promise<boolean> {
    if (sampleById(id)) return true;
    try {
      const data = await apiGet<{ isSample: boolean }>(`/api/opportunities/${id}?meta=1`);
      return Boolean(data.isSample);
    } catch {
      return false;
    }
  }

  async create(item: Omit<Opportunity, "id" | "createdAt" | "updatedAt">): Promise<Opportunity> {
    return apiSend<Opportunity>("/api/opportunities", "POST", item);
  }

  async update(id: string, updates: Partial<Opportunity>): Promise<Opportunity | null> {
    if (sampleById(id)) return null;
    try {
      return await apiSend<Opportunity>(`/api/opportunities/${id}`, "PATCH", updates);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    if (sampleById(id)) return false;
    try {
      await apiSend(`/api/opportunities/${id}`, "DELETE");
      return true;
    } catch {
      return false;
    }
  }

  async archive(id: string): Promise<Opportunity | null> {
    return this.update(id, { status: "PAUSED" });
  }
}

export const opportunityRepository = new HttpOpportunityRepository();
