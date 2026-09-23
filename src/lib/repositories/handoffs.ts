import type { HandoffRecord } from "../types";
import { apiGet, apiSend } from "../http";

class HttpHandoffRepository {
  async getAll(): Promise<HandoffRecord[]> {
    try {
      const data = await apiGet<HandoffRecord[]>("/api/handoffs");
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async getById(id: string): Promise<HandoffRecord | null> {
    try {
      return await apiGet<HandoffRecord>(`/api/handoffs/${id}`);
    } catch {
      return null;
    }
  }

  async create(input: {
    opportunityId: string;
    recommendedExperiment?: string;
    budgetLimit?: number | null;
    timeLimitDays?: number | null;
    experimentHypothesis?: string;
  }): Promise<HandoffRecord> {
    return apiSend<HandoffRecord>("/api/handoffs", "POST", input);
  }

  async act(id: string, body: { action: "accept" | "reject" | "createExperiment"; rejectionReason?: string; budget?: number }): Promise<HandoffRecord> {
    return apiSend<HandoffRecord>(`/api/handoffs/${id}`, "POST", body);
  }
}

export const handoffRepository = new HttpHandoffRepository();
