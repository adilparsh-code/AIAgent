import "server-only";
import type { AgentRunRecord } from "../../types";
import { getPrisma } from "../../db";
import { logger } from "../logger";
import { mapAgentRun } from "../../db-mappers";

/**
 * AgentRun persistence. Phase 2 scope: records exist and are queryable.
 * No agent executes anything yet — rows are created by explicit API calls only.
 */
export class PrismaAgentRunRepository {
  async getById(id: string): Promise<AgentRunRecord | null> {
    const row = await getPrisma().agentRun.findUnique({ where: { id } });
    return row ? mapAgentRun(row) : null;
  }

  async getByAgentId(agentId: string, limit = 20): Promise<AgentRunRecord[]> {
    const rows = await getPrisma().agentRun.findMany({
      where: { agentId },
      orderBy: { startedAt: "desc" },
      take: Math.min(100, Math.max(1, limit)),
    });
    return rows.map(mapAgentRun);
  }

  /** Owner-scoped: only runs the user created (Phase 6A). */
  async getByIdForOwner(id: string, ownerId: string): Promise<AgentRunRecord | null> {
    const row = await getPrisma().agentRun.findFirst({
      where: { id, ownerId },
    });
    return row ? mapAgentRun(row) : null;
  }

  async getByAgentIdForOwner(agentId: string, ownerId: string, limit = 20): Promise<AgentRunRecord[]> {
    const rows = await getPrisma().agentRun.findMany({
      where: { agentId, ownerId },
      orderBy: { startedAt: "desc" },
      take: Math.min(100, Math.max(1, limit)),
    });
    return rows.map(mapAgentRun);
  }

  async create(input: {
    agentId: string;
    task: string;
    status?: AgentRunRecord["status"];
    input?: unknown;
    output?: unknown;
    errors?: string[];
    metadata?: unknown;
    startedAt?: Date;
    completedAt?: Date | null;
    ownerId?: string | null;
  }): Promise<AgentRunRecord> {
    try {
      const row = await getPrisma().agentRun.create({
        data: {
          agentId: input.agentId,
          task: input.task,
          status: input.status ?? "RUNNING",
          // Assigned by the API route from the authenticated session only.
          ownerId: input.ownerId ?? null,
          startedAt: input.startedAt ?? new Date(),
          completedAt: input.completedAt ?? null,
          input: (input.input ?? undefined) as never,
          output: (input.output ?? undefined) as never,
          errors: input.errors ?? [],
          metadata: (input.metadata ?? undefined) as never,
        },
      });
      logger.agentRunStarted(row.id, input.agentId, input.task);
      return mapAgentRun(row);
    } catch (error) {
      logger.databaseError("agentRunRepository.create", error instanceof Error ? error.message : "unknown error");
      throw error;
    }
  }

  async complete(id: string, output: unknown, errors: string[] = []): Promise<AgentRunRecord | null> {
    try {
      const row = await getPrisma().agentRun.update({
        where: { id },
        data: {
          status: errors.length ? "FAILED" : "COMPLETED",
          completedAt: new Date(),
          output: (output ?? undefined) as never,
          errors,
        },
      });
      if (errors.length) logger.agentRunFailed(row.id, row.agentId, errors);
      else logger.agentRunCompleted(row.id, row.agentId, row.status);
      await getPrisma().agent
        .update({ where: { id: row.agentId }, data: { lastRun: new Date() } })
        .catch(() => undefined);
      return mapAgentRun(row);
    } catch (error) {
      logger.databaseError("agentRunRepository.complete", error instanceof Error ? error.message : "unknown error");
      throw error;
    }
  }
}

export const agentRunRepository = new PrismaAgentRunRepository();
