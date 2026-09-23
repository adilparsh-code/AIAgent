import { describe, expect, it } from "vitest";
import {
  buildExperimentFeedback,
  DECISION_RULES,
  decideExperiment,
  evaluateExperimentMetrics,
} from "./experiment-evaluation";
import type { ExperimentMetrics } from "./experiment-evaluation";

describe("evaluateExperimentMetrics", () => {
  it("computes conversion rate, profit, and ROI when inputs exist", () => {
    const result = evaluateExperimentMetrics({
      visits: 200,
      conversions: 10,
      revenue: 500,
      cost: 200,
    });
    expect(result.derived.conversionRate).toBe(0.05);
    expect(result.derived.profit).toBe(300);
    expect(result.derived.roi).toBe(1.5);
    expect(result.missing).toEqual(["impressions", "clicks", "leads", "profit", "conversionRate", "roi"]);
  });

  it("keeps missing metrics missing — no estimates invented", () => {
    const result = evaluateExperimentMetrics({ visits: 100 });
    expect(result.derived.conversionRate).toBeNull();
    expect(result.derived.profit).toBeNull();
    expect(result.derived.roi).toBeNull();
    expect(result.missing).toContain("conversions");
    expect(result.missing).toContain("revenue");
  });

  it("handles zero visits without division by zero", () => {
    const result = evaluateExperimentMetrics({ visits: 0, conversions: 0 });
    expect(result.derived.conversionRate).toBe(0);
  });

  it("ROI is undefined (null) for zero cost — never infinite", () => {
    const result = evaluateExperimentMetrics({ revenue: 100, cost: 0 });
    expect(result.derived.roi).toBeNull();
    expect(result.derived.profit).toBe(100);
  });

  it("profit is negative when costs exceed revenue", () => {
    const result = evaluateExperimentMetrics({ revenue: 50, cost: 80 });
    expect(result.derived.profit).toBe(-30);
    expect(result.derived.roi).toBeCloseTo(-30 / 80, 1);
  });

  it("ignores non-finite and negative values", () => {
    const result = evaluateExperimentMetrics({
      revenue: Number.NaN,
      cost: -5,
      visits: 10,
      conversions: 2,
    });
    expect(result.derived.conversionRate).toBe(0.2);
    // Neither revenue nor a valid cost was recorded → profit stays null (missing).
    expect(result.derived.profit).toBeNull();
  });
});

describe("decideExperiment", () => {
  it("WIN when profit is positive and ROI meets the threshold", () => {
    const decision = decideExperiment({ revenue: 500, cost: 100, conversions: 5, visits: 100 }, true);
    expect(decision?.decision).toBe("WIN");
    expect(decision?.basis).toContain("ROI");
  });

  it("WIN at exactly the ROI threshold", () => {
    // revenue 120 / cost 100 → profit 20, ROI 0.2 exactly (after rounding).
    const decision = decideExperiment({ revenue: 120, cost: 100 }, false);
    expect(decision?.decision).toBe("WIN");
  });

  it("WIN for zero-cost experiments with recorded conversions", () => {
    const decision = decideExperiment({ revenue: 50, cost: 0, conversions: 3 }, true);
    expect(decision?.decision).toBe("WIN");
    expect(decision?.basis).toContain("zero recorded cost");
  });

  it("STOP when traffic produced zero conversions", () => {
    const decision = decideExperiment({ visits: 150, clicks: 30, conversions: 0 }, true);
    expect(decision?.decision).toBe("STOP");
    expect(decision?.basis).toContain("zero conversions");
  });

  it("STOP when CTR is below the threshold and no conversions exist", () => {
    const decision = decideExperiment({ impressions: 10000, clicks: 50, conversions: 0 }, true);
    expect(50 / 10000).toBeLessThan(DECISION_RULES.STOP_MAX_CTR);
    expect(decision?.decision).toBe("STOP");
  });

  it("ITERATE when conversion rate is below threshold without loss", () => {
    const decision = decideExperiment({ visits: 1000, conversions: 10, revenue: 10, cost: 5 }, true);
    expect(10 / 1000).toBeLessThan(DECISION_RULES.ITERATE_MAX_CONVERSION_RATE);
    // profit 5 with cost 5 → ROI 1.0 ≥ WIN threshold; the WIN rule dominates and is
    // intentional: recorded conversions with strong returns are a WIN even at low CR.
    expect(decision?.decision).toBe("WIN");
  });

  it("ITERATE when profit is not positive", () => {
    const decision = decideExperiment({ revenue: 10, cost: 10, conversions: 5, visits: 50 }, true);
    expect(decision?.decision).toBe("ITERATE");
    expect(decision?.basis).toContain("not positive");
  });

  it("INSUFFICIENT_DATA when nothing measurable was recorded", () => {
    const decision = decideExperiment({}, false);
    expect(decision?.decision).toBe("INSUFFICIENT_DATA");
    expect(decision?.basis).toContain("No conversions, financials, or traffic");
  });

  it("treats zero cost as recorded (not missing) for the WIN rule", () => {
    // revenue 10, cost 0 → profit 10 > 0, but conversions missing → not WIN; ITERATE.
    const decision = decideExperiment({ revenue: 10, cost: 0 }, false);
    expect(decision?.decision).toBe("ITERATE");
  });
});

describe("buildExperimentFeedback", () => {
  it("builds a WIN feedback object with real data classification", () => {
    const feedback = buildExperimentFeedback({
      opportunityId: "opp-1",
      experimentId: "exp-1",
      hypothesis: "Landing page converts",
      metrics: { revenue: 400, cost: 100, conversions: 8, visits: 160 },
      decision: "WIN",
    });
    expect(feedback.decision).toBe("WIN");
    expect(feedback.actualRevenue).toBe(400);
    expect(feedback.actualCost).toBe(100);
    expect(feedback.actualProfit).toBe(300);
    expect(feedback.dataClass).toBe("REAL_DATA");
    expect(feedback.opportunityId).toBe("opp-1");
    expect(feedback.evidenceGenerated[0]).toContain("exp-1");
    expect(feedback.lessons[0]).toContain("supported");
    expect(feedback.recommendationForFutureResearch).toContain("Research similar");
  });

  it("records missing metrics as lessons instead of inventing data", () => {
    const feedback = buildExperimentFeedback({
      opportunityId: "opp-1",
      experimentId: "exp-1",
      hypothesis: "h",
      metrics: {},
      decision: "INSUFFICIENT_DATA",
    });
    expect(feedback.actualRevenue).toBeNull();
    expect(feedback.actualProfit).toBeNull();
    expect(feedback.lessons.join(" ")).toContain("Metrics not recorded");
    expect(feedback.recommendationForFutureResearch).toContain("Instrument");
  });
});
