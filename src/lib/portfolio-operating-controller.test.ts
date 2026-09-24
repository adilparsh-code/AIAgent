import { describe, expect, it } from "vitest";
import { createPortfolioOperatingController, PORTFOLIO_CYCLE_LIMITS } from "./portfolio-operating-controller";
import { calculatePortfolioIntelligence, type PortfolioOpportunityInput } from "./opportunity-portfolio";
import type { OpportunityDecision } from "./opportunity-decision";

const NOW = new Date("2026-09-24T12:00:00.000Z");

function row(id: string, decision: PortfolioOpportunityInput["decision"], overrides: Partial<PortfolioOpportunityInput> = {}): PortfolioOpportunityInput {
  return {
    opportunityId: id,
    decision,
    readinessState: "HANDOFF_READY",
    lifecycleState: "HANDOFF_READY",
    confidence: 80,
    decisionScore: 70,
    dataClass: "REAL_DATA",
    researchFreshnessKind: "CURRENT_RESEARCH",
    evidenceGapCount: 0,
    validationGapCount: 0,
    experimentGapCount: 0,
    executionGapCount: 0,
    blockerCount: 0,
    hasContradictions: false,
    evidenceGapCodes: [],
    experimentCount: 2,
    realMetricPeriods: 2,
    estimatedMetricPeriods: 0,
    experimentDataClass: "REAL_DATA",
    experimentSufficient: true,
    lastExperimentMetricAt: NOW,
    hasLearningSignal: true,
    handoffStatus: "ACCEPTED",
    requiresHumanApproval: false,
    hasExecutionBlocker: false,
    isBlocked: false,
    latestResearchRunStatus: "COMPLETED",
    ...overrides,
  };
}

function decision(id: string, state: OpportunityDecision["decision"]): OpportunityDecision {
  return {
    opportunityId: id,
    decision: state,
    decisionScore: 70,
    readinessState: "READY_FOR_EXECUTION",
    confidence: 80,
    blockers: [],
    evidenceGaps: [],
    validationGaps: [],
    experimentGaps: [],
    executionGaps: [],
    recommendedAction: { action: "Execute the approved task.", basis: "Persisted gates are satisfied." },
    explanation: [],
    dataClass: "REAL_DATA",
    generatedAt: NOW.toISOString(),
    decisionInputs: { readinessApplied: true, validationApplied: true, experimentApplied: true, handoffApplied: true, executionApplied: true, freshnessApplied: true },
    lifecycleState: "EXECUTION_READY",
  };
}

describe("portfolio operating controller", () => {
  it("explains queues and preserves existing recommendation order", () => {
    const rows = [row("opp-b", "HANDOFF_READY"), row("opp-a", "EXECUTION_READY"), row("opp-c", "RESEARCH_MORE", { researchFreshnessKind: "NO_RESEARCH", experimentCount: 0 })];
    const portfolio = calculatePortfolioIntelligence({ opportunities: rows, now: NOW });
    const result = createPortfolioOperatingController({
      portfolio,
      rows,
      decisions: new Map(rows.map((item) => [item.opportunityId, decision(item.opportunityId, item.decision as OpportunityDecision["decision"])])),
    });
    expect(result.queues.EXECUTION_QUEUE).toEqual(["opp-a"]);
    expect(result.queues.HANDOFF_QUEUE).toEqual(["opp-b"]);
    expect(result.queues.RESEARCH_QUEUE).toEqual(["opp-c"]);
    expect(result.items.find((item) => item.opportunityId === "opp-a")?.reasons.join(" ")).toContain("EXECUTION_QUEUE");
    expect(result.selectedOpportunityIds.length).toBeLessThanOrEqual(PORTFOLIO_CYCLE_LIMITS.maxOpportunitiesPerCycle);
  });

  it("is idempotent for the same bounded portfolio and does not select blocked items", () => {
    const rows = [row("opp-1", "EXECUTION_READY"), row("opp-2", "BLOCKED", { isBlocked: true })];
    const portfolio = calculatePortfolioIntelligence({ opportunities: rows, now: NOW });
    const decisions = new Map(rows.map((item) => [item.opportunityId, decision(item.opportunityId, item.decision as OpportunityDecision["decision"])]));
    const first = createPortfolioOperatingController({ portfolio, rows, decisions });
    const second = createPortfolioOperatingController({ portfolio, rows, decisions });
    expect(first).toEqual(second);
    expect(first.selectedOpportunityIds).toEqual(["opp-1"]);
    expect(first.deferredOpportunityIds).toEqual(["opp-2"]);
  });

  it("defers all work when the concurrent execution limit is reached", () => {
    const rows = [row("opp-1", "EXECUTION_READY")];
    const portfolio = calculatePortfolioIntelligence({ opportunities: rows, now: NOW });
    const result = createPortfolioOperatingController({ portfolio, rows, decisions: new Map([["opp-1", decision("opp-1", "EXECUTION_READY")]]), activeExecutions: PORTFOLIO_CYCLE_LIMITS.maxConcurrentExecutions });
    expect(result.selectedOpportunityIds).toEqual([]);
    expect(result.reasons.join(" ")).toContain("Concurrent execution limit");
  });
});
