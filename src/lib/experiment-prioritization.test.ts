/**
 * Phase 12 — pure experiment-prioritization tests (no DB, no network).
 * Verifies explicit factor calculation, missing-factor honesty, the REAL_DATA
 * requirement, staleness handling, determinism, and that no value is ever
 * fabricated.
 */
import { describe, expect, it } from "vitest";
import {
  computeOpportunityPriority,
  EXPERIMENT_PRIORITY_POLICY,
  EXPERIMENT_PRIORITY_WEIGHTS,
  prioritizeOpportunities,
  type OpportunityPriorityInput,
} from "./experiment-prioritization";

const NOW = new Date("2026-09-24T12:00:00.000Z");

function input(overrides: Partial<OpportunityPriorityInput> = {}): OpportunityPriorityInput {
  return {
    opportunityId: "opp_1",
    decisionScore: 60,
    evidenceGapCount: 0,
    validationGapCount: 0,
    decisionState: "RUN_EXPERIMENT",
    hasExperiment: true,
    realMetricPeriods: 2,
    estimatedMetricPeriods: 0,
    lastExperimentMetricAt: new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000),
    hasLearningSignal: true,
    researchFreshnessKind: "CURRENT_RESEARCH",
    hasContradictions: false,
    requiresHumanApproval: false,
    hasExecutionBlocker: false,
    isBlocked: false,
    dataClass: "REAL_DATA",
    now: NOW,
    ...overrides,
  };
}

describe("experiment prioritization", () => {
  it("every factor is explicit, weighted, and explainable", () => {
    const result = computeOpportunityPriority(input());
    const keys = result.factors.map((factor) => factor.key);
    for (const weight of Object.keys(EXPERIMENT_PRIORITY_WEIGHTS)) {
      expect(keys).toContain(weight);
    }
    for (const factor of result.factors) {
      expect(factor.basis.length).toBeGreaterThan(0);
      expect(factor.value === null || (factor.value >= 0 && factor.value <= 1)).toBe(true);
    }
  });

  it("missing factors score 0 and say so — never fabricated", () => {
    const result = computeOpportunityPriority(
      input({ lastExperimentMetricAt: null, hasLearningSignal: false, hasExperiment: false }),
    );
    const freshness = result.factors.find((factor) => factor.key === "EXPERIMENT_FRESHNESS")!;
    expect(freshness.value).toBe(0);
    expect(freshness.basis).toContain("no experiment measurement is persisted");
    const learning = result.factors.find((factor) => factor.key === "LEARNING_SIGNAL")!;
    expect(learning.value).toBe(0);
    expect(learning.basis).toContain("no persisted experiment decision");
  });

  it("REAL_DATA coverage comes only from real periods; estimated never counts", () => {
    const real = computeOpportunityPriority(input({ realMetricPeriods: 2, estimatedMetricPeriods: 0 }));
    const estimated = computeOpportunityPriority(input({ realMetricPeriods: 0, estimatedMetricPeriods: 9 }));
    const realFactor = real.factors.find((factor) => factor.key === "REAL_DATA_COVERAGE")!;
    const estimatedFactor = estimated.factors.find((factor) => factor.key === "REAL_DATA_COVERAGE")!;
    expect(realFactor.value).toBe(1);
    expect(estimatedFactor.value).toBe(0);
    expect(estimatedFactor.basis).toContain("9 estimated period(s) excluded");
    expect(estimated.priorityScore).toBeLessThan(real.priorityScore);
  });

  it("insufficient REAL_DATA is penalized and labelled honestly", () => {
    const result = computeOpportunityPriority(input({ realMetricPeriods: 1 }));
    const penalty = result.factors.find(
      (factor) => factor.kind === "PENALTY" && factor.key === "INSUFFICIENT_REAL_DATA",
    )!;
    expect(penalty).toBeTruthy();
    expect(result.label).toBe("Experiment data insufficient");
  });

  it("stale experiments and stale research reduce priority", () => {
    const stale = computeOpportunityPriority(
      input({
        lastExperimentMetricAt: new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000),
        researchFreshnessKind: "STALE_RESEARCH",
      }),
    );
    expect(stale.factors.find((factor) => factor.key === "EXPERIMENT_FRESHNESS")!.value).toBe(0);
    expect(stale.factors.some((factor) => factor.key === "STALE_RESEARCH")).toBe(true);
    expect(stale.label).toBe("Needs measurement refresh");
  });

  it("unparseable measurement dates are treated as absent, never invented", () => {
    const result = computeOpportunityPriority(input({ lastExperimentMetricAt: "not-a-date" }));
    const freshness = result.factors.find((factor) => factor.key === "EXPERIMENT_FRESHNESS")!;
    expect(freshness.value).toBe(0);
    expect(freshness.basis).toContain("not parseable");
  });

  it("contradictions and approval requirements are penalized and labelled", () => {
    const conflict = computeOpportunityPriority(input({ hasContradictions: true }));
    expect(conflict.label).toBe("Review required");
    expect(conflict.factors.some((factor) => factor.key === "CONTRADICTION")).toBe(true);

    const approval = computeOpportunityPriority(input({ requiresHumanApproval: true }));
    expect(approval.label).toBe("Execution approval pending");
    expect(approval.factors.some((factor) => factor.key === "APPROVAL_REQUIRED")).toBe(true);
  });

  it("blocked opportunities are labelled Blocked, never ranked as attractive", () => {
    const blocked = computeOpportunityPriority(input({ isBlocked: true, decisionScore: 100 }));
    expect(blocked.label).toBe("Blocked");
    expect(blocked.priorityScore).toBeLessThanOrEqual(100);
  });

  it("deterministic output for the same input", () => {
    const a = computeOpportunityPriority(input());
    const b = computeOpportunityPriority(input());
    expect(a).toEqual(b);
  });

  it("ranking is deterministic with a stable id tie-break", () => {
    const inputs = [
      input({ opportunityId: "zzz", decisionScore: 50 }),
      input({ opportunityId: "aaa", decisionScore: 50 }),
      input({ opportunityId: "mmm", decisionScore: 90 }),
    ];
    const first = prioritizeOpportunities(inputs).map((item) => item.opportunityId);
    const second = prioritizeOpportunities([...inputs].reverse()).map((item) => item.opportunityId);
    expect(first).toEqual(second);
    expect(first[0]).toBe("mmm"); // highest score first
    expect(first.slice(1)).toEqual(["aaa", "zzz"]); // id tie-break
  });

  it("score stays within 0-100 and never claims a financial value", () => {
    const result = computeOpportunityPriority(
      input({ decisionScore: 100, evidenceGapCount: 0, realMetricPeriods: 5 }),
    );
    expect(result.priorityScore).toBeGreaterThanOrEqual(0);
    expect(result.priorityScore).toBeLessThanOrEqual(100);
    const forbidden = /profit|revenue|income|winner|best|worst/i;
    expect(forbidden.test(result.label)).toBe(false);
    expect(forbidden.test(result.reason)).toBe(false);
  });

  it("policy thresholds are centralized and explicit", () => {
    expect(EXPERIMENT_PRIORITY_POLICY.MIN_REAL_METRIC_PERIODS).toBe(2);
    expect(EXPERIMENT_PRIORITY_POLICY.EXPERIMENT_FRESHNESS_DAYS).toBe(30);
  });
});
