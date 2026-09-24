import "server-only";
import { getPrisma } from "@/lib/db";
import {
  calculateOpportunityDecision,
  type OpportunityDecision,
} from "@/lib/opportunity-decision";
import { calculateResearchFreshness, READINESS_POLICY } from "@/lib/opportunity-readiness";
import type { PortfolioOpportunityInput } from "@/lib/opportunity-portfolio";
import type {
  ReadinessExperimentInput,
  ReadinessResearchRunInput,
  ReadinessValidationInput,
} from "@/lib/opportunity-readiness";

/**
 * Bounded loading — a single batch load for up to PORTFOLIO_POLICY
 * opportunities. Queries are constant-count (4 total) regardless of how many
 * opportunities are loaded, so this is deliberately NOT an N+1 loop.
 */
export const DECISION_LOAD_BOUNDS = {
  MAX_OPPORTUNITIES: 50,
  MAX_RESEARCH_RUNS_TOTAL: 200,
  /** Per-opportunity slices applied after grouping (matches readiness engine expectations). */
  MAX_RESEARCH_RUNS_PER_OPPORTUNITY: 10,
  MAX_EXPERIMENTS_TOTAL: 100,
  MAX_EXPERIMENTS_PER_OPPORTUNITY: 20,
  MAX_METRICS_PER_EXPERIMENT: 60,
  MAX_TASKS_TOTAL: 200,
} as const;

export interface LoadedOpportunity {
  opportunityId: string;
  decision: OpportunityDecision;
  /** Normalized persisted summary consumed by the portfolio layer. */
  portfolioInput: PortfolioOpportunityInput;
}

export interface DecisionLoadResult {
  entries: LoadedOpportunity[];
  /** True when the bounded read hit its limit (portfolio view is partial). */
  truncated: boolean;
}

type RunRow = {
  id: string;
  opportunityId: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  confidence: unknown;
  _count: { evidence: number };
  validation: {
    demandStatus: string;
    painPointStatus: string;
    commercialIntentStatus: string;
    trendStatus: string;
    competitionStatus: string;
    evidenceCoverage: unknown;
    sourceDiversity: number;
    contradictionCount: number;
    confidence: unknown;
  } | null;
};

type ExperimentRow = {
  id: string;
  opportunityId: string;
  status: string;
  decision: string | null;
  metricEvents: Array<{
    dataClass: string;
    conversions: number | null;
    revenue: unknown;
    cost: unknown;
    periodEnd: Date;
  }>;
};

function toDecimal(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Load decisions for the owner's opportunities in a bounded number of queries.
 *
 * Owner-scoped and sample-safe: `where` always includes the session owner's id
 * and `isSample: false`, so a foreign or sample opportunity is simply absent
 * (indistinguishable from missing) and never contributes to a result.
 */
export async function loadOpportunityDecisions(
  ownerId: string,
  options: { opportunityIds?: string[]; now?: Date } = {},
): Promise<DecisionLoadResult> {
  const prisma = getPrisma();
  const now = options.now ?? new Date();
  const opportunityIds = options.opportunityIds;

  const opportunities = await prisma.opportunity.findMany({
    where: {
      ownerId,
      isSample: false,
      ...(opportunityIds ? { id: { in: opportunityIds } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: DECISION_LOAD_BOUNDS.MAX_OPPORTUNITIES,
    select: {
      id: true,
      status: true,
      halalStatus: true,
      isSample: true,
      risks: true,
      handoffs: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
    },
  });

  if (opportunities.length === 0) {
    return { entries: [], truncated: false };
  }

  const ids = opportunities.map((row) => row.id);
  // Constant-count batch queries (3 more, not 3 per opportunity).
  const [runs, experiments, tasks] = await Promise.all([
    prisma.researchRun.findMany({
      where: { opportunityId: { in: ids } },
      orderBy: { startedAt: "desc" },
      take: DECISION_LOAD_BOUNDS.MAX_RESEARCH_RUNS_TOTAL,
      select: {
        id: true,
        opportunityId: true,
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
      where: { opportunityId: { in: ids }, isSample: false },
      orderBy: { updatedAt: "desc" },
      take: DECISION_LOAD_BOUNDS.MAX_EXPERIMENTS_TOTAL,
      select: {
        id: true,
        opportunityId: true,
        status: true,
        decision: true,
        metricEvents: {
          orderBy: { periodStart: "asc" },
          take: DECISION_LOAD_BOUNDS.MAX_METRICS_PER_EXPERIMENT,
          select: { dataClass: true, conversions: true, revenue: true, cost: true, periodEnd: true },
        },
      },
    }),
    prisma.agentTask.findMany({
      // Owner re-checked per row: AgentTask.ownerId is authoritative.
      where: { opportunityId: { in: ids }, ownerId },
      orderBy: { createdAt: "desc" },
      take: DECISION_LOAD_BOUNDS.MAX_TASKS_TOTAL,
      select: {
        opportunityId: true,
        status: true,
        taskType: true,
        requiresApproval: true,
        approvalState: true,
      },
    }),
  ]);

  /* ---------------- Group rows per opportunity (in memory) ---------------- */
  const runsByOpportunity = new Map<string, RunRow[]>();
  for (const run of runs as RunRow[]) {
    const list = runsByOpportunity.get(run.opportunityId) ?? [];
    list.push(run);
    runsByOpportunity.set(run.opportunityId, list);
  }
  const experimentsByOpportunity = new Map<string, ExperimentRow[]>();
  for (const experiment of experiments as ExperimentRow[]) {
    const list = experimentsByOpportunity.get(experiment.opportunityId) ?? [];
    list.push(experiment);
    experimentsByOpportunity.set(experiment.opportunityId, list);
  }
  const tasksByOpportunity = new Map<string, Array<{
    status: string;
    taskType: string;
    requiresApproval: boolean;
    approvalState: string | null;
  }>>();
  for (const task of tasks) {
    // AgentTask.opportunityId is nullable: a task not linked to an opportunity
    // is not part of that opportunity's execution state.
    if (!task.opportunityId) continue;
    const list = tasksByOpportunity.get(task.opportunityId) ?? [];
    list.push({
      status: task.status,
      taskType: task.taskType,
      requiresApproval: task.requiresApproval,
      approvalState: task.approvalState,
    });
    tasksByOpportunity.set(task.opportunityId, list);
  }

  const entries: LoadedOpportunity[] = [];

  for (const opportunity of opportunities) {
    const opportunityRuns = (runsByOpportunity.get(opportunity.id) ?? []).slice(
      0,
      DECISION_LOAD_BOUNDS.MAX_RESEARCH_RUNS_PER_OPPORTUNITY,
    );
    const opportunityExperiments = (experimentsByOpportunity.get(opportunity.id) ?? []).slice(
      0,
      DECISION_LOAD_BOUNDS.MAX_EXPERIMENTS_PER_OPPORTUNITY,
    );
    const opportunityTasks = tasksByOpportunity.get(opportunity.id) ?? [];
    const handoffStatus = opportunity.handoffs[0]?.status ?? null;

    const researchRuns: ReadinessResearchRunInput[] = opportunityRuns.map((run) => ({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      evidenceCount: run._count.evidence,
      confidence: toDecimal(run.confidence),
    }));

    // Validation of the most recent run that has one (newest first).
    const latestValidationRow = opportunityRuns.find((run) => run.validation !== null)?.validation ?? null;
    const validation: ReadinessValidationInput | null = latestValidationRow
      ? {
          demandStatus: latestValidationRow.demandStatus,
          painPointStatus: latestValidationRow.painPointStatus,
          commercialIntentStatus: latestValidationRow.commercialIntentStatus,
          trendStatus: latestValidationRow.trendStatus,
          competitionStatus: latestValidationRow.competitionStatus,
          evidenceCoverage: toDecimal(latestValidationRow.evidenceCoverage),
          sourceDiversity: latestValidationRow.sourceDiversity,
          contradictionCount: latestValidationRow.contradictionCount,
          confidence: toDecimal(latestValidationRow.confidence),
        }
      : null;

    const experimentInputs: ReadinessExperimentInput[] = opportunityExperiments.map((experiment) => ({
      id: experiment.id,
      status: experiment.status,
      decision: experiment.decision,
      metrics: experiment.metricEvents.map((metric) => ({
        dataClass: metric.dataClass,
        conversions: metric.conversions,
        revenue: metric.revenue === null ? null : toDecimal(metric.revenue),
        cost: metric.cost === null ? null : toDecimal(metric.cost),
      })),
    }));

    const hasRunningAgentTask = opportunityTasks.some((task) => task.status === "RUNNING");
    const hasAwaitingApprovalTask = opportunityTasks.some((task) => task.status === "WAITING_APPROVAL");
    const hasBlockedTask = opportunityTasks.some((task) => task.status === "BLOCKED");
    const hasCompletedExecution = opportunityTasks.some((task) => task.status === "COMPLETED");
    const hasApprovedTask = opportunityTasks.some(
      (task) => task.requiresApproval && task.approvalState === "APPROVED",
    );
    const hasPendingCapabilityTask = opportunityTasks.some(
      (task) => task.status === "READY" || task.status === "QUEUED",
    );

    const decision = calculateOpportunityDecision({
      opportunity: {
        id: opportunity.id,
        status: opportunity.status,
        halalStatus: opportunity.halalStatus,
        isSample: opportunity.isSample,
        handoffStatus,
        risksCount: opportunity.risks.length,
      },
      researchRuns,
      validation,
      experiments: experimentInputs,
      execution: {
        handoffStatus,
        hasRunningAgentTask,
        hasAwaitingApprovalTask,
        hasBlockedTask,
        hasCompletedExecution,
      },
      now,
    });

    /* ---------------- Portfolio summary row ---------------- */
    let realMetricPeriods = 0;
    let estimatedMetricPeriods = 0;
    let lastMetricEnd: Date | null = null;
    for (const experiment of opportunityExperiments) {
      for (const metric of experiment.metricEvents) {
        // SAMPLE_DATA / unknown classes are never counted as real evidence.
        if (metric.dataClass === "REAL_DATA") realMetricPeriods += 1;
        else if (metric.dataClass === "ESTIMATED_DATA") estimatedMetricPeriods += 1;
        const end = metric.periodEnd instanceof Date ? metric.periodEnd : new Date(metric.periodEnd);
        if (Number.isFinite(end.getTime()) && (!lastMetricEnd || end.getTime() > lastMetricEnd.getTime())) {
          lastMetricEnd = end;
        }
      }
    }
    const experimentDataClass: PortfolioOpportunityInput["experimentDataClass"] =
      realMetricPeriods > 0 ? "REAL_DATA" : estimatedMetricPeriods > 0 ? "ESTIMATED_DATA" : "NONE";
    const experimentSufficient = realMetricPeriods >= READINESS_POLICY.MIN_REAL_METRIC_PERIODS;
    const freshness = calculateResearchFreshness(
      researchRuns,
      READINESS_POLICY.DEFAULT_RESEARCH_FRESHNESS_DAYS,
      now,
    );
    const isBlocked = opportunity.status === "REJECTED" || opportunity.halalStatus === "NOT_ALLOWED";

    const portfolioInput: PortfolioOpportunityInput = {
      opportunityId: opportunity.id,
      decision: decision.decision,
      readinessState: decision.readinessState,
      lifecycleState: decision.lifecycleState,
      confidence: decision.confidence,
      decisionScore: decision.decisionScore,
      dataClass: decision.dataClass,
      researchFreshnessKind: freshness.kind,
      evidenceGapCount: decision.evidenceGaps.length,
      validationGapCount: decision.validationGaps.length,
      experimentGapCount: decision.experimentGaps.length,
      executionGapCount: decision.executionGaps.length,
      blockerCount: decision.blockers.length,
      // The decision engine maps ANY persisted contradiction to REVIEW_CONFLICT,
      // so this is the faithful signal without re-deriving the rules.
      hasContradictions: decision.decision === "REVIEW_CONFLICT",
      evidenceGapCodes: decision.evidenceGaps.map((gap) => gap.code),
      experimentCount: opportunityExperiments.length,
      realMetricPeriods,
      estimatedMetricPeriods,
      experimentDataClass,
      experimentSufficient,
      lastExperimentMetricAt: lastMetricEnd,
      hasLearningSignal: opportunityExperiments.some((experiment) => experiment.decision !== null),
      handoffStatus,
      requiresHumanApproval: hasAwaitingApprovalTask,
      hasExecutionBlocker: hasBlockedTask,
      isBlocked,
      latestResearchRunStatus: opportunityRuns[0]?.status ?? null,
      taskApprovalPending: hasAwaitingApprovalTask,
    };

    entries.push({ opportunityId: opportunity.id, decision, portfolioInput });
  }

  return {
    entries,
    truncated: opportunities.length >= DECISION_LOAD_BOUNDS.MAX_OPPORTUNITIES,
  };
}
