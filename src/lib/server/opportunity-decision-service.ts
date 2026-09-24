import "server-only";
import { getPrisma } from "@/lib/db";
import {
  calculateOpportunityDecision,
  type OpportunityDecision,
} from "@/lib/opportunity-decision";
import type {
  ReadinessExperimentInput,
  ReadinessResearchRunInput,
  ReadinessValidationInput,
} from "@/lib/opportunity-readiness";

/** Bounded loading — the decision engine never reads unbounded rows. */
const MAX_RESEARCH_RUNS = 10;
const MAX_EXPERIMENTS = 20;
const MAX_METRICS_PER_EXPERIMENT = 60;
const MAX_TASKS = 20;

/**
 * Load persisted data for one opportunity and compute its decision.
 * Returns null when the opportunity does not exist for this owner or is a
 * sample row (samples never expose private decision data). Owner-scoped:
 * foreign opportunities are indistinguishable 404s.
 */
export async function getOpportunityDecision(
  opportunityId: string,
  ownerId: string,
): Promise<OpportunityDecision | null> {
  const prisma = getPrisma();

  // Single bounded owner-scoped fetch for the root row. Includes the latest
  // handoff status (the readiness service pattern) and research metadata.
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, ownerId, isSample: false },
    select: {
      id: true,
      status: true,
      halalStatus: true,
      isSample: true,
      risks: true,
      handoffs: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
    },
  });
  if (!opportunity) return null;

  const [runs, experiments, tasks] = await Promise.all([
    prisma.researchRun.findMany({
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
    }),
    prisma.experiment.findMany({
      where: { opportunityId, isSample: false },
      orderBy: { updatedAt: "desc" },
      take: MAX_EXPERIMENTS,
      select: {
        id: true,
        status: true,
        decision: true,
        metricEvents: {
          orderBy: { periodStart: "asc" },
          take: MAX_METRICS_PER_EXPERIMENT,
          select: { dataClass: true, conversions: true, revenue: true, cost: true },
        },
      },
    }),
    prisma.agentTask.findMany({
      // Persisted execution state for this opportunity. Owner re-checked
      // here because AgentTask.ownerId is authoritative per-row.
      where: { opportunityId, ownerId },
      orderBy: { createdAt: "desc" },
      take: MAX_TASKS,
      select: { status: true },
      // Only the status column is needed; a lean bounded read.
    }),
  ]);

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
    decision: experiment.decision,
    metrics: experiment.metricEvents.map((metric) => ({
      dataClass: metric.dataClass,
      conversions: metric.conversions,
      revenue: metric.revenue === null ? null : Number(metric.revenue),
      cost: metric.cost === null ? null : Number(metric.cost),
    })),
  }));

  const hasRunningAgentTask = tasks.some((task) => task.status === "RUNNING");
  const hasAwaitingApprovalTask = tasks.some((task) => task.status === "WAITING_APPROVAL");
  const hasBlockedTask = tasks.some((task) => task.status === "BLOCKED");
  const hasCompletedExecution = tasks.some((task) => task.status === "COMPLETED");

  return calculateOpportunityDecision({
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
    execution: {
      handoffStatus: opportunity.handoffs[0]?.status ?? null,
      hasRunningAgentTask,
      hasAwaitingApprovalTask,
      hasBlockedTask,
      hasCompletedExecution,
    },
  });
}
