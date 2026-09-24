/**
 * Phase 19 — deterministic portfolio operating controller (pure).
 *
 * Portfolio intelligence and experiment prioritization remain authoritative;
 * this controller only projects their recommendations into a bounded,
 * explainable operating cycle. It never executes, persists, or changes an
 * opportunity state.
 */
import type { OpportunityDecision } from "@/lib/opportunity-decision";
import {
  bucketForOpportunity,
  PORTFOLIO_QUEUES,
  type OpportunityPortfolioIntelligence,
  type PortfolioOpportunityInput,
  type PortfolioQueue,
} from "@/lib/opportunity-portfolio";

export const PORTFOLIO_CYCLE_LIMITS = {
  maxOpportunitiesPerCycle: 5,
  maxResearchRuns: 2,
  maxConcurrentExperiments: 3,
  maxConcurrentExecutions: 2,
  maxMetricsPerCycle: 50,
  maxRetries: 3,
} as const;

export interface PortfolioOperatingInput {
  portfolio: OpportunityPortfolioIntelligence;
  rows: PortfolioOpportunityInput[];
  decisions: Map<string, OpportunityDecision>;
  activeResearchRuns?: number;
  activeExperiments?: number;
  activeExecutions?: number;
  metricsAvailable?: number;
  stopCycle?: boolean;
}

export interface PortfolioOperatingItem {
  opportunityId: string;
  queue: PortfolioQueue;
  stage: string;
  selected: boolean;
  requiredApproval: boolean;
  blocked: boolean;
  reasons: string[];
  priorityScore: number | null;
  recommendationReason: string | null;
  dataClass: PortfolioOpportunityInput["dataClass"];
}

export interface PortfolioOperatingController {
  cycleId: string;
  portfolioDecision: OpportunityPortfolioIntelligence["portfolioDecision"];
  queues: Record<PortfolioQueue, string[]>;
  items: PortfolioOperatingItem[];
  selectedOpportunityIds: string[];
  deferredOpportunityIds: string[];
  limits: typeof PORTFOLIO_CYCLE_LIMITS;
  observed: {
    activeResearchRuns: number;
    activeExperiments: number;
    activeExecutions: number;
    metricsAvailable: number;
  };
  blocked: boolean;
  reasons: string[];
  generatedAt: string;
}

const QUEUE_STAGE: Record<PortfolioQueue, string> = {
  RESEARCH_QUEUE: "RESEARCH",
  VALIDATION_QUEUE: "VALIDATION",
  EXPERIMENT_QUEUE: "EXPERIMENT",
  LEARNING_QUEUE: "LEARNING",
  HANDOFF_QUEUE: "HANDOFF",
  EXECUTION_QUEUE: "EXECUTION",
  HUMAN_REVIEW_QUEUE: "OPPORTUNITY_SELECTION",
  BLOCKED_QUEUE: "OPPORTUNITY_SELECTION",
  MONITOR_QUEUE: "MEASUREMENT",
};

function stableCycleId(portfolio: OpportunityPortfolioIntelligence, selected: string[]): string {
  const basis = `${portfolio.portfolioDecision}|${portfolio.totalOpportunities}|${selected.join(",")}`;
  let hash = 0;
  for (const character of basis) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return `portfolio-cycle-${Math.abs(hash).toString(36)}`;
}

function recommendationMap(portfolio: OpportunityPortfolioIntelligence) {
  return new Map(portfolio.recommendations.map((item) => [item.opportunityId, item]));
}

function bounded(value: number | undefined, max: number): number {
  return Math.max(0, Math.min(Math.floor(value ?? 0), max));
}

/** Build one bounded operating cycle from existing read-models. */
export function createPortfolioOperatingController(input: PortfolioOperatingInput): PortfolioOperatingController {
  const recommendations = recommendationMap(input.portfolio);
  const recommendationOrder = input.portfolio.recommendations.map((item) => item.opportunityId);
  const rows = input.rows.map((row) => ({ row, queue: bucketForOpportunity(row) }));
  const queues = Object.fromEntries(PORTFOLIO_QUEUES.map((queue) => [queue, [] as string[]])) as Record<PortfolioQueue, string[]>;
  const items: PortfolioOperatingItem[] = rows.map(({ row, queue }) => {
    queues[queue].push(row.opportunityId);
    const recommendation = recommendations.get(row.opportunityId);
    const reasons = [
      queue === "BLOCKED_QUEUE" ? "Persisted opportunity state is blocked." : `Existing portfolio bucket is ${queue}.`,
      recommendation?.reason ?? input.portfolio.explanation[0] ?? "No additional recommendation reason was persisted.",
      ...(row.blockerCount > 0 ? [`${row.blockerCount} persisted blocker(s) remain.`] : []),
      ...(row.requiresHumanApproval || row.taskApprovalPending ? ["A human approval is pending."] : []),
    ];
    return {
      opportunityId: row.opportunityId,
      queue,
      stage: QUEUE_STAGE[queue],
      selected: false,
      requiredApproval: row.requiresHumanApproval || row.taskApprovalPending === true,
      blocked: queue === "BLOCKED_QUEUE" || row.decision === "HUMAN_REVIEW" || row.decision === "REVIEW_CONFLICT",
      reasons,
      priorityScore: recommendation?.priorityScore ?? null,
      recommendationReason: recommendation?.reason ?? null,
      dataClass: row.dataClass,
    };
  });
  for (const queue of PORTFOLIO_QUEUES) queues[queue].sort();

  const ordered = [...items].sort((a, b) => {
    const ai = recommendationOrder.indexOf(a.opportunityId);
    const bi = recommendationOrder.indexOf(b.opportunityId);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi) || a.opportunityId.localeCompare(b.opportunityId);
  });
  const available = Math.min(
    PORTFOLIO_CYCLE_LIMITS.maxOpportunitiesPerCycle,
    Math.max(0, PORTFOLIO_CYCLE_LIMITS.maxOpportunitiesPerCycle - bounded(input.activeExecutions, PORTFOLIO_CYCLE_LIMITS.maxConcurrentExecutions)),
  );
  const executionLimitReached = bounded(input.activeExecutions, PORTFOLIO_CYCLE_LIMITS.maxConcurrentExecutions) >= PORTFOLIO_CYCLE_LIMITS.maxConcurrentExecutions;
  const experimentLimitReached = bounded(input.activeExperiments, PORTFOLIO_CYCLE_LIMITS.maxConcurrentExperiments) >= PORTFOLIO_CYCLE_LIMITS.maxConcurrentExperiments;
  const selected = ordered
    .filter((item) => !item.blocked && item.queue !== "BLOCKED_QUEUE")
    .filter((item) => !(executionLimitReached && item.queue === "EXECUTION_QUEUE"))
    .filter((item) => !(experimentLimitReached && item.queue === "EXPERIMENT_QUEUE"))
    .slice(0, available);
  const selectedIds = new Set(selected.map((item) => item.opportunityId));
  for (const item of items) item.selected = selectedIds.has(item.opportunityId);

  const reasons: string[] = [];
  if (input.stopCycle) reasons.push("Cycle stopped by an explicit safety condition.");
  if (bounded(input.activeExecutions, PORTFOLIO_CYCLE_LIMITS.maxConcurrentExecutions) >= PORTFOLIO_CYCLE_LIMITS.maxConcurrentExecutions) reasons.push("Concurrent execution limit reached.");
  if (bounded(input.activeExperiments, PORTFOLIO_CYCLE_LIMITS.maxConcurrentExperiments) >= PORTFOLIO_CYCLE_LIMITS.maxConcurrentExperiments) reasons.push("Concurrent experiment limit reached.");
  if (selected.length === 0) reasons.push("No safe opportunity is currently selectable within the bounded cycle.");
  reasons.push("Selection preserves the existing deterministic portfolio recommendation order; no profitability ranking is applied.");

  return {
    cycleId: stableCycleId(input.portfolio, selectedIds.size ? [...selectedIds].sort() : []),
    portfolioDecision: input.portfolio.portfolioDecision,
    queues,
    items,
    selectedOpportunityIds: selected.map((item) => item.opportunityId),
    deferredOpportunityIds: items.filter((item) => !item.selected).map((item) => item.opportunityId).sort(),
    limits: PORTFOLIO_CYCLE_LIMITS,
    observed: {
      activeResearchRuns: bounded(input.activeResearchRuns, PORTFOLIO_CYCLE_LIMITS.maxResearchRuns),
      activeExperiments: bounded(input.activeExperiments, PORTFOLIO_CYCLE_LIMITS.maxConcurrentExperiments),
      activeExecutions: bounded(input.activeExecutions, PORTFOLIO_CYCLE_LIMITS.maxConcurrentExecutions),
      metricsAvailable: bounded(input.metricsAvailable, PORTFOLIO_CYCLE_LIMITS.maxMetricsPerCycle),
    },
    blocked: Boolean(input.stopCycle) || selected.length === 0,
    reasons,
    generatedAt: input.portfolio.generatedAt,
  };
}
