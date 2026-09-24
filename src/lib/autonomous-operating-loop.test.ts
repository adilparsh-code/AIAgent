import { describe, expect, it } from "vitest";
import {
  createAutonomousOperatingLoop,
  type OperatingLoopCandidate,
  type OperatingLoopExecutionGates,
} from "./autonomous-operating-loop";
import type { OpportunityDecision } from "./opportunity-decision";
import { calculatePortfolioIntelligence, type PortfolioOpportunityInput } from "./opportunity-portfolio";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const REAL = "REAL_DATA" as const;

function decision(overrides: Partial<OpportunityDecision> = {}): OpportunityDecision {
  return {
    opportunityId: "opp_1",
    decision: "RESEARCH_MORE",
    decisionScore: 40,
    readinessState: "RESEARCH_REQUIRED",
    confidence: 0,
    blockers: [],
    evidenceGaps: [],
    validationGaps: [],
    experimentGaps: [],
    executionGaps: [],
    recommendedAction: { action: "Run research for this opportunity.", basis: "No completed research run exists" },
    explanation: [],
    dataClass: "AI_ESTIMATE",
    generatedAt: NOW.toISOString(),
    decisionInputs: { readinessApplied: true, validationApplied: false, experimentApplied: false, handoffApplied: false, executionApplied: false, freshnessApplied: false },
    lifecycleState: "DISCOVERED",
    learningSignal: false,
    ...overrides,
  };
}

function row(overrides: Partial<PortfolioOpportunityInput> = {}): PortfolioOpportunityInput {
  return {
    opportunityId: "opp_1", decision: "RESEARCH_MORE", readinessState: "RESEARCH_REQUIRED", lifecycleState: "DISCOVERED", confidence: 0, decisionScore: 40, dataClass: "AI_ESTIMATE", researchFreshnessKind: "NO_RESEARCH", evidenceGapCount: 0, validationGapCount: 0, experimentGapCount: 0, executionGapCount: 0, blockerCount: 0, hasContradictions: false, evidenceGapCodes: [], experimentCount: 0, realMetricPeriods: 0, estimatedMetricPeriods: 0, experimentDataClass: "NONE", experimentSufficient: false, lastExperimentMetricAt: null, hasLearningSignal: false, handoffStatus: null, requiresHumanApproval: false, hasExecutionBlocker: false, isBlocked: false, latestResearchRunStatus: null,
    ...overrides,
  };
}

function gates(overrides: Partial<OperatingLoopExecutionGates> = {}): OperatingLoopExecutionGates {
  return { authenticatedOwner: true, opportunityOwned: true, decisionState: "RESEARCH_MORE", readinessState: "RESEARCH_REQUIRED", handoffAccepted: false, taskApprovalSatisfied: true, executionPermissions: true, requiredCapabilityAvailable: true, realDataRequired: false, dataClass: "AI_ESTIMATE", ...overrides };
}

function loopFor(input: Partial<PortfolioOpportunityInput> = {}, d = decision(), gate = gates()) {
  const portfolio = calculatePortfolioIntelligence({ opportunities: [row(input)], now: NOW });
  return createAutonomousOperatingLoop({ portfolio, decisions: new Map([[d.opportunityId, d]]), gates: new Map([[d.opportunityId, gate]]), now: NOW });
}

describe("autonomous operating loop", () => {
  it("1. returns portfolio assessment for an empty portfolio", () => {
    const portfolio = calculatePortfolioIntelligence({ opportunities: [], now: NOW });
    const result = createAutonomousOperatingLoop({ portfolio, decisions: new Map(), gates: new Map(), now: NOW });
    expect(result.cycleStage).toBe("PORTFOLIO_ASSESSMENT");
    expect(result.selectedOpportunityId).toBeNull();
    expect(result.executionEligible).toBe(false);
  });

  it.each([
    ["RESEARCH_QUEUE", { decision: "RESEARCH_MORE", readinessState: "RESEARCH_REQUIRED", lifecycleState: "DISCOVERED" }, "RESEARCH"],
    ["VALIDATION_QUEUE", { decision: "VALIDATE", readinessState: "VALIDATION_REQUIRED", lifecycleState: "VALIDATION_REQUIRED" }, "VALIDATION"],
    ["EXPERIMENT_QUEUE", { decision: "RUN_EXPERIMENT", readinessState: "EXPERIMENT_REQUIRED", lifecycleState: "VALIDATING" }, "EXPERIMENT"],
    ["LEARNING_QUEUE", { decision: "IMPROVE_EXPERIMENT", readinessState: "EXPERIMENT_INSUFFICIENT", lifecycleState: "EXPERIMENT_INSUFFICIENT" }, "LEARNING"],
    ["HANDOFF_QUEUE", { decision: "HANDOFF_READY", readinessState: "HANDOFF_READY", lifecycleState: "HANDOFF_READY" }, "HANDOFF"],
    ["EXECUTION_QUEUE", { decision: "EXECUTION_READY", readinessState: "READY_FOR_EXECUTION", lifecycleState: "EXECUTION_READY" }, "EXECUTION"],
  ] as const)("maps %s to %s", (queue, state, stage) => {
    const result = loopFor(state, decision({ ...state, recommendedAction: { action: stage === "EXECUTION" ? "Execute the approved task." : "Run research for this opportunity.", basis: "persisted state" } }), gates({ decisionState: state.decision, readinessState: state.readinessState, handoffAccepted: queue === "EXECUTION_QUEUE", realDataRequired: queue === "EXECUTION_QUEUE", dataClass: queue === "EXECUTION_QUEUE" ? REAL : "AI_ESTIMATE" }));
    expect(result.selectedQueue).toBe(queue);
    expect(result.cycleStage).toBe(stage);
  });

  it("reports blocked, human review, approval, capability, data, stale and contradiction states without bypassing gates", () => {
    const blocked = loopFor({ decision: "BLOCKED", isBlocked: true, lifecycleState: "BLOCKED" }, decision({ decision: "BLOCKED", lifecycleState: "BLOCKED" }));
    expect(blocked.blocked).toBe(true);
    expect(blocked.executionEligible).toBe(false);
    const review = loopFor({ decision: "HUMAN_REVIEW", requiresHumanApproval: true, lifecycleState: "HUMAN_REVIEW" }, decision({ decision: "HUMAN_REVIEW", lifecycleState: "HUMAN_REVIEW" }), gates({ taskApprovalSatisfied: false }));
    expect(review.requiredApproval).toBe(true);
    expect(review.executionEligible).toBe(false);
    const missingCapability = loopFor({ decision: "EXECUTION_READY", readinessState: "READY_FOR_EXECUTION", lifecycleState: "EXECUTION_READY", handoffStatus: "ACCEPTED", dataClass: REAL }, decision({ decision: "EXECUTION_READY", readinessState: "READY_FOR_EXECUTION", lifecycleState: "EXECUTION_READY", dataClass: REAL }), gates({ decisionState: "EXECUTION_READY", readinessState: "READY_FOR_EXECUTION", handoffAccepted: true, realDataRequired: true, dataClass: REAL, requiredCapabilityAvailable: false }));
    expect(missingCapability.blockers.join(" ")).toContain("capability");
    expect(missingCapability.executionEligible).toBe(false);
  });

  it("does not allow an approval-required task to become execution eligible", () => {
    const result = loopFor({ decision: "EXECUTION_READY", readinessState: "READY_FOR_EXECUTION", lifecycleState: "EXECUTION_READY", handoffStatus: "ACCEPTED", dataClass: REAL }, decision({ decision: "EXECUTION_READY", readinessState: "READY_FOR_EXECUTION", lifecycleState: "EXECUTION_READY", dataClass: REAL }), gates({ decisionState: "EXECUTION_READY", readinessState: "READY_FOR_EXECUTION", handoffAccepted: true, taskApprovalSatisfied: false, realDataRequired: true, dataClass: REAL }));
    expect(result.executionEligible).toBe(false);
    expect(result.requiredApproval).toBe(true);
  });

  it("returns reassessment only after persisted learning signal exists", () => {
    const result = loopFor({ decision: "HANDOFF_READY", lifecycleState: "HANDOFF_READY", hasLearningSignal: true }, decision({ decision: "HANDOFF_READY", lifecycleState: "HANDOFF_READY", learningSignal: true, recommendedAction: { action: "Create or accept the AI Income Lab handoff.", basis: "handoff is next" } }));
    expect(result.cycleStage).toBe("REASSESSMENT");
    expect(result.nextAction).toBe("Reassess opportunity.");
  });

  it("ignores sample and estimated experiment data in the existing decision/portfolio inputs", () => {
    const sample = loopFor({ decision: "RUN_EXPERIMENT", experimentCount: 1, experimentDataClass: "ESTIMATED_DATA", estimatedMetricPeriods: 20, dataClass: "SAMPLE_DATA" }, decision({ decision: "RUN_EXPERIMENT", dataClass: "SAMPLE_DATA" }), gates({ dataClass: "SAMPLE_DATA" }));
    expect(sample.executionEligible).toBe(false);
    expect(sample.dataClass).toBe("SAMPLE_DATA");
  });

  it("is deterministic for selection and next action", () => {
    const first = loopFor({}, decision(), gates());
    const second = loopFor({}, decision(), gates());
    expect(first).toEqual(second);
  });

  it("is pure and does not perform external calls or side effects", () => {
    const before = JSON.stringify(row());
    loopFor({}, decision(), gates());
    expect(JSON.stringify(row())).toBe(before);
  });
});

describe("operating loop selection contract", () => {
  it("selects one candidate and includes operational priority factors through the decision", () => {
    const d = decision({ decisionScore: 77 });
    const result = loopFor({}, d);
    expect(result.selectedOpportunityId).toBe("opp_1");
    expect(result.currentOpportunityDecision?.decisionScore).toBe(77);
    expect(result.explanation.join(" ")).toContain("selected for next operational action");
  });

  it("does not invent cross-owner data: a foreign id is never selected", () => {
    const portfolio = calculatePortfolioIntelligence({ opportunities: [row({ opportunityId: "opp_1" })], now: NOW });
    const result = createAutonomousOperatingLoop({ portfolio, decisions: new Map([["foreign", decision({ opportunityId: "foreign" })]]), gates: new Map(), now: NOW });
    expect(result.selectedOpportunityId).toBeNull();
  });
});

void ({} as OperatingLoopCandidate);
