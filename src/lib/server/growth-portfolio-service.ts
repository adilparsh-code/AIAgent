import "server-only";

import { getPrisma } from "@/lib/db";
import { getPortfolioOperatingCycle } from "@/lib/server/autonomous-operating-loop-service";
import { getSystemHealth } from "@/lib/server/system-health-service";
import {
  calculateGrowthPortfolioState,
  type GrowthExperimentRow,
  type GrowthPortfolioState,
} from "@/lib/growth-portfolio";

/** Bounded reads: the growth view never loads an unbounded table. */
export const GROWTH_PORTFOLIO_BOUNDS = {
  MAX_OPPORTUNITIES: 50,
  MAX_EXPERIMENTS: 100,
  MAX_METRIC_ROWS: 200,
  MAX_TASKS: 100,
} as const;

function toRow(raw: {
  id: string;
  opportunityId: string;
  status: string;
  decision: string | null;
  realMetricPeriods: number;
  estimatedMetricPeriods: number;
  hasLearningSignal: boolean;
  handoffStatus: string | null;
  requiresHumanApproval: boolean;
  hasExecutionBlocker: boolean;
  isBlocked: boolean;
}): GrowthExperimentRow {
  return {
    experimentId: raw.id,
    opportunityId: raw.opportunityId,
    status: raw.status,
    decision: raw.decision,
    realMetricPeriods: raw.realMetricPeriods,
    estimatedMetricPeriods: raw.estimatedMetricPeriods,
    unmeasured: raw.realMetricPeriods === 0 && raw.estimatedMetricPeriods === 0,
    dataClass:
      raw.realMetricPeriods > 0 ? "REAL_DATA" : raw.estimatedMetricPeriods > 0 ? "ESTIMATED_DATA" : "NONE",
    experimentSufficient: raw.realMetricPeriods >= 2,
    hasLearningSignal: raw.hasLearningSignal,
    handoffStatus: raw.handoffStatus,
    requiresHumanApproval: raw.requiresHumanApproval,
    hasExecutionBlocker: raw.hasExecutionBlocker,
    isBlocked: raw.isBlocked,
  };
}

/**
 * Owner-scoped Phase 23 growth state. Reads only the session owner's
 * non-sample rows, reuses the existing portfolio/operating/health services,
 * and performs no external call, provider activation, or execution.
 */
export async function getGrowthPortfolioState(
  ownerId: string,
  now = new Date(),
): Promise<GrowthPortfolioState> {
  const prisma = getPrisma();
  const [base, systemHealth] = await Promise.all([
    getPortfolioOperatingCycle(ownerId, now),
    getSystemHealth(ownerId, now),
  ]);

  const [experiments, pendingTasks] = await Promise.all([
    prisma.experiment.findMany({
      where: { opportunity: { ownerId, isSample: false }, isSample: false },
      select: {
        id: true,
        opportunityId: true,
        status: true,
        decision: true,
        feedback: true,
        handoff: { select: { status: true } },
        metricEvents: {
          select: { dataClass: true },
          take: GROWTH_PORTFOLIO_BOUNDS.MAX_METRIC_ROWS,
          orderBy: { recordedAt: "desc" },
        },
      },
      take: GROWTH_PORTFOLIO_BOUNDS.MAX_EXPERIMENTS,
      orderBy: { createdAt: "desc" },
    }),
    // Persisted approval/blocker facts per opportunity (Phase 6A/9 task model).
    prisma.agentTask.findMany({
      where: { ownerId, opportunityId: { not: null }, status: { in: ["WAITING_APPROVAL", "BLOCKED"] } },
      select: { opportunityId: true, status: true },
      take: GROWTH_PORTFOLIO_BOUNDS.MAX_TASKS,
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const approvalByOpportunity = new Map<string, boolean>();
  const blockerByOpportunity = new Map<string, boolean>();
  for (const task of pendingTasks) {
    if (!task.opportunityId) continue;
    if (task.status === "WAITING_APPROVAL") approvalByOpportunity.set(task.opportunityId, true);
    if (task.status === "BLOCKED") blockerByOpportunity.set(task.opportunityId, true);
  }

  const rows = experiments.map((experiment) => {
    const realMetricPeriods = experiment.metricEvents.filter((event) => event.dataClass === "REAL_DATA").length;
    const estimatedMetricPeriods = experiment.metricEvents.filter((event) => event.dataClass === "ESTIMATED_DATA").length;
    const feedback = experiment.feedback as { learning?: unknown } | null;
    return toRow({
      id: experiment.id,
      opportunityId: experiment.opportunityId,
      status: experiment.status,
      decision: experiment.decision,
      realMetricPeriods,
      estimatedMetricPeriods,
      hasLearningSignal: Boolean(feedback?.learning),
      handoffStatus: experiment.handoff?.status ?? null,
      requiresHumanApproval: approvalByOpportunity.get(experiment.opportunityId) === true,
      hasExecutionBlocker: blockerByOpportunity.get(experiment.opportunityId) === true,
      isBlocked: false,
    });
  });

  return calculateGrowthPortfolioState({
    portfolio: base.portfolio,
    controller: base.controller,
    experimentRows: rows,
    activeResearchRuns: base.controller.observed.activeResearchRuns,
    activeExecutions: base.controller.observed.activeExecutions,
    systemBlocked: systemHealth.status === "BLOCKED",
    now,
  });
}
