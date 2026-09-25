/**
 * Phase 23 — Autonomous Growth & Experiment Portfolio (pure, deterministic).
 *
 * Composes the EXISTING portfolio intelligence, operating controller, and
 * Phase 22 closed-loop contracts into a bounded growth view. This module:
 * - does NOT create a new scoring or ranking system (the existing
 *   experiment-prioritization weights remain authoritative);
 * - does NOT fabricate metrics, revenue, users, conversions, or results —
 *   missing real measurements stay NOT_MEASURED;
 * - derives no new persisted status: every state is a read-model projection.
 */
import {
  PORTFOLIO_CYCLE_LIMITS,
  type PortfolioOperatingController,
  type PortfolioOperatingItem,
} from "@/lib/portfolio-operating-controller";
import type { OpportunityPortfolioIntelligence } from "@/lib/opportunity-portfolio";

/* ------------------------------------------------------------------ */
/* Growth policy (explicit, centralized bounds)                         */
/* ------------------------------------------------------------------ */

/**
 * Growth governance bounds. They REUSE the existing Phase 19/20 operating
 * limits and add no second authority: capacity here only observes and
 * projects the same ceilings the controller already enforces.
 */
export const GROWTH_PORTFOLIO_POLICY = {
  /** Max concurrent experiments carried by the existing operating limits. */
  MAX_CONCURRENT_EXPERIMENTS: PORTFOLIO_CYCLE_LIMITS.maxConcurrentExperiments,
  /** Max concurrent executions carried by the existing operating limits. */
  MAX_CONCURRENT_EXECUTIONS: PORTFOLIO_CYCLE_LIMITS.maxConcurrentExecutions,
  /** Max research runs per bounded cycle (Phase 19 controller limit). */
  MAX_RESEARCH_RUNS: PORTFOLIO_CYCLE_LIMITS.maxResearchRuns,
  /** Retries before an experiment is flagged for bounded backoff review. */
  MAX_EXPERIMENT_RETRIES: PORTFOLIO_CYCLE_LIMITS.maxRetries,
  /** Estimated-only experiments tolerated before a data-quality warning. */
  MAX_ESTIMATED_ONLY_EXPERIMENTS: 3,
  /** Experiments with zero measurements tolerated before a warning. */
  MAX_UNMEASURED_EXPERIMENTS: 5,
} as const;

export const GROWTH_CAPACITY_STATES = [
  "AVAILABLE",
  "AT_CAPACITY",
  "STARVED",
  "BLOCKED",
] as const;
export type GrowthCapacityState = (typeof GROWTH_CAPACITY_STATES)[number];

export type GrowthRunawayKind =
  | "RETRY_EXHAUSTED"
  | "REPEATED_FAILURES"
  | "UNMEASURED_BACKLOG"
  | "ESTIMATED_ONLY_DATA";

export interface GrowthRunawaySignal {
  kind: GrowthRunawayKind;
  /** Deterministic, human-readable basis — no inference beyond the input. */
  detail: string;
  affectedOpportunityIds: string[];
}

export interface GrowthExperimentRow {
  experimentId: string;
  opportunityId: string;
  status: string;
  decision: string | null;
  /** Recorded REAL_DATA metric periods (estimated data never counted). */
  realMetricPeriods: number;
  estimatedMetricPeriods: number;
  unmeasured: boolean;
  dataClass: "NONE" | "ESTIMATED_DATA" | "REAL_DATA";
  experimentSufficient: boolean;
  hasLearningSignal: boolean;
  handoffStatus: string | null;
  requiresHumanApproval: boolean;
  hasExecutionBlocker: boolean;
  isBlocked: boolean;
}

export interface GrowthCapacity {
  state: GrowthCapacityState;
  activeExperiments: number;
  maxExperiments: number;
  activeExecutions: number;
  maxExecutions: number;
  activeResearchRuns: number;
  maxResearchRuns: number;
  /** Explicit starvation statement — never invented. */
  starvationReason: string | null;
  explanation: string[];
}

export interface GrowthPortfolioState {
  portfolio: OpportunityPortfolioIntelligence;
  /** Existing operating controller verbatim (no re-selection). */
  controller: PortfolioOperatingController;
  experiments: Array<{
    experimentId: string;
    opportunityId: string;
    queue: string | null;
    stage: string | null;
  }>;
  capacity: GrowthCapacity;
  runawaySignals: GrowthRunawaySignal[];
  /** Learning → reassessment → reprioritization integration summary. */
  closedLoopSummary: {
    experimentsWithLearningSignal: number;
    experimentsWithRealData: number;
    experimentsNotMeasured: number;
    experimentsEstimatedOnly: number;
    /** True when the existing controller deferred work to protect capacity. */
    reprioritizationActive: boolean;
    explanation: string[];
  };
  portfolioDecision: OpportunityPortfolioIntelligence["portfolioDecision"];
  explanation: string[];
  dataClass: "REAL_DATA" | "AI_ESTIMATE" | "SAMPLE_DATA";
  generatedAt: string;
}

function buildCapacity(input: {
  activeExperiments: number;
  activeExecutions: number;
  activeResearchRuns: number;
  unmeasuredExperiments: number;
  estimatedOnlyExperiments: number;
  systemBlocked: boolean;
}): GrowthCapacity {
  const explanation: string[] = [
    "Capacity reuses the existing Phase 19/20 operating limits; no second budget is introduced.",
  ];
  const starvationReasons: string[] = [];
  if (input.unmeasuredExperiments >= GROWTH_PORTFOLIO_POLICY.MAX_UNMEASURED_EXPERIMENTS) {
    starvationReasons.push(
      `${input.unmeasuredExperiments} experiment(s) have no recorded measurements, starving learning and reallocation.`,
    );
  }
  if (input.estimatedOnlyExperiments >= GROWTH_PORTFOLIO_POLICY.MAX_ESTIMATED_ONLY_EXPERIMENTS) {
    starvationReasons.push(
      `${input.estimatedOnlyExperiments} experiment(s) hold ESTIMATED_DATA only; estimated data never feeds growth decisions.`,
    );
  }
  const executionAtCapacity =
    input.activeExecutions >= GROWTH_PORTFOLIO_POLICY.MAX_CONCURRENT_EXECUTIONS;
  const experimentAtCapacity =
    input.activeExperiments >= GROWTH_PORTFOLIO_POLICY.MAX_CONCURRENT_EXPERIMENTS;
  const state: GrowthCapacityState = input.systemBlocked
    ? "BLOCKED"
    : starvationReasons.length > 0
      ? "STARVED"
      : experimentAtCapacity || input.activeExecutions >= GROWTH_PORTFOLIO_POLICY.MAX_CONCURRENT_EXECUTIONS
        ? "AT_CAPACITY"
        : "AVAILABLE";
  explanation.push(
    `Observed ${input.activeExperiments}/${GROWTH_PORTFOLIO_POLICY.MAX_CONCURRENT_EXPERIMENTS} experiment slots and ${input.activeExecutions}/${GROWTH_PORTFOLIO_POLICY.MAX_CONCURRENT_EXECUTIONS} execution slots in use.`,
  );
  if (starvationReasons.length > 0) explanation.push(...starvationReasons);
  return {
    state,
    activeExperiments: input.activeExperiments,
    maxExperiments: GROWTH_PORTFOLIO_POLICY.MAX_CONCURRENT_EXPERIMENTS,
    activeExecutions: input.activeExecutions,
    maxExecutions: GROWTH_PORTFOLIO_POLICY.MAX_CONCURRENT_EXECUTIONS,
    activeResearchRuns: input.activeResearchRuns,
    maxResearchRuns: GROWTH_PORTFOLIO_POLICY.MAX_RESEARCH_RUNS,
    starvationReason: starvationReasons.length > 0 ? starvationReasons.join(" ") : null,
    explanation,
  };
}

/**
 * Detect bounded runaway patterns from persisted facts only. A signal never
 * pauses or cancels anything by itself — it is advisory and explainable.
 */
export function detectGrowthRunawaySignals(
  rows: readonly GrowthExperimentRow[],
): GrowthRunawaySignal[] {
  const signals: GrowthRunawaySignal[] = [];
  const activeRows = rows.filter((row) => !row.isBlocked && !["STOPPED", "KILL", "COMPLETED"].includes(row.status));
  const retryExhausted = activeRows.filter((row) => row.hasExecutionBlocker);
  if (retryExhausted.length > 0) {
    signals.push({
      kind: "RETRY_EXHAUSTED",
      detail: `${retryExhausted.length} experiment(s) carry a persisted execution blocker after bounded retries; human review is required before further attempts.`,
      affectedOpportunityIds: [...new Set(retryExhausted.map((row) => row.opportunityId))].sort(),
    });
  }
  const unmeasured = activeRows.filter((row) => row.unmeasured);
  if (unmeasured.length >= GROWTH_PORTFOLIO_POLICY.MAX_UNMEASURED_EXPERIMENTS) {
    signals.push({
      kind: "UNMEASURED_BACKLOG",
      detail: `${unmeasured.length} active experiment(s) have never recorded a measurement; measurement work must precede further experiment creation.`,
      affectedOpportunityIds: [...new Set(unmeasured.map((row) => row.opportunityId))].sort(),
    });
  }
  const estimatedOnly = activeRows.filter((row) => row.dataClass === "ESTIMATED_DATA");
  if (estimatedOnly.length >= GROWTH_PORTFOLIO_POLICY.MAX_ESTIMATED_ONLY_EXPERIMENTS) {
    signals.push({
      kind: "ESTIMATED_ONLY_DATA",
      detail: `${estimatedOnly.length} active experiment(s) hold ESTIMATED_DATA only; estimated data is excluded from learning and prioritization.`,
      affectedOpportunityIds: [...new Set(estimatedOnly.map((row) => row.opportunityId))].sort(),
    });
  }
  return signals;
}

/**
 * Compose one bounded growth state from the existing read-models. The rows
 * come from the existing decision loader/portfolio inputs plus experiment
 * coverage facts; nothing is re-ranked and nothing new is persisted.
 */
export function calculateGrowthPortfolioState(input: {
  portfolio: OpportunityPortfolioIntelligence;
  controller: PortfolioOperatingController;
  experimentRows: readonly GrowthExperimentRow[];
  activeResearchRuns?: number;
  activeExecutions?: number;
  systemBlocked?: boolean;
  now?: Date;
}): GrowthPortfolioState {
  const now = input.now ?? new Date();
  const rows = input.experimentRows;
  const itemByOpportunity = new Map<string, PortfolioOperatingItem>(
    input.controller.items.map((item) => [item.opportunityId, item]),
  );
  const experiments = rows.map((row) => {
    const item = itemByOpportunity.get(row.opportunityId) ?? null;
    return {
      experimentId: row.experimentId,
      opportunityId: row.opportunityId,
      queue: item?.queue ?? null,
      stage: item?.stage ?? null,
    };
  });
  const activeExperiments = rows.filter(
    (row) => !["STOPPED", "KILL", "COMPLETED"].includes(row.status) && !row.isBlocked,
  ).length;
  const unmeasuredExperiments = rows.filter((row) => row.unmeasured).length;
  const estimatedOnlyExperiments = rows.filter((row) => row.dataClass === "ESTIMATED_DATA").length;
  const capacity = buildCapacity({
    activeExperiments,
    activeExecutions: Math.min(input.activeExecutions ?? 0, GROWTH_PORTFOLIO_POLICY.MAX_CONCURRENT_EXECUTIONS),
    activeResearchRuns: Math.min(input.activeResearchRuns ?? 0, GROWTH_PORTFOLIO_POLICY.MAX_RESEARCH_RUNS),
    unmeasuredExperiments,
    estimatedOnlyExperiments,
    systemBlocked: input.systemBlocked === true,
  });
  const runawaySignals = detectGrowthRunawaySignals(rows);
  const closedLoopSummary = {
    experimentsWithLearningSignal: rows.filter((row) => row.hasLearningSignal).length,
    experimentsWithRealData: rows.filter((row) => row.dataClass === "REAL_DATA").length,
    experimentsNotMeasured: unmeasuredExperiments,
    experimentsEstimatedOnly: estimatedOnlyExperiments,
    reprioritizationActive: input.controller.deferredOpportunityIds.length > 0,
    explanation: [
      "Learning, reassessment, and reprioritization reuse the existing Phase 6C/18/22 services; no new formula is applied here.",
      input.controller.deferredOpportunityIds.length > 0
        ? `${input.controller.deferredOpportunityIds.length} opportunity(ies) were deferred by the existing operating controller to protect bounded capacity.`
        : "No opportunity was deferred by the existing operating controller in this cycle.",
    ],
  };
  const explanation = [
    "Growth state is a read-model projection of the existing portfolio intelligence and operating controller.",
    "A successful growth cycle does not imply business success, profitability, or future income.",
  ];
  return {
    portfolio: input.portfolio,
    controller: input.controller,
    experiments,
    capacity,
    runawaySignals,
    closedLoopSummary,
    portfolioDecision: input.portfolio.portfolioDecision,
    explanation,
    dataClass: input.portfolio.dataClass,
    generatedAt: now.toISOString(),
  };
}
