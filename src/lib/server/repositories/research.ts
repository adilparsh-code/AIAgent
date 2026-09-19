import "server-only";
import type { ResearchRun } from "../../research-types";
import { getPrisma } from "../../db";
import { mapResearchRun } from "../../db-mappers";

const includeTree = {
  queries: true,
  evidence: true,
  findings: true,
} as const;

export class PrismaResearchRepository {
  async getById(id: string): Promise<ResearchRun | null> {
    const row = await getPrisma().researchRun.findUnique({
      where: { id },
      include: includeTree,
    });
    return row ? mapResearchRun(row) : null;
  }

  async getByOpportunityId(opportunityId: string): Promise<ResearchRun[]> {
    const rows = await getPrisma().researchRun.findMany({
      where: { opportunityId },
      include: includeTree,
      orderBy: { startedAt: "desc" },
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

  async save(run: ResearchRun): Promise<ResearchRun> {
    const prisma = getPrisma();
    const saved = await prisma.$transaction(async (tx) => {
      await tx.researchRun.upsert({
        where: { id: run.id },
        create: {
          id: run.id,
          opportunityId: run.opportunityId,
          status: run.status,
          startedAt: new Date(run.startedAt),
          completedAt: run.completedAt ? new Date(run.completedAt) : null,
          confidence: run.confidence,
          providersAttempted: run.providersAttempted,
          providersSucceeded: run.providersSucceeded,
          errors: run.errors,
        },
        update: {
          status: run.status,
          completedAt: run.completedAt ? new Date(run.completedAt) : null,
          confidence: run.confidence,
          providersAttempted: run.providersAttempted,
          providersSucceeded: run.providersSucceeded,
          errors: run.errors,
        },
      });

      await tx.researchQuery.deleteMany({ where: { researchRunId: run.id } });
      await tx.researchFinding.deleteMany({ where: { researchRunId: run.id } });
      await tx.evidence.deleteMany({ where: { researchRunId: run.id } });

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

      return tx.researchRun.findUniqueOrThrow({
        where: { id: run.id },
        include: includeTree,
      });
    });

    return mapResearchRun(saved);
  }
}

export const researchRepository = new PrismaResearchRepository();
