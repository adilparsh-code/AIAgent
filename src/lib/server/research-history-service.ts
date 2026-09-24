import "server-only";
import { getPrisma } from "@/lib/db";
import { summarizeResearchHistory } from "@/lib/research-history";

const MAX_RUNS = 30;
const MAX_EVIDENCE = 500;

export async function getResearchHistoryForOpportunity(opportunityId: string, ownerId: string) {
  const prisma = getPrisma();

  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, ownerId, isSample: false },
    select: { id: true },
  });
  if (!opportunity) return null;

  const runs = await prisma.researchRun.findMany({
    where: { opportunityId },
    orderBy: { startedAt: "desc" },
    take: MAX_RUNS,
    select: {
      id: true,
      startedAt: true,
      completedAt: true,
      status: true,
      confidence: true,
      _count: { select: { evidence: true } },
      validation: { select: { sourceDiversity: true, contradictionCount: true } },
    },
  });

  const runIds = runs.map((run) => run.id);
  if (!runIds.length) {
    return summarizeResearchHistory([], [], []);
  }

  const [sources, evidence] = await Promise.all([
    prisma.researchSource.findMany({
      where: { researchRunId: { in: runIds } },
      select: { researchRunId: true, provider: true, status: true, evidenceCount: true },
    }),
    prisma.evidence.findMany({
      where: { researchRunId: { in: runIds } },
      orderBy: { collectedAt: "desc" },
      take: MAX_EVIDENCE,
      select: { researchRunId: true, hash: true, source: true, title: true, url: true, collectedAt: true },
    }),
  ]);

  return summarizeResearchHistory(
    runs.map((run) => ({
      id: run.id,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      status: run.status,
      confidence: Number(run.confidence),
      evidenceCount: run._count.evidence,
      sourceDiversity: run.validation?.sourceDiversity ?? 0,
      contradictionCount: run.validation?.contradictionCount ?? 0,
      validationConclusion: null,
    })),
    sources,
    evidence,
  );
}
