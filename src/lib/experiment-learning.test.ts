import { describe, expect, it } from "vitest";
import {
  EXPERIMENT_INFLUENCE_CAP,
  ESTIMATED_DATA_WEIGHT,
  SUFFICIENCY_WEIGHTS,
  aggregateExperimentImpacts,
  assessExperimentSufficiency,
  buildLearningContract,
  classifyValidationContext,
  combineConfidence,
  computeExperimentRankingImpact,
  deriveLearningSignals,
  outcomeFromSignals,
  opportunityLearningSignalFromOutcome,
  mapLearningSignalToDecisionAction,
} from "./experiment-learning";
import type { SufficiencyAssessment } from "./experiment-learning";

function totals(overrides: Partial<Parameters<typeof deriveLearningSignals>[0]["totals"]> = {}) {
  return {
    impressions: null as number | null,
    clicks: null as number | null,
    visits: null as number | null,
    leads: null as number | null,
    conversions: null as number | null,
    revenue: null as number | null,
    cost: null as number | null,
    ...overrides,
  };
}

function sufficiency(level: SufficiencyAssessment["level"], overrides: Partial<SufficiencyAssessment> = {}): SufficiencyAssessment {
  return {
    level,
    basis: `${level} (test)`,
    factors: { recordCount: 7, totalImpressions: 6000, totalCost: 200, totalConversions: 9, periodCount: 7 },
    ...overrides,
  };
}

describe("Phase 18 learning vocabulary", () => {
  it("maps only observed outcomes to existing decision actions", () => {
    expect(opportunityLearningSignalFromOutcome("INSUFFICIENT")).toBe("INSUFFICIENT_DATA");
    expect(mapLearningSignalToDecisionAction("INSUFFICIENT_DATA")).toBe("RECORD_MORE_DATA");
    expect(mapLearningSignalToDecisionAction("CONTRADICTORY_SIGNAL")).toBe("REVIEW_CONFLICT");
    expect(mapLearningSignalToDecisionAction("BLOCKED")).toBe("BLOCKED");
  });
});

describe("assessExperimentSufficiency", () => {
  it("tiny experiment → INSUFFICIENT", () => {
    const result = assessExperimentSufficiency({
      recordCount: 1,
      totals: totals({ impressions: 40, cost: 5 }),
      estimatedRecordCount: 0,
    });
    expect(result.level).toBe("INSUFFICIENT");
  });

  it("only estimated records → INSUFFICIENT", () => {
    const result = assessExperimentSufficiency({
      recordCount: 5,
      totals: totals({ impressions: 9000 }),
      estimatedRecordCount: 5,
    });
    expect(result.level).toBe("INSUFFICIENT");
  });

  it("adequate impressions → MEANINGFUL_SIGNAL", () => {
    const result = assessExperimentSufficiency({
      recordCount: 3,
      totals: totals({ impressions: 800, cost: 60 }),
      estimatedRecordCount: 0,
    });
    expect(result.level).toBe("MEANINGFUL_SIGNAL");
  });

  it("strong impressions → STRONG_SIGNAL", () => {
    const result = assessExperimentSufficiency({
      recordCount: 4,
      totals: totals({ impressions: 6000, cost: 100 }),
      estimatedRecordCount: 0,
    });
    expect(result.level).toBe("STRONG_SIGNAL");
  });

  it("long experiment with real cost → STRONG_SIGNAL", () => {
    const result = assessExperimentSufficiency({
      recordCount: 9,
      totals: totals({ impressions: 600, cost: 80 }),
      estimatedRecordCount: 0,
    });
    expect(result.level).toBe("STRONG_SIGNAL");
  });

  it("missing metrics are not counted as zeros", () => {
    const result = assessExperimentSufficiency({
      recordCount: 2,
      totals: totals(), // everything missing
      estimatedRecordCount: 0,
    });
    expect(result.level).toBe("INSUFFICIENT");
  });
});

describe("deriveLearningSignals", () => {
  it("emits INSUFFICIENT_EXPERIMENT_DATA when sufficiency is insufficient", () => {
    const signals = deriveLearningSignals({
      sufficiency: sufficiency("INSUFFICIENT"),
      totals: totals(),
      derived: { ctr: null, conversionRate: null, profit: null, roi: null },
      dataClass: "REAL_DATA",
      decision: "INSUFFICIENT_DATA",
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].key).toBe("INSUFFICIENT_EXPERIMENT_DATA");
  });

  it("positive demand from good CTR, positive conversion from recorded conversions", () => {
    const signals = deriveLearningSignals({
      sufficiency: sufficiency("MEANINGFUL_SIGNAL"),
      totals: totals({ impressions: 1000, clicks: 40, conversions: 5 }),
      derived: { ctr: 0.04, conversionRate: null, profit: null, roi: null },
      dataClass: "REAL_DATA",
      decision: "ITERATE",
    });
    const keys = signals.map((s) => s.key);
    expect(keys).toContain("POSITIVE_DEMAND_SIGNAL");
    expect(keys).toContain("POSITIVE_CONVERSION_SIGNAL");
  });

  it("explicit zero conversions with traffic → NEGATIVE_CONVERSION_SIGNAL", () => {
    const signals = deriveLearningSignals({
      sufficiency: sufficiency("MEANINGFUL_SIGNAL"),
      totals: totals({ impressions: 2000, clicks: 30, conversions: 0 }),
      derived: { ctr: 0.015, conversionRate: null, profit: null, roi: null },
      dataClass: "REAL_DATA",
      decision: "STOP",
    });
    expect(signals.map((s) => s.key)).toContain("NEGATIVE_CONVERSION_SIGNAL");
  });

  it("missing conversions produce NO conversion signal (never negative-by-absence)", () => {
    const signals = deriveLearningSignals({
      sufficiency: sufficiency("MEANINGFUL_SIGNAL"),
      totals: totals({ impressions: 2000, clicks: 30 }),
      derived: { ctr: 0.015, conversionRate: null, profit: null, roi: null },
      dataClass: "REAL_DATA",
      decision: "INSUFFICIENT_DATA",
    });
    expect(signals.map((s) => s.key)).not.toContain("NEGATIVE_CONVERSION_SIGNAL");
    expect(signals.map((s) => s.key)).not.toContain("POSITIVE_CONVERSION_SIGNAL");
  });

  it("recorded revenue → monetization signal; loss → negative unit economics", () => {
    const signals = deriveLearningSignals({
      sufficiency: sufficiency("STRONG_SIGNAL"),
      totals: totals({ impressions: 6000, clicks: 120, revenue: 400, cost: 300 }),
      derived: { ctr: 0.02, conversionRate: null, profit: 100, roi: 100 / 300 },
      dataClass: "REAL_DATA",
      decision: "ITERATE",
    });
    const keys = signals.map((s) => s.key);
    expect(keys).toContain("POSITIVE_MONETIZATION_SIGNAL");
    expect(keys).toContain("POSITIVE_UNIT_ECONOMICS_SIGNAL");
  });

  it("negative unit economics on recorded loss", () => {
    const signals = deriveLearningSignals({
      sufficiency: sufficiency("MEANINGFUL_SIGNAL"),
      totals: totals({ impressions: 1000, revenue: 20, cost: 200 }),
      derived: { ctr: null, conversionRate: null, profit: -180, roi: -0.9 },
      dataClass: "REAL_DATA",
      decision: "STOP",
    });
    expect(signals.map((s) => s.key)).toContain("NEGATIVE_UNIT_ECONOMICS_SIGNAL");
  });
});

describe("computeExperimentRankingImpact (bounded, explainable)", () => {
  const positiveSignals = [
    { key: "POSITIVE_CONVERSION_SIGNAL" as const, basis: "5 conversions", dataClass: "REAL_DATA" as const, evidence: [] },
  ];

  it("one small experiment cannot dominate: influence is capped", () => {
    const impact = computeExperimentRankingImpact({
      contract: {} as Parameters<typeof computeExperimentRankingImpact>[0]["contract"],
      totals: totals({ conversions: 5 }),
      derived: { ctr: null, conversionRate: null, profit: 50, roi: 1 },
      sufficiency: sufficiency("STRONG_SIGNAL"),
      signals: positiveSignals,
      dataClass: "REAL_DATA",
      researchConclusion: null,
    });
    expect(impact.delta).toBeGreaterThan(0);
    expect(impact.delta).toBeLessThanOrEqual(EXPERIMENT_INFLUENCE_CAP);
  });

  it("estimated data weighs far less than real data", () => {
    const real = computeExperimentRankingImpact({
      contract: {} as Parameters<typeof computeExperimentRankingImpact>[0]["contract"],
      totals: totals({ conversions: 5 }),
      derived: { ctr: null, conversionRate: null, profit: 50, roi: 1 },
      sufficiency: sufficiency("STRONG_SIGNAL"),
      signals: positiveSignals,
      dataClass: "REAL_DATA",
      researchConclusion: null,
    });
    const estimated = computeExperimentRankingImpact({
      contract: {} as Parameters<typeof computeExperimentRankingImpact>[0]["contract"],
      totals: totals({ conversions: 5 }),
      derived: { ctr: null, conversionRate: null, profit: 50, roi: 1 },
      sufficiency: sufficiency("STRONG_SIGNAL"),
      signals: positiveSignals,
      dataClass: "ESTIMATED_DATA",
      researchConclusion: null,
    });
    expect(estimated.delta).toBeCloseTo(real.delta * ESTIMATED_DATA_WEIGHT, 1);
    expect(estimated.confidence).toBeLessThan(real.confidence);
  });

  it("INSUFFICIENT experiments move nothing", () => {
    const impact = computeExperimentRankingImpact({
      contract: {} as Parameters<typeof computeExperimentRankingImpact>[0]["contract"],
      totals: totals(),
      derived: { ctr: null, conversionRate: null, profit: null, roi: null },
      sufficiency: sufficiency("INSUFFICIENT"),
      signals: [{ key: "INSUFFICIENT_EXPERIMENT_DATA", basis: "none", dataClass: "REAL_DATA", evidence: [] }],
      dataClass: "REAL_DATA",
      researchConclusion: null,
    });
    expect(impact.delta).toBe(0);
  });

  it("experiment contradicting positive research is flagged, not hidden", () => {
    const impact = computeExperimentRankingImpact({
      contract: {} as Parameters<typeof computeExperimentRankingImpact>[0]["contract"],
      totals: totals({ impressions: 6000, clicks: 20, conversions: 0 }),
      derived: { ctr: 20 / 6000, conversionRate: null, profit: null, roi: null },
      sufficiency: sufficiency("STRONG_SIGNAL"),
      signals: [{ key: "NEGATIVE_CONVERSION_SIGNAL", basis: "0 conversions", dataClass: "REAL_DATA", evidence: [] }],
      dataClass: "REAL_DATA",
      researchConclusion: "VALIDATED",
    });
    expect(impact.contradiction).toBe("EXPERIMENT_CONTRADICTS_RESEARCH");
    expect(impact.explanation.join(" ")).toContain("contradicts");
  });

  it("mixed signals within one experiment → MIXED_EXPERIMENT_EVIDENCE", () => {
    const impact = computeExperimentRankingImpact({
      contract: {} as Parameters<typeof computeExperimentRankingImpact>[0]["contract"],
      totals: totals({ impressions: 6000, clicks: 150, conversions: 6, revenue: 200, cost: 500 }),
      derived: { ctr: 0.025, conversionRate: null, profit: -300, roi: null },
      sufficiency: sufficiency("STRONG_SIGNAL"),
      signals: [
        { key: "POSITIVE_DEMAND_SIGNAL", basis: "ctr", dataClass: "REAL_DATA", evidence: [] },
        { key: "NEGATIVE_UNIT_ECONOMICS_SIGNAL", basis: "loss", dataClass: "REAL_DATA", evidence: [] },
      ],
      dataClass: "REAL_DATA",
      researchConclusion: null,
    });
    expect(impact.contradiction).toBe("MIXED_EXPERIMENT_EVIDENCE");
  });
});

describe("aggregateExperimentImpacts (multi-experiment)", () => {
  function adjustment(delta: number, contradiction: "NONE" | "MIXED_EXPERIMENT_EVIDENCE" | "EXPERIMENT_CONTRADICTS_RESEARCH" = "NONE"): Parameters<typeof aggregateExperimentImpacts>[0][number] {
    return {
      delta,
      explanation: [`delta ${delta}`],
      signals: [],
      sufficiency: sufficiency("STRONG_SIGNAL"),
      evidenceQuality: "REAL_DATA",
      contradiction,
      confidence: 0.8,
    };
  }

  it("sums multiple positives and stays within the cap", () => {
    const result = aggregateExperimentImpacts([adjustment(8), adjustment(6)]);
    expect(result.delta).toBe(EXPERIMENT_INFLUENCE_CAP); // 14 capped
    expect(result.explanation.join(" ")).toContain("capped");
    expect(result.experimentCount).toBe(2);
  });

  it("mixed experiments stay visible as MIXED_EXPERIMENT_EVIDENCE", () => {
    const result = aggregateExperimentImpacts([adjustment(8), adjustment(-8)]);
    expect(result.contradiction).toBe("MIXED_EXPERIMENT_EVIDENCE");
    expect(result.delta).toBe(0);
    expect(result.explanation.join(" ")).toContain("neither is treated as market truth");
  });

  it("negative-only experiments produce a negative bounded delta", () => {
    const result = aggregateExperimentImpacts([adjustment(-6), adjustment(-6)]);
    expect(result.delta).toBe(-EXPERIMENT_INFLUENCE_CAP);
    expect(result.completedCount).toBe(2);
  });

  it("no experiments → zero impact, honest explanation", () => {
    const result = aggregateExperimentImpacts([]);
    expect(result.delta).toBe(0);
    expect(result.experimentConfidence).toBe(0);
  });
});

describe("classifyValidationContext", () => {
  it("maps research/experiment combinations correctly", () => {
    expect(classifyValidationContext({ researchConclusion: "VALIDATED", experimentDelta: 5, experimentCount: 1 })).toBe("BOTH_SUPPORTED");
    expect(classifyValidationContext({ researchConclusion: "VALIDATED", experimentDelta: -5, experimentCount: 1 })).toBe("CONTRADICTED");
    expect(classifyValidationContext({ researchConclusion: "REJECTED", experimentDelta: 5, experimentCount: 1 })).toBe("EXPERIMENT_SUPPORTED");
    expect(classifyValidationContext({ researchConclusion: "PROMISING", experimentDelta: 0, experimentCount: 0 })).toBe("RESEARCH_SUPPORTED");
    expect(classifyValidationContext({ researchConclusion: null, experimentDelta: -3, experimentCount: 1 })).toBe("EXPERIMENT_SUPPORTED");
    expect(classifyValidationContext({ researchConclusion: null, experimentDelta: 0, experimentCount: 0 })).toBe("INSUFFICIENT");
  });
});

describe("combineConfidence (score ≠ confidence)", () => {
  it("keeps them separate: experiments raise confidence but never define the score", () => {
    const researchOnly = combineConfidence({ researchConfidence: 0.5, experimentConfidence: 0, experimentCount: 0 });
    const withExperiment = combineConfidence({ researchConfidence: 0.5, experimentConfidence: 0.9, experimentCount: 1 });
    expect(researchOnly).toBe(0.5);
    expect(withExperiment).toBeGreaterThan(researchOnly);
    expect(withExperiment).toBeLessThanOrEqual(1);
  });

  it("confidence has a research floor — one experiment cannot erase research uncertainty", () => {
    const result = combineConfidence({ researchConfidence: 0.2, experimentConfidence: 1, experimentCount: 1 });
    expect(result).toBeGreaterThanOrEqual(0.2 * 0.8);
  });

  it("works with 0-100 style research confidence input", () => {
    expect(combineConfidence({ researchConfidence: 75, experimentConfidence: 0, experimentCount: 0 })).toBe(0.75);
  });
});

describe("buildLearningContract + outcomeFromSignals", () => {
  it("builds a versioned contract with evidence split from inference", () => {
    const signals = [
      { key: "POSITIVE_CONVERSION_SIGNAL" as const, basis: "b", dataClass: "REAL_DATA" as const, evidence: ["5 conversions"] },
      { key: "NEGATIVE_MONETIZATION_SIGNAL" as const, basis: "b", dataClass: "REAL_DATA" as const, evidence: ["0 revenue"] },
    ];
    expect(outcomeFromSignals(signals)).toBe("MIXED");
    const contract = buildLearningContract({
      opportunityId: "opp-1",
      experimentId: "exp-1",
      measurementPeriod: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-07T00:00:00.000Z" },
      totals: totals({ conversions: 5, revenue: 0 }),
      derived: { ctr: null, conversionRate: null, profit: -50, roi: null },
      sufficiency: sufficiency("MEANINGFUL_SIGNAL"),
      signals,
      dataClass: "REAL_DATA",
      decision: "STOP",
      researchImplications: ["test"],
      rankingImpact: { eligible: true, reason: "test", maxContribution: 10 },
      generatedAt: "2026-09-08T00:00:00.000Z",
    });
    expect(contract.feedbackVersion).toBe(2);
    expect(contract.outcome).toBe("MIXED");
    expect(contract.experimentEvidence.metrics.conversions).toBe(5); // raw recorded
    expect(contract.experimentEvidence.derived.profit).toBe(-50); // calculated
    expect(contract.learningSignals.length).toBe(2);
    expect(contract.confidence).toBeGreaterThan(0);
  });
});

describe("sufficiency weights are monotonic and bounded", () => {
  it("INSUFFICIENT < LOW < MEANINGFUL < STRONG, all within the cap", () => {
    expect(SUFFICIENCY_WEIGHTS.INSUFFICIENT).toBe(0);
    expect(SUFFICIENCY_WEIGHTS.LOW_SIGNAL).toBeLessThan(SUFFICIENCY_WEIGHTS.MEANINGFUL_SIGNAL);
    expect(SUFFICIENCY_WEIGHTS.MEANINGFUL_SIGNAL).toBeLessThan(SUFFICIENCY_WEIGHTS.STRONG_SIGNAL);
    expect(SUFFICIENCY_WEIGHTS.STRONG_SIGNAL * EXPERIMENT_INFLUENCE_CAP).toBeLessThanOrEqual(EXPERIMENT_INFLUENCE_CAP);
  });
});
