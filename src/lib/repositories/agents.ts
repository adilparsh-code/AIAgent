import type { Agent } from "../types";
import type { Repository } from "./base";
import { SAMPLE_AGENTS } from "../data/catalog";
import { apiGet, apiSend } from "../http";

function sampleById(id: string) {
  return SAMPLE_AGENTS.find((item) => item.id === id) ?? null;
}

class HttpAgentRepository implements Repository<Agent> {
  async getAll(): Promise<Agent[]> {
    let persisted: Agent[] = [];
    try {
      persisted = await apiGet<Agent[]>("/api/agents");
    } catch {
      persisted = [];
    }
    const persistedIds = new Set(persisted.map((item) => item.id));
    const samples = SAMPLE_AGENTS.filter((item) => !persistedIds.has(item.id));
    return [...samples, ...persisted];
  }

  async getById(id: string): Promise<Agent | null> {
    try {
      return await apiGet<Agent>(`/api/agents/${id}`);
    } catch {
      return sampleById(id);
    }
  }

  async isSample(id: string): Promise<boolean> {
    return Boolean(sampleById(id));
  }

  async create(item: Omit<Agent, "id" | "createdAt" | "updatedAt">): Promise<Agent> {
    return apiSend<Agent>("/api/agents", "POST", item);
  }

  async update(id: string, updates: Partial<Agent>): Promise<Agent | null> {
    if (sampleById(id)) return null;
    try {
      return await apiSend<Agent>(`/api/agents/${id}`, "PATCH", updates);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    if (sampleById(id)) return false;
    try {
      await apiSend(`/api/agents/${id}`, "DELETE");
      return true;
    } catch {
      return false;
    }
  }
}

export const agentRepository = new HttpAgentRepository();
