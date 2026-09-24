/**
 * Phase 11 — pure decision-engine tests (no DB, no network).
 * Covers the required decision rules, data-class honesty rules, determinism,
 * and the exactly-one-next-action contract.
 */
import { describe, expect, it } from "vitest";
import {
  calculateOpportunityDecision,
  DECISION_POLICY,
  type CalculateOpportunityDecisionInput,
} from "./opportunity-decision";
import { recommendNextAction } from "./opportunity-next-action";
import { positionResearchCycle } from "./research-cycle";
import { deriveOpportunityLifecycle } from "./opportunity-lifecycle";

const NOW = new Date("2026-09-24T12:00:00.000Z");

function baseInput(overrides: Partial<CalculateOpportunityDecisionInput> = {}): CalculateOpportunityDecisionInput {
  return {
    opportunity: {
      id: "opp_test",
      status: "VALIDATED",
      halalStatus: "HALAL",
      isSample: false,
      handoffStatus: null,
      risksCount: 1,
    },
    researchRuns: [],
    validation: null,
    experiments: [],
    execution: {
      handoffStatus: null,
      hasRunningAgentTask: false,
      hasAwaitingApprovalTask: false,
      hasBlockedTask: false,
      hasCompletedExecution: false,
    },
    now: NOW,
    ...overrides,
  };
}

// All five signals SUPPORTED: the readiness engine counts any MIXED signal
// as an unresolved contradiction (documented Phase 10 behavior), so a clean
// "everything adequate" fixture needs every signal supported.
const goodValidation = {
  demandStatus: "SUPPORTED",
  painPointStatus: "SUPPORTED",
  commercialIntentStatus: "SUPPORTED",
  trendStatus: "SUPPORTED",
  competitionStatus: "SUPPORTED",
  evidenceCoverage: 0.9,
  sourceDiversity: 3,
  contradictionCount: 0,
  confidence: 0.85,
};

const freshRun = {
  id: "run_1",
  status: "COMPLETED",
  startedAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000),
  completedAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000),
  evidenceCount: 12,
  confidence: 0.85,
};

function realExperiment(metrics: number, dataClass = "REAL_DATA") {
  return {
    id: "exp_1",
    status: "COMPLETED",
    decision: "WIN",
    metrics: Array.from({ length: metrics }, (_, index) => ({
      dataClass,
      conversions: 5,
      revenue: 50,
      cost: 10,
      index,
    })),
  } as never;
}

describe("opportunity decision — deterministic rules", () => {
  it("1. no research → RESEARCH_MORE", () => {
    const result = calculateOpportunityDecision(baseInput());
    expect(result.decision).toBe("RESEARCH_MORE");
    expect(result.lifecycleState).toBe("DISCOVERED");
  });

  it("2. insufficient evidence → RESEARCH_MORE", () => {
    const result = calculateOpportunityDecision(
      baseInput({
        researchRuns: [freshRun],
        validation: { ...goodValidation, demandStatus: "INSUFFICIENT", commercialIntentStatus: "INSUFFICIENT", evidenceCoverage: 0.2, sourceDiversity: 1 },
      }),
    );
    expect(result.decision).toBe("RESEARCH_MORE");
    expect(result.evidenceGaps.length).toBeGreaterThan(0);
  });

  it("3. contradictory evidence → REVIEW_CONFLICT", () => {
    const result = calculateOpportunityDecision(
      baseInput({
        researchRuns: [freshRun],
        validation: { ...goodValidation, commercialIntentStatus: "MIXED", contradictionCount: 2 },
      }),
    );
    expect(result.decision).toBe("REVIEW_CONFLICT");
    expect(result.recommendedAction.action).toBe("Review contradictory evidence.");
  });

  it("4. stale research → VALIDATE with freshness blocker (no fabricated refresh)", () => {
    const staleRun = {
      ...freshRun,
      startedAt: new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000),
      completedAt: new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000),
    };
    const result = calculateOpportunityDecision(
      baseInput({ researchRuns: [staleRun], validation: goodValidation }),
    );
    expect(result.decision).toBe("VALIDATE");
    expect(result.blockers.join(" ")).toContain("40 days old");
    expect(result.recommendedAction.action).toBe("Refresh stale research.");
  });

  it("5. adequate research, validation missing → VALIDATE", () => {
    const result = calculateOpportunityDecision(
      baseInput({ researchRuns: [freshRun], validation: null }),
    );
    expect(result.decision).toBe("VALIDATE");
    expect(result.validationGaps.map((gap) => gap.code)).toContain("VALIDATION_MISSING");
  });

  it("6. validation incomplete (unsupported signal) → RESEARCH_MORE", () => {
    const result = calculateOpportunityDecision(
      baseInput({
        researchRuns: [freshRun],
        validation: { ...goodValidation, painPointStatus: "INSUFFICIENT" },
      }),
    );
    expect(result.decision).toBe("RESEARCH_MORE");
  });

  it("7. validated, no REAL_DATA, no experiment → RUN_EXPERIMENT", () => {
    const result = calculateOpportunityDecision(
      baseInput({ researchRuns: [freshRun], validation: goodValidation }),
    );
    expect(result.decision).toBe("RUN_EXPERIMENT");
    expect(result.recommendedAction.action).toBe("Create a validation experiment.");
  });

  it("8. experiment with insufficient REAL_DATA → RUN_EXPERIMENT", () => {
    const result = calculateOpportunityDecision(
      baseInput({
        researchRuns: [freshRun],
        validation: goodValidation,
        experiments: [realExperiment(1)],
      }),
    );
    expect(result.decision).toBe("RUN_EXPERIMENT");
    expect(result.experimentGaps.some((gap) => gap.code === "REAL_DATA_INSUFFICIENT")).toBe(true);
  });

  it("9. experiment REAL_DATA conflicts with research (zero conversions) → REVIEW_CONFLICT", () => {
    const experiment = {
      id: "exp_1",
      status: "COMPLETED",
      decision: "KILL",
      metrics: Array.from({ length: DECISION_POLICY.MIN_REAL_METRIC_PERIODS_FOR_CONTRADICTION }, () => ({
        dataClass: "REAL_DATA",
        conversions: 0,
        revenue: 0,
        cost: 10,
      })),
    } as never;
    const result = calculateOpportunityDecision(
      baseInput({
        researchRuns: [freshRun],
        validation: goodValidation,
        experiments: [experiment],
      }),
    );
    expect(result.decision).toBe("REVIEW_CONFLICT");
  });

  it("10. sufficient REAL_DATA + accepted handoff satisfied → EXECUTION_READY (rule I)", () => {
    const result = calculateOpportunityDecision(
      baseInput({
        researchRuns: [freshRun],
        validation: goodValidation,
        experiments: [realExperiment(2)],
        opportunity: { ...baseInput().opportunity, handoffStatus: "ACCEPTED" },
        execution: {
          handoffStatus: "ACCEPTED",
          hasRunningAgentTask: false,
          hasAwaitingApprovalTask: false,
          hasBlockedTask: false,
          hasCompletedExecution: false,
        },
      }),
    );
    expect(result.decision).toBe("EXECUTION_READY");
  });

  it("11. validated + experiment sufficient + handoff not yet accepted → HANDOFF_READY (rule H)", () => {
    const result = calculateOpportunityDecision(
      baseInput({
        researchRuns: [freshRun],
        validation: goodValidation,
        experiments: [realExperiment(2)],
        opportunity: { ...baseInput().opportunity, handoffStatus: "HANDOFF_READY" },
        execution: {
          handoffStatus: "HANDOFF_READY",
          hasRunningAgentTask: false,
          hasAwaitingApprovalTask: false,
          hasBlockedTask: false,
          hasCompletedExecution: false,
        },
      }),
    );
    expect(result.decision).toBe("HANDOFF_READY");
    expect(result.executionGaps.map((gap) => gap.code)).toContain("HANDOFF_NOT_ACCEPTED");
  });

  it("12. WAITING_APPROVAL task → HUMAN_REVIEW (rule J)", () => {
    const result = calculateOpportunityDecision(
      baseInput({
        researchRuns: [freshRun],
        validation: goodValidation,
        experiments: [realExperiment(2)],
        execution: {
          handoffStatus: "ACCEPTED",
          hasRunningAgentTask: false,
          hasAwaitingApprovalTask: true,
          hasBlockedTask: false,
          hasCompletedExecution: false,
        },
      }),
    );
    expect(result.decision).toBe("HUMAN_REVIEW");
    expect(result.executionGaps.map((gap) => gap.code)).toContain("APPROVAL_REQUIRED");
  });

  it("13. REJECTED opportunity → BLOCKED (rule K)", () => {
    const result = calculateOpportunityDecision(
      baseInput({
        opportunity: { ...baseInput().opportunity, status: "REJECTED" },
        researchRuns: [freshRun],
        validation: goodValidation,
        experiments: [realExperiment(2)],
      }),
    );
    expect(result.decision).toBe("BLOCKED");
  });

  it("15. SAMPLE data never treated as REAL_DATA", () => {
    const result = calculateOpportunityDecision(
      baseInput({
        researchRuns: [freshRun],
        validation: goodValidation,
        experiments: [realExperiment(5, "SAMPLE_DATA")],
      }),
    );
    // SAMPLE_DATA metrics are ignored entirely: the experiment side still has
    // no usable data (RUN_EXPERIMENT) even though validation is real.
    expect(result.decision).toBe("RUN_EXPERIMENT");
    expect(result.experimentGaps.some((gap) => gap.code === "REAL_DATA_INSUFFICIENT" || gap.code === "ESTIMATED_ONLY")).toBe(true);
  });

  it("16. ESTIMATED data never treated as REAL_DATA (rule F → IMPROVE_EXPERIMENT)", () => {
    const result = calculateOpportunityDecision(
      baseInput({
        researchRuns: [freshRun],
        validation: goodValidation,
        experiments: [realExperiment(5, "ESTIMATED_DATA")],
      }),
    );
    // Estimated-dominated experiment data cannot justify a NEW experiment;
    // the fix is better measurement of the existing one.
    expect(result.decision).toBe("IMPROVE_EXPERIMENT");
    expect(result.experimentGaps.some((gap) => gap.code === "ESTIMATED_ONLY")).toBe(true);
    expect(result.recommendedAction.action).toBe("Improve experiment measurement.");
  });

  it("17. deterministic same-input/same-output", () => {
    const input = baseInput({
      researchRuns: [freshRun],
      validation: goodValidation,
      experiments: [realExperiment(2)],
    });
    const a = calculateOpportunityDecision(input);
    const b = calculateOpportunityDecision(input);
    expect(a).toEqual(b);
  });

  it("18. next action always exactly one action", () => {
    for (const decision of [
      "RESEARCH_MORE",
      "VALIDATE",
      "RUN_EXPERIMENT",
      "IMPROVE_EXPERIMENT",
      "REVIEW_CONFLICT",
      "HANDOFF_READY",
      "EXECUTION_READY",
      "HUMAN_REVIEW",
      "BLOCKED",
    ] as const) {
      const recommendation = recommendNextAction(decision, {});
      expect(typeof recommendation.action).toBe("string");
      expect(recommendation.action.length).toBeGreaterThan(0);
      expect(typeof recommendation.basis).toBe("string");
    }
  });

  it("empty datasets + null-safe optional fields degrade safely", () => {
    const result = calculateOpportunityDecision(
      baseInput({
        opportunity: {
          id: "",
          status: "",
          halalStatus: "",
          isSample: false,
          handoffStatus: null,
          risksCount: 0,
        },
        researchRuns: [{ ...freshRun, status: "WEIRD_STATUS" }],
        validation: null,
        experiments: [],
      }),
    );
    expect(result.decision).toBe("RESEARCH_MORE");
  });
});

describe("next-action planner (unit)", () => {
  it("maps each evidence area to a distinct collection action", () => {
    expect(recommendNextAction("RESEARCH_MORE", { evidenceAreas: new Set(["DEMAND"]) }).action).toBe(
      "Collect additional demand evidence.",
    );
    expect(recommendNextAction("RESEARCH_MORE", { evidenceAreas: new Set(["SOURCE_DIVERSITY"]) }).action).toBe(
      "Collect evidence from additional distinct sources.",
    );
    expect(recommendNextAction("RESEARCH_MORE", { evidenceAreas: new Set(["EXPERIMENT_DATA"]) }).action).toBe(
      "Collect additional REAL_DATA.",
    );
  });

  it("is exactly one action for every decision with partial gaps", () => {
    const result = recommendNextAction("IMPROVE_EXPERIMENT", { estimatedMetricPeriods: 3 });
    expect(result.action).toBe("Improve experiment measurement.");
    expect(result.basis).toContain("estimated");
  });
});

describe("research cycle positioning", () => {
  it("empty/null run → DISCOVER", () => {
    expect(positionResearchCycle(null).currentStage).toBe("DISCOVER");
  });

  it("running run → COLLECT", () => {
    expect(positionResearchCycle({ id: "r1", status: "RUNNING", evidenceCount: 0 }).currentStage).toBe("COLLECT");
  });

  it("completed run with evidence and validation reaches ASSESS/UPDATE", () => {
    const position = positionResearchCycle(
      { id: "r1", status: "COMPLETED", evidenceCount: 8, sourceDiversity: 3, validationConclusion: "VALIDATED" },
      { intelligenceUpdatedAt: NOW },
    );
    expect(position.cycleComplete).toBe(true);
    expect(position.currentStage).toBe("REASSESS_READINESS");
  });
});

describe("lifecycle derivation", () => {
  it("maps decisions to lifecycle states", () => {
    expect(
      deriveOpportunityLifecycle({
        decision: "RUN_EXPERIMENT",
        readinessState: "EXPERIMENT_REQUIRED",
        researchFreshnessKind: "CURRENT_RESEARCH",
        experimentCount: 0,
        realMetricPeriods: 0,
        execution: { hasRunningAgentTask: false, hasCompletedExecution: false },
      }),
    ).toBe("VALIDATING");
    expect(
      deriveOpportunityLifecycle({
        decision: "EXECUTION_READY",
        readinessState: "READY_FOR_EXECUTION",
        researchFreshnessKind: "CURRENT_RESEARCH",
        experimentCount: 1,
        realMetricPeriods: 2,
        execution: { hasRunningAgentTask: false, hasCompletedExecution: true },
      }),
    ).toBe("MEASURING");
  });
});
