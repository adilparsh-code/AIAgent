import "server-only";
import type { Prisma } from "@prisma/client";
import type { DiscoveryRunResult, EvaluatedCandidateView, HandoffStatus } from "../../discovery-types";
import { getPrisma } from "../../db";
import { mapDiscoveryCandidate, mapDiscoveryRun } from "../../db-mappers";
import { logger } from "../logger";

const includeCandidates = { candidates: true } as const;

export class PrismaDiscoveryRepository {
  async getById(id: string): Promise<DiscoveryRunResult | null> {
    const row = await getPrisma().discoveryRun.findUnique({
      where: { id },
      include: includeCandidates,
    });
    return row ? mapDiscoveryRun(row) : null;
  }

  async list(limit = 20): Promise<DiscoveryRunResult[]> {
    const rows = await getPrisma().discoveryRun.findMany({
      include: includeCandidates,
      orderBy: { startedAt: "desc" },
      take: Math.min(50, Math.max(1, limit)),
    });
    return rows.map(mapDiscoveryRun);
  }

  async getCandidate(candidateId: string): Promise<{ run: DiscoveryRunResult; candidate: EvaluatedCandidateView } | null> {
    const row = await getPrisma().discoveryCandidate.findUnique({
      where: { id: candidateId },
      include: { discoveryRun: { include: includeCandidates } },
    });
    if (!row) return null;
    return {
      run: mapDiscoveryRun(row.discoveryRun),
      candidate: mapDiscoveryCandidate(row),
    };
  }

  async createRunning(input: { topic: string; category: string; notes?: string }): Promise<DiscoveryRunResult> {
    const row = await getPrisma().discoveryRun.create({
      data: {
        topic: input.topic,
        category: input.category,
        status: "RUNNING",
        notes: input.notes ?? "",
      },
      include: includeCandidates,
    });
    logger.discoveryStarted(row.id, row.topic, row.category);
    return mapDiscoveryRun(row);
  }

  async addCandidate(input: {
    discoveryRunId: string;
    title: string;
    category: string;
    problemHypothesis: string;
    targetAudience: string;
    normalizedKey: string;
    status: EvaluatedCandidateView["status"];
    errors?: string[];
  }): Promise<EvaluatedCandidateView> {
    const row = await getPrisma().discoveryCandidate.create({
      data: {
        discoveryRunId: input.discoveryRunId,
        title: input.title,
        category: input.category,
        problemHypothesis: input.problemHypothesis,
        targetAudience: input.targetAudience,
        normalizedKey: input.normalizedKey,
        status: input.status,
        errors: input.errors ?? [],
      },
    });
    return mapDiscoveryCandidate(row);
  }

  async updateCandidate(
    id: string,
    data: {
      status?: EvaluatedCandidateView["status"];
      opportunityId?: string | null;
      researchRunId?: string | null;
      rank?: number | null;
      rankingScore?: number | null;
      confidence?: number | null;
      validationConclusion?: string | null;
      evidenceCount?: number;
      evidenceCoverage?: number;
      sourceDiversity?: number;
      contradictionCount?: number;
      brief?: Prisma.InputJsonValue | null;
      rankingBreakdown?: Prisma.InputJsonValue | null;
      handoffPayload?: Prisma.InputJsonValue | null;
      handoffStatus?: HandoffStatus;
      errors?: string[];
    },
  ): Promise<EvaluatedCandidateView> {
    const row = await getPrisma().discoveryCandidate.update({
      where: { id },
      data: data as Prisma.DiscoveryCandidateUpdateInput,
    });
    return mapDiscoveryCandidate(row);
  }

  async completeRun(
    id: string,
    data: {
      status: DiscoveryRunResult["status"];
      candidateCount: number;
      researchedCount: number;
      readyForHandoffCount: number;
      errors: string[];
      notes?: string;
    },
  ): Promise<DiscoveryRunResult> {
    const row = await getPrisma().discoveryRun.update({
      where: { id },
      data: {
        status: data.status,
        completedAt: new Date(),
        candidateCount: data.candidateCount,
        researchedCount: data.researchedCount,
        readyForHandoffCount: data.readyForHandoffCount,
        errors: data.errors,
        ...(data.notes ? { notes: data.notes } : {}),
      },
      include: includeCandidates,
    });
    if (data.status === "FAILED") {
      logger.discoveryFailed(id, data.errors);
    } else {
      logger.discoveryCompleted(id, data.status, data.candidateCount, data.readyForHandoffCount);
    }
    return mapDiscoveryRun(row);
  }

  async markHandoffPrepared(candidateId: string, payload: Prisma.InputJsonValue): Promise<EvaluatedCandidateView | null> {
    const existing = await getPrisma().discoveryCandidate.findUnique({ where: { id: candidateId } });
    if (!existing) return null;
    const row = await getPrisma().discoveryCandidate.update({
      where: { id: candidateId },
      data: {
        handoffStatus: "PREPARED",
        handoffPayload: payload,
      },
    });
    return mapDiscoveryCandidate(row);
  }
}

export const discoveryRepository = new PrismaDiscoveryRepository();
