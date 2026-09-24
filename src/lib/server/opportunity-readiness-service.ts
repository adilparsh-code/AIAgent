import "server-only";
import { getPrisma } from "@/lib/db";
import {
  calculateOpportunityReadiness,
  READINESS_POLICY,
  type OpportunityReadiness,
  type ReadinessExperimentInput,
  type ReadinessResearchRunInput,
  type ReadinessValidationInput,
} from "@/lib/opportunity-readiness";

/** Bounded loading — the readiness engine never reads unbounded rows. */
const MAX_RESEARCH_RUNS = 10;
const MAX_EXPERIMENTS = READINESS_POLICY.MAX_EXPERIMENTS;

/**
 * Load persisted data for one opportunity and compute its readiness.
 * Returns null when the opportunity does not exist for this owner or is a
 * sample row (samples never expose private readiness data).
 */
export async function getOpportunityReadiness(
  opportunityId: string,
  ownerId: string,
): Promise<OpportunityReadiness | null> {
  const prisma = getPrisma();

  // Single bounded owner-scoped fetch for the root row (incl. latest handoff
  // status). Foreign or sample opportunities are indistinguishable 404s.
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, ownerId, isSample: false },
    select: {
      id: true,
      status: true,
      halalStatus: true,
      isSample: true,
      risks: true,
      handoffs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true },
      },
    },
  });
  if (!opportunity) return null;

  const runs = await prisma.researchRun.findMany({
    where: { opportunityId },
    orderBy: { startedAt: "desc" },
    take: MAX_RESEARCH_RUNS,
    select: {
      id: true,
      status: true,
      startedAt: true,
      completedAt: true,
      confidence: true,
      _count: { select: { evidence: true } },
      validation: {
        select: {
          demandStatus: true,
          painPointStatus: true,
          commercialIntentStatus: true,
          trendStatus: true,
          competitionStatus: true,
          evidenceCoverage: true,
          sourceDiversity: true,
          contradictionCount: true,
          confidence: true,
        },
      },
    },
  });

  const experiments = await prisma.experiment.findMany({
    where: { opportunityId, isSample: false },
    orderBy: { updatedAt: "desc" },
    take: MAX_EXPERIMENTS,
    select: {
      id: true,
      status: true,
      decision: true,
      metricEvents: {
        orderBy: { periodStart: "asc" },
        take: READINESS_POLICY.MAX_METRICS_PER_EXPERIMENT,
        select: { dataClass: true, source: true, conversions: true, revenue: true, cost: true },
      },
    },
  });

  const researchRuns: ReadinessResearchRunInput[] = runs.map((run) => ({
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    evidenceCount: run._count.evidence,
    confidence: Number(run.confidence),
  }));

  // Validation of the most recent run that has one (newest first).
  const latestValidationRow = runs.find((run) => run.validation !== null)?.validation ?? null;
  const validation: ReadinessValidationInput | null = latestValidationRow
    ? {
        demandStatus: latestValidationRow.demandStatus,
        painPointStatus: latestValidationRow.painPointStatus,
        commercialIntentStatus: latestValidationRow.commercialIntentStatus,
        trendStatus: latestValidationRow.trendStatus,
        competitionStatus: latestValidationRow.competitionStatus,
        evidenceCoverage: Number(latestValidationRow.evidenceCoverage),
        sourceDiversity: latestValidationRow.sourceDiversity,
        contradictionCount: latestValidationRow.contradictionCount,
        confidence: Number(latestValidationRow.confidence),
      }
    : null;

  const experimentInputs: ReadinessExperimentInput[] = experiments.map((experiment) => ({
    id: experiment.id,
    status: experiment.status,
    decision: experiment.decision,      metrics: experiment.metricEvents.map((metric) => ({
        // Missing source provenance makes a legacy REAL_DATA row non-real.
        dataClass: metric.dataClass === "REAL_DATA" && metric.source.trim() ? "REAL_DATA" : "ESTIMATED_DATA",
      conversions: metric.conversions,
      revenue: metric.revenue === null ? null : Number(metric.revenue),
      cost: metric.cost === null ? null : Number(metric.cost),
    })),
  }));

  return calculateOpportunityReadiness({
    opportunity: {
      id: opportunity.id,
      status: opportunity.status,
      halalStatus: opportunity.halalStatus,
      isSample: opportunity.isSample,
      handoffStatus: opportunity.handoffs[0]?.status ?? null,
      risksCount: opportunity.risks.length,
    },
    researchRuns,
    validation,
    experiments: experimentInputs,
  });
}
