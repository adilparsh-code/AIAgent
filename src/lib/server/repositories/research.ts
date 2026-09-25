import "server-only";
import type { ResearchRun } from "../../research-types";
import type { PersistedValidation } from "../../research-types";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "../../db";
import { logger } from "../logger";
import { mapResearchRun, mapValidation } from "../../db-mappers";
import { buildPersistedValidation } from "../../validation";

const includeTree = {
  queries: true,
  sources: true,
  evidence: true,
  findings: true,
} as const;

/** Postgres/Prisma unique-constraint violation (P2002). */
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Persist a complete research run atomically:
 * ResearchRun + ResearchSource(s) + Evidence + Findings + Validation,
 * plus the opportunity's research metadata — all in a single transaction so a
 * half-saved run can never appear as a success.
 */
export class PrismaResearchRepository {
  /** Owner-scoped through the owning Opportunity (Phase 6A ownership model). */
  async getById(id: string, ownerId?: string): Promise<ResearchRun | null> {
    const row = await getPrisma().researchRun.findUnique({
      where: { id },
      include: includeTree,
    });
    if (!row) return null;
    if (ownerId) {
      const owner = await getPrisma().opportunity.findUnique({
        where: { id: row.opportunityId },
        select: { ownerId: true },
      });
      if (owner?.ownerId !== ownerId) return null;
    }
    return mapResearchRun(row);
  }

  async getByOpportunityId(opportunityId: string, limit = 20): Promise<ResearchRun[]> {
    const rows = await getPrisma().researchRun.findMany({
      where: { opportunityId },
      include: includeTree,
      orderBy: { startedAt: "desc" },
      take: Math.min(50, Math.max(1, limit)),
    });
    return rows.map(mapResearchRun);
  }

  async getLatestByOpportunityId(opportunityId: string): Promise<ResearchRun | null> {
    const row = await getPrisma().researchRun.findFirst({
      where: { opportunityId },
      include: includeTree,
      orderBy: { startedAt: "desc" },
    });
    return row ? mapResearchRun(row) : null;
  }

  async getValidationByRunId(runId: string): Promise<PersistedValidation | null> {
    const row = await getPrisma().validation.findUnique({
      where: { researchRunId: runId },
    });
    return row ? mapValidation(row) : null;
  }

  /**
   * HIGH-3 — atomically reserve a deterministic run id BEFORE any external
   * provider call happens.
   *
   * The reservation is a single INSERT on the primary key, so exactly one
   * concurrent caller can win. Every other caller observes a uniqueness
   * conflict and must replay the existing run instead of starting a second
   * round of provider calls. `reserved` reports which side of that race this
   * caller is on, and only the winner may later persist the real result.
   */
  async reserveRun(input: { runId: string; opportunityId: string; startedAt?: Date }): Promise<{ reserved: boolean; existing: ResearchRun | null }> {
    const prisma = getPrisma();
    const startedAt = input.startedAt ?? new Date();
    try {
      await prisma.researchRun.create({
        data: {
          id: input.runId,
          opportunityId: input.opportunityId,
          // A reservation is always in-flight: no conclusion, no evidence and no
          // confidence are claimed until the real run is saved. It is released
          // again if the cycle fails before saving.
          status: "RUNNING",
          startedAt,
          completedAt: null,
          confidence: 0,
          conclusion: null,
          conclusionBasis: null,
          providersAttempted: [],
          providersSucceeded: [],
          providerStatuses: [],
          validationSignals: [],
          errors: [],
        },
      });
      return { reserved: true, existing: null };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { reserved: false, existing: await this.getById(input.runId) };
      }
      throw error;
    }
  }

  /**
   * HIGH-3 — drop an unused reservation so the same requestId can be retried
   * after a failure. Only ever removes a still-in-flight placeholder: a run
   * that already carries a result is never deleted.
   */
  async releaseReservation(runId: string): Promise<boolean> {
    const prisma = getPrisma();
    const result = await prisma.researchRun.deleteMany({
      where: { id: runId, status: "RUNNING", conclusion: null, completedAt: null },
    });
    return result.count > 0;
  }

  /**
   * `countNewRun` is set by the caller that won the reservation race so the
   * opportunity's researchRunCount still counts this run exactly once, even
   * though the row was pre-created by reserveRun().
   */
  async save(run: ResearchRun, options: { countNewRun?: boolean } = {}): Promise<ResearchRun> {
    const prisma = getPrisma();
    try {
      const saved = await prisma.$transaction(async (tx) => {
        // A live activation request may resolve to an existing run id. Count
        // opportunity research runs only when the row is first created; an
        // idempotent replay must not inflate lifecycle metadata.
        const existingRun = await tx.researchRun.findUnique({ where: { id: run.id }, select: { id: true } });
        await tx.researchRun.upsert({
          where: { id: run.id },
          create: {
            id: run.id,
            opportunityId: run.opportunityId,
            status: run.status,
            startedAt: new Date(run.startedAt),
            completedAt: run.completedAt ? new Date(run.completedAt) : null,
            confidence: run.confidence,
            conclusion: run.conclusion,
            conclusionBasis: run.conclusionBasis,
            providersAttempted: run.providersAttempted,
            providersSucceeded: run.providersSucceeded,
            providerStatuses: run.providerStatuses as unknown as Prisma.InputJsonValue[],
            validationSignals: run.validationSignals as unknown as Prisma.InputJsonValue[],
            scoreIntegration: run.scoreIntegration as unknown as Prisma.InputJsonValue,
            errors: run.errors,
          },
          update: {
            status: run.status,
            completedAt: run.completedAt ? new Date(run.completedAt) : null,
            confidence: run.confidence,
            conclusion: run.conclusion,
            conclusionBasis: run.conclusionBasis,
            providersAttempted: run.providersAttempted,
            providersSucceeded: run.providersSucceeded,
            providerStatuses: run.providerStatuses as unknown as Prisma.InputJsonValue[],
            validationSignals: run.validationSignals as unknown as Prisma.InputJsonValue[],
            scoreIntegration: run.scoreIntegration as unknown as Prisma.InputJsonValue,
            errors: run.errors,
          },
        });

        // Provider runs: one ResearchSource row per provider per run.
        // Evidence items link to their provider row for "which provider produced this?".
        const providerToSourceId = new Map<string, string>();
        for (const status of run.providerStatuses) {
          const queries = run.queries.filter((q) => q.source === status.name).map((q) => q.query);
          const sourceRow = await tx.researchSource.upsert({
            where: { researchRunId_provider: { researchRunId: run.id, provider: status.name } },
            create: {
              researchRunId: run.id,
              provider: status.name,
              status: status.status,
              error: status.error,
              evidenceCount: status.evidenceCount,
              queries,
            },
            update: {
              status: status.status,
              error: status.error,
              evidenceCount: status.evidenceCount,
              queries,
            },
          });
          providerToSourceId.set(status.name, sourceRow.id);
        }

        await tx.researchQuery.deleteMany({ where: { researchRunId: run.id } });
        await tx.researchFinding.deleteMany({ where: { researchRunId: run.id } });
        await tx.evidence.deleteMany({ where: { researchRunId: run.id } });
        await tx.validation.deleteMany({ where: { researchRunId: run.id } });

        if (run.queries.length) {
          await tx.researchQuery.createMany({
            data: run.queries.map((query) => ({
              researchRunId: run.id,
              query: query.query,
              source: query.source,
              purpose: query.purpose,
            })),
          });
        }

        if (run.evidence.length) {
          await tx.evidence.createMany({
            data: run.evidence.map((item) => ({
              id: item.id,
              researchRunId: run.id,
              researchSourceId: providerToSourceId.get(item.source) ?? null,
              source: item.source,
              title: item.title,
              url: item.url,
              snippet: item.snippet,
              collectedAt: new Date(item.collectedAt),
              relevanceScore: item.relevanceScore,
              qualityScore: item.qualityScore,
              hash: item.hash,
              supports: item.supports,
              contradicts: item.contradicts,
              dataClass: item.dataClass,
            })),
          });
        }

        for (const finding of run.findings) {
          await tx.researchFinding.create({
            data: {
              id: finding.id,
              researchRunId: run.id,
              claim: finding.claim,
              summary: finding.summary,
              confidence: finding.confidence,
              evidenceIds: finding.evidenceIds,
              contradictions: finding.contradictions,
              evidence: finding.evidenceIds.length
                ? { connect: finding.evidenceIds.map((id) => ({ id })) }
                : undefined,
            },
          });
        }

        // Persisted validation row — evidence-linked, one per run.
        const validation = buildPersistedValidation(run);
        await tx.validation.create({
          data: {
            researchRunId: run.id,
            demandStatus: validation.signals.find((s) => s.key === "demand")?.status ?? "INSUFFICIENT",
            demandEvidenceIds: validation.signals.find((s) => s.key === "demand")?.evidenceIds ?? [],
            painPointStatus: validation.signals.find((s) => s.key === "pain-point")?.status ?? "INSUFFICIENT",
            painPointEvidenceIds: validation.signals.find((s) => s.key === "pain-point")?.evidenceIds ?? [],
            commercialIntentStatus: validation.signals.find((s) => s.key === "commercial-intent")?.status ?? "INSUFFICIENT",
            commercialIntentEvidenceIds: validation.signals.find((s) => s.key === "commercial-intent")?.evidenceIds ?? [],
            trendStatus: validation.signals.find((s) => s.key === "trend")?.status ?? "INSUFFICIENT",
            trendEvidenceIds: validation.signals.find((s) => s.key === "trend")?.evidenceIds ?? [],
            competitionStatus: validation.signals.find((s) => s.key === "competition")?.status ?? "INSUFFICIENT",
            competitionEvidenceIds: validation.signals.find((s) => s.key === "competition")?.evidenceIds ?? [],
            evidenceCoverage: validation.evidenceCoverage,
            sourceDiversity: validation.sourceDiversity,
            contradictionCount: validation.contradictionCount,
            confidence: validation.confidence,
            conclusion: validation.conclusion,
            conclusionBasis: validation.conclusionBasis,
          },
        });

        // Opportunity research metadata stays consistent with the run.
        // `existingRun` is expected for a reserved live-research id: the caller
        // that won the reservation race passes countNewRun so the run is still
        // counted exactly once.
        const countAsNewRun = options.countNewRun === true || !existingRun;
        await tx.opportunity.update({
          where: { id: run.opportunityId },
          data: {
            lastResearchRunId: run.id,
            lastResearchAt: new Date(run.completedAt ?? run.startedAt),
            lastResearchConclusion: run.conclusion,
            researchRunCount: countAsNewRun ? { increment: 1 } : undefined,
          },
        });

        return tx.researchRun.findUniqueOrThrow({
          where: { id: run.id },
          include: includeTree,
        });
      });

      logger.researchCompleted(run.id, run.opportunityId, run.status, run.evidence.length, run.conclusion);
      return mapResearchRun(saved);
    } catch (error) {
      logger.databaseError(
        "researchRepository.save",
        error instanceof Error ? error.message : "unknown database error",
      );
      throw error;
    }
  }
}

export const researchRepository = new PrismaResearchRepository();
