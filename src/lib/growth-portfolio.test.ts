import { describe, expect, it } from "vitest";
import {
  calculateGrowthPortfolioState,
  detectGrowthRunawaySignals,
  GROWTH_PORTFOLIO_POLICY,
  type GrowthExperimentRow,
} from "@/lib/growth-portfolio";
import type { OpportunityPortfolioIntelligence } from "@/lib/opportunity-portfolio";
import type { PortfolioOperatingController } from "@/lib/portfolio-operating-controller";

const NOW = new Date("2026-09-25T12:00:00.000Z");

function portfolio(overrides: Partial<OpportunityPortfolioIntelligence> = {}): OpportunityPortfolioIntelligence {
  return {
    totalOpportunities: 2,
    activeOpportunities: 2,
    blockedOpportunities: 0,
    researchRequired: 0,
    validationRequired: 0,
    experimentsRequired: 1,
    handoffReady: 0,
    executionReady: 0,
    humanReviewRequired: 0,
    portfolioConfidence: 50,
    concentrationWarnings: [],
    staleOpportunityCount: 0,
    evidenceQualitySummary: {
      opportunitiesWithValidationConfidence: 1,
      averageConfidence: 50,
      realDataOpportunities: 1,
      aiEstimateOpportunities: 1,
      nonRealDataLimitations: ["1 opportunity(ies) have no persisted real validation"],
    },
    experimentCoverageSummary: {
      opportunitiesWithExperiments: 1,
      withSufficientRealData: 0,
      withInsufficientRealData: 1,
      estimatedOnly: 0,
      withNoData: 1,
      averageRealMetricPeriods: 0,
    },
    recommendedOpportunityIds: ["opp-1"],
    recommendedNextActions: [],
    queues: {
      RESEARCH_QUEUE: [],
      VALIDATION_QUEUE: [],
      EXPERIMENT_QUEUE: ["opp-2"],
      LEARNING_QUEUE: ["opp-1"],
      HANDOFF_QUEUE: [],
      EXECUTION_QUEUE: [],
      HUMAN_REVIEW_QUEUE: [],
      BLOCKED_QUEUE: [],
      MONITOR_QUEUE: [],
    },
    portfolioDecision: "RUN_EXPERIMENTS",
    recommendations: [],
    explanation: [],
    dataClass: "AI_ESTIMATE",
    generatedAt: NOW.toISOString(),
    bounds: { maxOpportunities: 50, truncated: false },
    ...overrides,
  } as OpportunityPortfolioIntelligence;
}

function controller(overrides: Partial<PortfolioOperatingController> = {}): PortfolioOperatingController {
  return {
    cycleId: "portfolio-cycle-1",
    portfolioDecision: "RUN_EXPERIMENTS",
    queues: {},
    items: [],
    selectedOpportunityIds: ["opp-2"],
    deferredOpportunityIds: ["opp-1"],
    limits: {
      maxOpportunitiesPerCycle: 5,
      maxResearchRuns: 2,
      maxConcurrentExperiments: 3,
      maxConcurrentExecutions: 2,
      maxMetricsPerCycle: 50,
      maxRetries: 3,
    },
    observed: { activeResearchRuns: 0, activeExperiments: 0, activeExecutions: 0, metricsAvailable: 0 },
    blocked: false,
    reasons: [],
    generatedAt: NOW.toISOString(),
    ...overrides,
  } as PortfolioOperatingController;
}

function row(overrides: Partial<GrowthExperimentRow> = {}): GrowthExperimentRow {
  return {
    experimentId: "exp-1",
    opportunityId: "opp-1",
    status: "RUNNING",
    decision: null,
    realMetricPeriods: 0,
    estimatedMetricPeriods: 0,
    unmeasured: true,
    dataClass: "NONE",
    experimentSufficient: false,
    hasLearningSignal: false,
    handoffStatus: null,
    requiresHumanApproval: false,
    hasExecutionBlocker: false,
    isBlocked: false,
    ...overrides,
  };
}

describe("Phase 23 growth portfolio policy", () => {
  it("reuses the existing Phase 19/20 operating limits instead of inventing new ones", () => {
    expect(GROWTH_PORTFOLIO_POLICY.MAX_CONCURRENT_EXPERIMENTS).toBe(3);
    expect(GROWTH_PORTFOLIO_POLICY.MAX_CONCURRENT_EXECUTIONS).toBe(2);
    expect(GROWTH_PORTFOLIO_POLICY.MAX_RESEARCH_RUNS).toBe(2);
  });
});

describe("Phase 23 growth capacity", () => {
  it("reports AVAILABLE when usage is within the existing limits", () => {
    const state = calculateGrowthPortfolioState({
      portfolio: portfolio(),
      controller: controller(),
      experimentRows: [row({ realMetricPeriods: 2, unmeasured: false, dataClass: "REAL_DATA" })],
      now: NOW,
    });
    expect(state.capacity.state).toBe("AVAILABLE");
    expect(state.capacity.starvationReason).toBeNull();
  });

  it("reports AT_CAPACITY when execution slots are consumed", () => {
    const state = calculateGrowthPortfolioState({
      portfolio: portfolio(),
      controller: controller(),
      experimentRows: [],
      activeExecutions: 2,
      now: NOW,
    });
    expect(state.capacity.state).toBe("AT_CAPACITY");
  });

  it("reports STARVED with an explicit reason when measurements are missing", () => {
    const rows = [
      row({ experimentId: "exp-1", opportunityId: "opp-1" }),
      row({ experimentId: "exp-2", opportunityId: "opp-2" }),
      row({ experimentId: "exp-3", opportunityId: "opp-3" }),
      row({ experimentId: "exp-4", opportunityId: "opp-4" }),
      row({ experimentId: "exp-5", opportunityId: "opp-5" }),
    ];
    const state = calculateGrowthPortfolioState({
      portfolio: portfolio(),
      controller: controller(),
      experimentRows: rows,
      now: NOW,
    });
    expect(state.capacity.state).toBe("STARVED");
    expect(state.capacity.starvationReason).toContain("no recorded measurements");
  });

  it("reports BLOCKED when system health is blocked", () => {
    const state = calculateGrowthPortfolioState({
      portfolio: portfolio(),
      controller: controller(),
      experimentRows: [],
      systemBlocked: true,
      now: NOW,
    });
    expect(state.capacity.state).toBe("BLOCKED");
  });
});

describe("Phase 23 runaway prevention", () => {
  it("flags retry-exhausted experiments via persisted execution blockers only", () => {
    const signals = detectGrowthRunawaySignals([row({ hasExecutionBlocker: true })]);
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe("RETRY_EXHAUSTED");
    expect(signals[0].affectedOpportunityIds).toEqual(["opp-1"]);
  });

  it("flags an unmeasured backlog at the policy threshold", () => {
    const rows = [1, 2, 3, 4, 5].map((n) => row({ experimentId: `exp-${n}`, opportunityId: `opp-${n}` }));
    const signals = detectGrowthRunawaySignals(rows);
    expect(signals.some((signal) => signal.kind === "UNMEASURED_BACKLOG")).toBe(true);
  });

  it("does not flag a single unmeasured experiment", () => {
    expect(detectGrowthRunawaySignals([row()])).toHaveLength(0);
  });

  it("flags estimated-only data as a data-quality runaway signal", () => {
    const rows = [1, 2, 3].map((n) =>
      row({ experimentId: `exp-${n}`, opportunityId: `opp-${n}`, unmeasured: false, dataClass: "ESTIMATED_DATA", estimatedMetricPeriods: 2 }),
    );
    const signals = detectGrowthRunawaySignals(rows);
    expect(signals.some((signal) => signal.kind === "ESTIMATED_ONLY_DATA")).toBe(true);
  });

  it("ignores stopped or blocked experiments when detecting runaway patterns", () => {
    const rows = [1, 2, 3, 4, 5].map((n) =>
      row({ experimentId: `exp-${n}`, opportunityId: `opp-${n}`, status: "STOPPED" }),
    );
    expect(detectGrowthRunawaySignals(rows)).toHaveLength(0);
  });
});

describe("Phase 23 growth state composition", () => {
  it("maps experiments to existing controller queues without re-ranking", () => {
    const state = calculateGrowthPortfolioState({
      portfolio: portfolio(),
      controller: controller({
        items: [
          {
            opportunityId: "opp-1",
            queue: "LEARNING_QUEUE",
            stage: "LEARNING",
            selected: false,
            requiredApproval: false,
            blocked: false,
            reasons: [],
            priorityScore: null,
            recommendationReason: null,
            dataClass: "AI_ESTIMATE",
          },
        ],
      }),
      experimentRows: [row()],
      now: NOW,
    });
    expect(state.experiments[0].queue).toBe("LEARNING_QUEUE");
    expect(state.experiments[0].stage).toBe("LEARNING");
    expect(state.portfolioDecision).toBe("RUN_EXPERIMENTS");
    expect(state.dataClass).toBe("AI_ESTIMATE");
  });

  it("summarizes the closed-loop integration honestly", () => {
    const state = calculateGrowthPortfolioState({
      portfolio: portfolio(),
      controller: controller(),
      experimentRows: [row({ realMetricPeriods: 2, unmeasured: false, dataClass: "REAL_DATA", hasLearningSignal: true })],
      now: NOW,
    });
    expect(state.closedLoopSummary.experimentsWithLearningSignal).toBe(1);
    expect(state.closedLoopSummary.experimentsWithRealData).toBe(1);
    expect(state.closedLoopSummary.experimentsNotMeasured).toBe(0);
    expect(state.closedLoopSummary.explanation.join(" ")).toContain("Phase 6C/18/22");
  });

  it("marks reprioritization active only from existing controller deferrals", () => {
    const deferred = calculateGrowthPortfolioState({
      portfolio: portfolio(),
      controller: controller({ deferredOpportunityIds: ["opp-1"] }),
      experimentRows: [],
      now: NOW,
    });
    expect(deferred.closedLoopSummary.reprioritizationActive).toBe(true);
    const notDeferred = calculateGrowthPortfolioState({
      portfolio: portfolio(),
      controller: controller({ deferredOpportunityIds: [] }),
      experimentRows: [],
      now: NOW,
    });
    expect(notDeferred.closedLoopSummary.reprioritizationActive).toBe(false);
  });
});
