import { describe, expect, it } from "vitest";
import {
  computeDerived,
  orderChronologically,
  summarizeMetricSeries,
  sumMetric,
  toPhase5Metrics,
} from "./metric-aggregation";
import type { MetricPointRaw } from "./metric-aggregation";

function point(overrides: Partial<MetricPointRaw> = {}): MetricPointRaw {
  return {
    periodStart: "2026-09-01T00:00:00.000Z",
    periodEnd: "2026-09-01T23:59:59.000Z",
    recordedAt: "2026-09-02T08:00:00.000Z",
    impressions: null,
    clicks: null,
    visits: null,
    leads: null,
    conversions: null,
    revenue: null,
    cost: null,
    currency: "USD",
    source: "test",
    dataClass: "REAL_DATA",
    notes: "",
    ...overrides,
  };
}

describe("sumMetric (missing-data semantics)", () => {
  it("sums only recorded values", () => {
    const total = sumMetric(
      [point({ revenue: 100 }), point({ revenue: 250.5 }), point({ revenue: null })],
      "revenue",
    );
    expect(total).toBe(350.5);
  });

  it("keeps explicit zero as a real measurement", () => {
    expect(sumMetric([point({ clicks: 0 })], "clicks")).toBe(0);
  });

  it("returns null when nothing was ever recorded — never zero", () => {
    expect(sumMetric([point(), point()], "revenue")).toBeNull();
    expect(sumMetric([], "cost")).toBeNull();
  });
});

describe("computeDerived (no NaN/Infinity, zero denominators)", () => {
  it("computes CTR, conversion rate, profit, ROI, CPC, CPL, CPA, revenue per visit", () => {
    const derived = computeDerived({
      impressions: 1000,
      clicks: 30,
      visits: 25,
      leads: 5,
      conversions: 4,
      revenue: 600,
      cost: 200,
    });
    expect(derived.ctr).toBeCloseTo(0.03);
    expect(derived.conversionRate).toBeCloseTo(0.16);
    expect(derived.profit).toBe(400);
    expect(derived.roi).toBeCloseTo(2);
    expect(derived.cpc).toBeCloseTo(200 / 30);
    expect(derived.cpl).toBe(40);
    expect(derived.cpa).toBe(50);
    expect(derived.revenuePerVisit).toBe(24);
  });

  it("zero impressions → CTR undefined (null), never NaN", () => {
    expect(computeDerived({ impressions: 0, clicks: 0, visits: null, leads: null, conversions: null, revenue: null, cost: null }).ctr).toBeNull();
  });

  it("zero visits → conversion rate undefined", () => {
    expect(computeDerived({ impressions: 10, clicks: 2, visits: 0, leads: null, conversions: 0, revenue: null, cost: null }).conversionRate).toBeNull();
  });

  it("zero cost → ROI undefined, never Infinity", () => {
    const derived = computeDerived({ impressions: null, clicks: null, visits: null, leads: null, conversions: 3, revenue: 100, cost: 0 });
    expect(derived.profit).toBe(100);
    expect(derived.roi).toBeNull();
  });

  it("missing denominator → derived value null", () => {
    const derived = computeDerived({ impressions: null, clicks: 5, visits: null, leads: null, conversions: null, revenue: null, cost: 10 });
    expect(derived.ctr).toBeNull();
    expect(derived.conversionRate).toBeNull();
  });

  it("profit is null only when both revenue and cost are missing", () => {
    expect(computeDerived({ impressions: null, clicks: null, visits: null, leads: null, conversions: null, revenue: null, cost: null }).profit).toBeNull();
    expect(computeDerived({ impressions: null, clicks: null, visits: null, leads: null, conversions: null, revenue: null, cost: 0 }).profit).toBe(0);
  });
});

describe("summarizeMetricSeries", () => {
  it("aggregates multiple days with mixed available/missing values", () => {
    const summary = summarizeMetricSeries([
      point({ periodStart: "2026-09-02", impressions: 900, clicks: 20, revenue: 200 }),
      point({ periodStart: "2026-09-01", impressions: 1000, clicks: 30, revenue: null, cost: 100 }),
      point({ periodStart: "2026-09-03", impressions: 800, clicks: null, conversions: 2, revenue: 300 }),
    ]);
    expect(summary.recordCount).toBe(3);
    expect(summary.totals.impressions).toBe(2700);
    expect(summary.totals.clicks).toBe(50); // missing day-3 clicks contribute nothing
    expect(summary.totals.revenue).toBe(500);
    expect(summary.totals.cost).toBe(100);
    expect(summary.totals.conversions).toBe(2);
    expect(summary.missing).toEqual(["visits", "leads"]);
    expect(summary.derived.ctr).toBeCloseTo(50 / 2700);
    expect(summary.derived.roi).toBeCloseTo(4);
    // Chronological cumulative: revenue builds 100? no — day1 has cost only.
    expect(summary.cumulative[0].revenue).toBeNull(); // day 1: no revenue yet
    expect(summary.cumulative[1].revenue).toBe(200);
    expect(summary.cumulative[2].revenue).toBe(500);
    expect(summary.cumulative[2].clicks).toBe(50);
  });

  it("returns an empty-but-honest summary for an empty series", () => {
    const summary = summarizeMetricSeries([]);
    expect(summary.recordCount).toBe(0);
    expect(summary.missing).toHaveLength(7);
    expect(summary.derived.roi).toBeNull();
  });

  it("never fabricates values from ESTIMATED_DATA — class is reported", () => {
    const summary = summarizeMetricSeries([
      point({ revenue: 100, dataClass: "ESTIMATED_DATA" }),
      point({ revenue: 50, dataClass: "REAL_DATA" }),
    ]);
    expect(summary.dataClass).toBe("MIXED");
    expect(summary.estimatedRecordCount).toBe(1);
    expect(summary.totals.revenue).toBe(150); // both are recorded data of declared class
  });

  it("all-estimated series are labeled ESTIMATED_DATA", () => {
    const summary = summarizeMetricSeries([point({ revenue: 100, dataClass: "ESTIMATED_DATA" })]);
    expect(summary.dataClass).toBe("ESTIMATED_DATA");
  });
});

describe("orderChronologically + toPhase5Metrics", () => {
  it("orders the series chronologically regardless of input order", () => {
    const ordered = orderChronologically([
      point({ periodStart: "2026-09-03" }),
      point({ periodStart: "2026-09-01" }),
      point({ periodStart: "2026-09-02" }),
    ]);
    expect(ordered.map((p) => p.periodStart)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
  });

  it("passes only recorded totals to the Phase 5 shape — missing stays undefined", () => {
    const summary = summarizeMetricSeries([point({ clicks: 10, revenue: 40 })]);
    const flat = toPhase5Metrics(summary);
    expect(flat.clicks).toBe(10);
    expect(flat.revenue).toBe(40);
    expect(flat.impressions).toBeUndefined();
    expect(flat.cost).toBeUndefined();
    expect("conversions" in flat).toBe(false);
  });
});
