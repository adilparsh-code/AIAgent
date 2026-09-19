import "server-only";
import type { Agent } from "../../types";
import type { Repository } from "../../repositories/base";
import { getPrisma } from "../../db";
import { mapAgent } from "../../db-mappers";

export class PrismaAgentRepository implements Repository<Agent> {
  async getAll(): Promise<Agent[]> {
    const rows = await getPrisma().agent.findMany({
      where: { isSample: false },
      orderBy: { name: "asc" },
    });
    return rows.map(mapAgent);
  }

  async getById(id: string): Promise<Agent | null> {
    const row = await getPrisma().agent.findFirst({
      where: { id, isSample: false },
    });
    return row ? mapAgent(row) : null;
  }

  async isSample(id: string): Promise<boolean> {
    const row = await getPrisma().agent.findUnique({
      where: { id },
      select: { isSample: true },
    });
    return row?.isSample ?? false;
  }

  async create(item: Omit<Agent, "id">): Promise<Agent> {
    const row = await getPrisma().agent.create({
      data: {
        name: item.name,
        type: item.type,
        description: item.description,
        status: item.status,
        lastRun: item.lastRun ? new Date(item.lastRun) : null,
        placeholder: item.placeholder,
        isSample: false,
      },
    });
    return mapAgent(row);
  }

  async update(id: string, updates: Partial<Agent>): Promise<Agent | null> {
    const existing = await getPrisma().agent.findFirst({
      where: { id, isSample: false },
    });
    if (!existing) return null;
    const mapped = mapAgent(existing);
    const merged = { ...mapped, ...updates };
    const row = await getPrisma().agent.update({
      where: { id },
      data: {
        name: merged.name,
        type: merged.type,
        description: merged.description,
        status: merged.status,
        lastRun: merged.lastRun ? new Date(merged.lastRun) : null,
        placeholder: merged.placeholder,
      },
    });
    return mapAgent(row);
  }

  async delete(id: string): Promise<boolean> {
    const existing = await getPrisma().agent.findUnique({ where: { id } });
    if (!existing || existing.isSample) return false;
    await getPrisma().agent.delete({ where: { id } });
    return true;
  }
}

export const agentRepository = new PrismaAgentRepository();
