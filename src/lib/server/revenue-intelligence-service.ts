import "server-only";

import { getPrisma } from "@/lib/db";
import {
  calculateRevenueIntelligence,
  type RevenueExperimentInput,
  type RevenueIntelligence,
} from "@/lib/revenue-intelligence";

/** Bounded reads: the revenue view never loads an unbounded table. */
export const REVENUE_INTELLIGENCE_BOUNDS = {
  MAX_EXPERIMENTS: 100,
  /** Max metric rows read PER EXPERIMENT (Phase 27: per-experiment, not global). */
  MAX_METRIC_ROWS_PER_EXPERIMENT: 200,
  MAX_TASKS: 100,
} as const;

const OPEN_STATUSES = new Set(["READY", "RUNNING", "ITERATING", "PAUSED"]);

/**
 * Owner-scoped Phase 26 revenue state. Reads only the session owner's
 * non-sample rows, reuses the existing metric shapes plus the same
 * approval/blocker facts the Phase 23 growth view uses, and performs no
 * external call, provider activation, or execution. Estimated records are
 * read only so the model can honestly label what is measured versus not;
 * they never upgrade any REAL_DATA claim.
 *
 * Phase 27: metric rows are bounded PER EXPERIMENT (matching the established
 * decision-loader pattern). A single global take would silently starve older
 * experiments once the portfolio exceeds the global cap, misclassifying real
 * measurements as NOT_MEASURED. A bounded truncation flag preserves honesty
 * when even the per-experiment cap is exceeded.
 */
export async function getRevenueIntelligence(
  ownerId: string,
  now = new Date(),
): Promise<RevenueIntelligence & { bounds: typeof REVENUE_INTELLIGENCE_BOUNDS; truncated: boolean }> {
  const prisma = getPrisma();
  const [experiments, pendingTasks] = await Promise.all([
    prisma.experiment.findMany({
      where: { opportunity: { ownerId, isSample: false }, isSample: false },
      select: {
        id: true,
        opportunityId: true,
        status: true,
        decision: true,
        _count: { select: { metricEvents: true } },
        metricEvents: {
          orderBy: { recordedAt: "desc" },
          take: REVENUE_INTELLIGENCE_BOUNDS.MAX_METRIC_ROWS_PER_EXPERIMENT,
          select: {
            periodStart: true,
            periodEnd: true,
            recordedAt: true,
            impressions: true,
            clicks: true,
            visits: true,
            leads: true,
            conversions: true,
            revenue: true,
            cost: true,
            currency: true,
            source: true,
            dataClass: true,
            notes: true,
          },
        },
      },
      take: REVENUE_INTELLIGENCE_BOUNDS.MAX_EXPERIMENTS,
      orderBy: { createdAt: "desc" },
    }),
    prisma.agentTask.findMany({
      where: { ownerId, opportunityId: { not: null }, status: { in: ["WAITING_APPROVAL", "BLOCKED"] } },
      select: { opportunityId: true, status: true },
      take: REVENUE_INTELLIGENCE_BOUNDS.MAX_TASKS,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const approvalByOpportunity = new Set<string>();
  const blockerByOpportunity = new Set<string>();
  for (const task of pendingTasks) {
    if (!task.opportunityId) continue;
    if (task.status === "WAITING_APPROVAL") approvalByOpportunity.add(task.opportunityId);
    if (task.status === "BLOCKED") blockerByOpportunity.add(task.opportunityId);
  }

  const metricsByExperiment = new Map<string, RevenueExperimentInput["metricPoints"]>();
  let anyMetricTruncated = false;
  for (const experiment of experiments) {
    if (experiment._count.metricEvents > REVENUE_INTELLIGENCE_BOUNDS.MAX_METRIC_ROWS_PER_EXPERIMENT) {
      anyMetricTruncated = true;
    }
    metricsByExperiment.set(
      experiment.id,
      experiment.metricEvents.map((row) => ({
        periodStart: row.periodStart.toISOString(),
        periodEnd: row.periodEnd.toISOString(),
        recordedAt: row.recordedAt.toISOString(),
        impressions: row.impressions,
        clicks: row.clicks,
        visits: row.visits,
        leads: row.leads,
        conversions: row.conversions,
        revenue: row.revenue === null ? null : Number(row.revenue),
        cost: row.cost === null ? null : Number(row.cost),
        currency: row.currency,
        source: row.source,
        dataClass: row.dataClass as "REAL_DATA" | "ESTIMATED_DATA",
        notes: row.notes,
      })),
    );
  }

  const inputs: RevenueExperimentInput[] = experiments.map((experiment) => ({
    experimentId: experiment.id,
    opportunityId: experiment.opportunityId,
    status: experiment.status,
    decision: experiment.decision,
    isBlocked:
      blockerByOpportunity.has(experiment.opportunityId) ||
      (!OPEN_STATUSES.has(experiment.status) && !["STOPPED", "COMPLETED"].includes(experiment.status)),
    requiresHumanApproval: approvalByOpportunity.has(experiment.opportunityId),
    metricPoints: metricsByExperiment.get(experiment.id) ?? [],
  }));

  const intelligence = calculateRevenueIntelligence(inputs, now);
  return {
    ...intelligence,
    bounds: REVENUE_INTELLIGENCE_BOUNDS,
    truncated: anyMetricTruncated,
  };
}
