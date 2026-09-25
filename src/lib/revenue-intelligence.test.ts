import { describe, expect, it } from "vitest";
import {
  calculateRevenueIntelligence,
  classifyRevenueExperiment,
  recommendGrowthAction,
  type RevenueExperimentInput,
} from "@/lib/revenue-intelligence";

const NOW = new Date("2026-09-26T00:00:00.000Z");

function point(overrides: {
  revenue?: number | null;
  cost?: number | null;
  conversions?: number | null;
  dataClass?: "REAL_DATA" | "ESTIMATED_DATA";
  currency?: string;
  source?: string;
} = {}) {
  return {
    periodStart: "2026-09-01T00:00:00.000Z",
    periodEnd: "2026-09-02T00:00:00.000Z",
    recordedAt: "2026-09-02T12:00:00.000Z",
    impressions: 100,
    clicks: 10,
    visits: 50,
    leads: 5,
    conversions: overrides.conversions ?? null,
    revenue: overrides.revenue ?? null,
    cost: overrides.cost ?? null,
    currency: overrides.currency ?? "USD",
    source: overrides.source ?? "manual:dashboard",
    dataClass: overrides.dataClass ?? "REAL_DATA",
    notes: "",
  };
}

function experiment(overrides: Partial<RevenueExperimentInput> = {}): RevenueExperimentInput {
  return {
    experimentId: "exp-1",
    opportunityId: "opp-1",
    status: "RUNNING",
    decision: null,
    isBlocked: false,
    requiresHumanApproval: false,
    metricPoints: [],
    ...overrides,
  };
}

describe("Phase 26 revenue intelligence", () => {
  it("reports NOT_MEASURED honestly for an empty portfolio", () => {
    const state = calculateRevenueIntelligence([], NOW);
    expect(state.dataClass).toBe("NOT_MEASURED");
    expect(state.portfolioTotals.realRevenue).toBeNull();
    expect(state.portfolioTotals.totalExperiments).toBe(0);
    expect(state.portfolioTotals.provenanceNote).toContain("INSUFFICIENT_DATA");
  });

  it("never claims real revenue from ESTIMATED_DATA records", () => {
    const view = classifyRevenueExperiment(
      experiment({ metricPoints: [point({ revenue: 999, dataClass: "ESTIMATED_DATA" })] }),
    );
    expect(view.financial.revenue).toBeNull();
    expect(view.financial.dataClass).toBe("ESTIMATED_DATA");
    expect(view.financial.revenueProvenanceNote).toContain("never upgrade");
    const state = calculateRevenueIntelligence(
      [experiment({ metricPoints: [point({ revenue: 999, dataClass: "ESTIMATED_DATA" })] })],
      NOW,
    );
    expect(state.dataClass).toBe("ESTIMATED_DATA");
    expect(state.portfolioTotals.realRevenue).toBeNull();
  });

  it("sums REAL_DATA revenue with explicit provenance", () => {
    const input = experiment({
      metricPoints: [point({ revenue: 120.5 }), point({ revenue: 79.5, conversions: 3 })],
    });
    const view = classifyRevenueExperiment(input);
    expect(view.financial.revenue).toBe(200);
    expect(view.financial.conversions).toBe(3);
    expect(view.financial.dataClass).toBe("REAL_DATA");
    expect(view.financial.revenueProvenanceNote).toContain("2 REAL_DATA record(s)");
    const state = calculateRevenueIntelligence([input], NOW);
    expect(state.portfolioTotals.realRevenue).toBe(200);
    expect(state.dataClass).toBe("REAL_DATA");
  });

  it("never upgrades a WIN decision without real measurements", () => {
    const input = experiment({
      decision: "WIN",
      metricPoints: [point({ revenue: 500, dataClass: "ESTIMATED_DATA" })],
    });
    const view = classifyRevenueExperiment(input);
    expect(view.outcome).toBe("UNCERTAIN");
    expect(view.outcomeNote).toContain("not upgraded");
    expect(recommendGrowthAction(input).recommendation).toBe("HUMAN_REVIEW");
  });

  it("classifies WIN with real data as MEASURED_POSITIVE and scale candidate on positive ROI", () => {
    const input = experiment({
      decision: "WIN",
      metricPoints: [point({ revenue: 300, cost: 100, conversions: 5 })],
    });
    const view = classifyRevenueExperiment(input);
    expect(view.outcome).toBe("MEASURED_POSITIVE");
    expect(view.financial.profit).toBe(200);
    expect(view.financial.roi).toBeCloseTo(2);
    expect(recommendGrowthAction(input).recommendation).toBe("SCALE_CANDIDATE");
  });

  it("classifies STOP with real data as MEASURED_NEGATIVE and reassess", () => {
    const input = experiment({ decision: "STOP", metricPoints: [point({ revenue: 10, cost: 90 })] });
    const view = classifyRevenueExperiment(input);
    expect(view.outcome).toBe("MEASURED_NEGATIVE");
    expect(recommendGrowthAction(input).recommendation).toBe("REASSESS");
  });

  it("recommends collecting data when nothing was recorded", () => {
    const input = experiment({});
    const view = classifyRevenueExperiment(input);
    expect(view.recordCount).toBe(0);
    expect(view.measurementCompleteness).toBe(0);
    expect(view.financial.dataClass).toBe("NOT_MEASURED");
    expect(recommendGrowthAction(input).recommendation).toBe("COLLECT_MORE_DATA");
  });

  it("recommends collecting more data for real periods without a decision (not low signal)", () => {
    const input = experiment({ metricPoints: [point({ revenue: 25 })] });
    expect(recommendGrowthAction(input).recommendation).toBe("COLLECT_MORE_DATA");
  });

  it("flags low signal for estimated-only records", () => {
    const input = experiment({ metricPoints: [point({ revenue: 25, dataClass: "ESTIMATED_DATA" })] });
    expect(recommendGrowthAction(input).recommendation).toBe("LOW_SIGNAL");
  });

  it("keeps approval gates mandatory before any scale decision", () => {
    const input = experiment({
      decision: "WIN",
      requiresHumanApproval: true,
      metricPoints: [point({ revenue: 300, cost: 100 })],
    });
    const recommendation = recommendGrowthAction(input);
    expect(recommendation.recommendation).toBe("HUMAN_REVIEW");
    expect(recommendation.evidence.join(" ")).toContain("approval gates remain mandatory");
  });

  it("routes blocked experiments to human review", () => {
    const input = experiment({ status: "KILL", isBlocked: true, metricPoints: [point({ revenue: 300, cost: 100 })] });
    expect(recommendGrowthAction(input).recommendation).toBe("HUMAN_REVIEW");
  });

  it("computes measurement completeness from distinct recorded metrics only", () => {
    const view = classifyRevenueExperiment(
      experiment({ metricPoints: [point({ revenue: 10 })] }),
    );
    // recorded: impressions, clicks, visits, leads, revenue (5 of 7); conversions/cost missing
    expect(view.measurementCompleteness).toBeCloseTo(5 / 7);
    expect(view.missingMetrics).toEqual(["conversions", "cost"]);
  });

  it("aggregates portfolio totals across experiments with REAL_DATA provenance", () => {
    const state = calculateRevenueIntelligence(
      [
        experiment({ experimentId: "a", metricPoints: [point({ revenue: 100, cost: 40, conversions: 2 })] }),
        experiment({ experimentId: "b", decision: "WIN", metricPoints: [point({ revenue: 50 })] }),
        experiment({ experimentId: "c", metricPoints: [point({ revenue: 999, dataClass: "ESTIMATED_DATA" })] }),
      ],
      NOW,
    );
    expect(state.portfolioTotals.realRevenue).toBe(150);
    expect(state.portfolioTotals.realCost).toBe(40);
    expect(state.portfolioTotals.realConversions).toBe(2);
    expect(state.portfolioTotals.measuredExperiments).toBe(1);
    expect(state.portfolioTotals.experimentsAwaitingMeasurement).toBe(1);
    expect(state.portfolioTotals.experimentsNotMeasured).toBe(1);
    expect(state.dataClass).toBe("MIXED");
    expect(state.portfolioTotals.provenanceNote).toContain("2 experiment(s)");
  });

  it("keeps explanation honest about provenance and limits", () => {
    const state = calculateRevenueIntelligence([experiment({ metricPoints: [point({ revenue: 5 })] })], NOW);
    expect(state.explanation.join(" ")).toContain("no parallel revenue model");
    expect(state.explanation.join(" ")).toContain("REAL_DATA records");
    expect(state.generatedAt).toBe(NOW.toISOString());
  });
});
