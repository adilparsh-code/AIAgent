/**
 * Phase 6B — pure time-series metric aggregation and derived-metric math.
 *
 * Raw vs derived:
 * - RAW (recorded): impressions, clicks, visits, leads, conversions, revenue, cost.
 * - DERIVED (calculated, never persisted as measurements): CTR, conversion rate,
 *   profit, ROI, CPC, CPL, CPA, revenue per visit.
 *
 * Missing-data semantics (enforced end to end):
 * - A metric never recorded stays MISSING — never converted to zero, never estimated.
 * - An explicit zero is a real measurement and stays zero.
 * - A denominator of zero (0 impressions, 0 visits, 0 cost) makes the derived
 *   ratio undefined (null) — never Infinity, never NaN.
 *
 * This module is pure: no database, no clock, no I/O — trivially testable.
 */

export interface MetricPointRaw {
  periodStart: string;
  periodEnd: string;
  recordedAt: string;
  impressions: number | null;
  clicks: number | null;
  visits: number | null;
  leads: number | null;
  conversions: number | null;
  revenue: number | null;
  cost: number | null;
  currency: string;
  source: string;
  dataClass: "REAL_DATA" | "ESTIMATED_DATA";
  notes: string;
}

export type AdditiveMetricKey = "impressions" | "clicks" | "visits" | "leads" | "conversions" | "revenue" | "cost";
export type DerivedMetricKey = "ctr" | "conversionRate" | "profit" | "roi" | "cpc" | "cpl" | "cpa" | "revenuePerVisit";

const ADDITIVE_KEYS: AdditiveMetricKey[] = [
  "impressions",
  "clicks",
  "visits",
  "leads",
  "conversions",
  "revenue",
  "cost",
];

export interface DerivedMetrics {
  /** clicks / impressions — null when either is missing or impressions is 0. */
  ctr: number | null;
  /** conversions / visits — null when either is missing or visits is 0. */
  conversionRate: number | null;
  /** revenue - cost — null only when both are missing. */
  profit: number | null;
  /** profit / cost — null when cost is missing or 0 (never Infinity). */
  roi: number | null;
  /** cost / clicks — null when either is missing or clicks is 0. */
  cpc: number | null;
  /** cost / leads — null when either is missing or leads is 0. */
  cpl: number | null;
  /** cost / conversions — null when either is missing or conversions is 0. */
  cpa: number | null;
  /** revenue / visits — null when either is missing or visits is 0. */
  revenuePerVisit: number | null;
}

export interface MetricSummary {
  /** Sum of recorded values per additive metric; null when nothing was recorded. */
  totals: Record<AdditiveMetricKey, number | null>;
  /** Number of metric records considered. */
  recordCount: number;
  /** Number of records in the input marked ESTIMATED_DATA. */
  estimatedRecordCount: number;
  /** Additive metrics with no recorded values anywhere in the series. */
  missing: AdditiveMetricKey[];
  /** Cumulative running totals over the chronological series (same null semantics). */
  cumulative: Array<Record<AdditiveMetricKey, number | null> & { periodStart: string; periodEnd: string }>;
  derived: DerivedMetrics;
  /** Overall data class: ESTIMATED_DATA only if every record is estimated. */
  dataClass: "REAL_DATA" | "ESTIMATED_DATA" | "MIXED";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeRatio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  const ratio = numerator / denominator;
  return Number.isFinite(ratio) ? ratio : null;
}

/** Sum only recorded values across the series; null when nothing was recorded. */
export function sumMetric(points: MetricPointRaw[], key: AdditiveMetricKey): number | null {
  let sum = 0;
  let seen = false;
  for (const point of points) {
    const value = point[key];
    if (isNumber(value)) {
      sum += value;
      seen = true;
    }
  }
  return seen ? sum : null;
}

/** Compute derived metrics from raw recorded values only. */
export function computeDerived(totals: Record<AdditiveMetricKey, number | null>): DerivedMetrics {
  const { clicks, impressions, conversions, visits, revenue, cost, leads } = totals;
  const profit = revenue !== null || cost !== null ? (revenue ?? 0) - (cost ?? 0) : null;
  return {
    ctr: safeRatio(clicks, impressions),
    conversionRate: safeRatio(conversions, visits),
    profit,
    roi: profit !== null && cost !== null && cost > 0 ? safeRatio(profit, cost) : null,
    cpc: safeRatio(cost, clicks),
    cpl: safeRatio(cost, leads),
    cpa: safeRatio(cost, conversions),
    revenuePerVisit: safeRatio(revenue, visits),
  };
}

/** Chronological ordering of a series by periodStart (then periodEnd). */
export function orderChronologically(points: MetricPointRaw[]): MetricPointRaw[] {
  return [...points].sort((a, b) => {
    const start = new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime();
    if (start !== 0) return start;
    return new Date(a.periodEnd).getTime() - new Date(b.periodEnd).getTime();
  });
}

/** Aggregate a (chronologically ordered or not) series into a full summary. */
export function summarizeMetricSeries(points: MetricPointRaw[]): MetricSummary {
  const ordered = orderChronologically(points);

  const totals = ADDITIVE_KEYS.reduce(
    (acc, key) => {
      acc[key] = sumMetric(ordered, key);
      return acc;
    },
    {} as Record<AdditiveMetricKey, number | null>,
  );

  // Cumulative running totals: values carry forward; a metric with no recorded
  // value yet stays null (never zero).
  const running: Record<AdditiveMetricKey, number | null> = ADDITIVE_KEYS.reduce(
    (acc, key) => {
      acc[key] = null;
      return acc;
    },
    {} as Record<AdditiveMetricKey, number | null>,
  );
  const cumulative = ordered.map((point) => {
    for (const key of ADDITIVE_KEYS) {
      const value = point[key];
      if (isNumber(value)) {
        running[key] = (running[key] ?? 0) + value;
      }
    }
    return { periodStart: point.periodStart, periodEnd: point.periodEnd, ...running };
  });

  const estimatedCount = ordered.filter((p) => p.dataClass === "ESTIMATED_DATA").length;
  const realCount = ordered.length - estimatedCount;
  const dataClass: MetricSummary["dataClass"] =
    ordered.length === 0 ? "REAL_DATA" : estimatedCount === 0 ? "REAL_DATA" : realCount === 0 ? "ESTIMATED_DATA" : "MIXED";

  return {
    totals,
    recordCount: ordered.length,
    estimatedRecordCount: estimatedCount,
    missing: ADDITIVE_KEYS.filter((key) => totals[key] === null),
    cumulative,
    derived: computeDerived(totals),
    dataClass,
  };
}

/**
 * Flatten a summary into the flat Phase 5 ExperimentMetrics shape so the
 * existing pure evaluation/decision rules can run unchanged on aggregated
 * time-series totals. Only recorded (or derived where the Phase 5 shape
 * expects them) values are passed through; missing stays undefined.
 */
export function toPhase5Metrics(summary: MetricSummary): {
  impressions?: number;
  clicks?: number;
  visits?: number;
  leads?: number;
  conversions?: number;
  revenue?: number;
  cost?: number;
} {
  const out: ReturnType<typeof toPhase5Metrics> = {};
  for (const key of ADDITIVE_KEYS) {
    const value = summary.totals[key];
    if (value !== null) out[key] = value;
  }
  return out;
}
