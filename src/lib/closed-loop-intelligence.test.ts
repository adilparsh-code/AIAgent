import { describe, expect, it } from "vitest";
import { assessClosedLoop, type ClosedLoopRankingView } from "./closed-loop-intelligence";
import type { ExperimentLearningContract } from "./experiment-learning";

const learning: ExperimentLearningContract = {
  feedbackVersion: 2,
  opportunityId: "opp-1",
  experimentId: "exp-1",
  experimentEvidence: {
    dataClass: "REAL_DATA",
    measurementPeriod: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" },
    metrics: { impressions: 1000, clicks: 80, visits: 60, leads: 8, conversions: 4, revenue: 100, cost: 20 },
    derived: { profit: 80, roi: 4, ctr: 0.08, conversionRate: 0.06 },
  },
  outcome: "POSITIVE",
  decision: "WIN",
  learningSignals: [{ key: "POSITIVE_CONVERSION_SIGNAL", basis: "Recorded conversions", dataClass: "REAL_DATA", evidence: ["metric-1"] }],
  researchImplications: [],
  confidence: 0.6,
  rankingImpact: { eligible: true, reason: "recorded evidence", maxContribution: 10 },
  generatedAt: "2026-01-03T00:00:00.000Z",
};

const ranking: ClosedLoopRankingView = {
  experimentDelta: 6,
  newScore: 76,
  previousScore: 70,
  changed: true,
  contradiction: "NONE",
  validationContext: "EXPERIMENT_SUPPORTED",
  explanation: ["bounded experiment adjustment"],
};

describe("Phase 22 closed-loop intelligence", () => {
  it("composes measurement, learning, reassessment, and prioritization", () => {
    const result = assessClosedLoop({ learning, ranking });
    expect(result.measurementState).toBe("MEASURED_REAL_DATA");
    expect(result.learningState).toBe("LEARNED");
    expect(result.reassessmentState).toBe("REASSESSED");
    expect(result.prioritizationChanged).toBe(true);
    expect(result.explanation.join(" ")).toContain("bounded experiment delta");
  });

  it("does not infer learning or prioritization from insufficient data", () => {
    const result = assessClosedLoop({
      learning: { ...learning, outcome: "INSUFFICIENT", decision: "INSUFFICIENT_DATA", confidence: 0, learningSignals: [{ key: "INSUFFICIENT_EXPERIMENT_DATA", basis: "No metrics", dataClass: "ESTIMATED_DATA", evidence: [] }], experimentEvidence: { ...learning.experimentEvidence, dataClass: "ESTIMATED_DATA" } },
      ranking: { ...ranking, experimentDelta: 0, newScore: 70, previousScore: 70, changed: false, explanation: ["No recorded experiment evidence; ranking unchanged."] },
    });
    expect(result.measurementState).toBe("MEASURED_ESTIMATED_DATA");
    expect(result.learningState).toBe("INSUFFICIENT_DATA");
    expect(result.reassessmentState).toBe("NO_CHANGE");
    expect(result.prioritizationChanged).toBe(false);
  });

  it("labels an empty metric series NOT_MEASURED even when the legacy contract defaults REAL_DATA", () => {
    const result = assessClosedLoop({
      learning: { ...learning, outcome: "INSUFFICIENT", decision: "INSUFFICIENT_DATA", confidence: 0, learningSignals: [{ key: "INSUFFICIENT_EXPERIMENT_DATA", basis: "No metrics", dataClass: "ESTIMATED_DATA", evidence: [] }], experimentEvidence: { ...learning.experimentEvidence, dataClass: "REAL_DATA", metrics: { impressions: null, clicks: null, visits: null, leads: null, conversions: null, revenue: null, cost: null } } },
      ranking: { ...ranking, experimentDelta: 0, newScore: 0, previousScore: 0, changed: false },
    });
    expect(result.measurementState).toBe("NOT_MEASURED");
    expect(result.learningState).toBe("INSUFFICIENT_DATA");
  });

  it("surfaces contradictory learning rather than averaging it away", () => {
    const result = assessClosedLoop({
      learning: { ...learning, outcome: "MIXED", learningSignals: [
        { key: "POSITIVE_DEMAND_SIGNAL", basis: "recorded demand", dataClass: "REAL_DATA", evidence: ["metric-1"] },
        { key: "NEGATIVE_MONETIZATION_SIGNAL", basis: "recorded monetization", dataClass: "REAL_DATA", evidence: ["metric-2"] },
      ] },
      ranking: { ...ranking, contradiction: "MIXED_EXPERIMENT_EVIDENCE" },
    });
    expect(result.learningState).toBe("CONTRADICTORY");
    expect(result.contradiction).toBe("MIXED_EXPERIMENT_EVIDENCE");
  });
});
