/**
 * Phase 26 — Revenue & Growth Operations (pure, deterministic).
 *
 * A read-model over the EXISTING Phase 6B metric aggregation. This module:
 * - creates NO new scoring/ranking system (existing prioritization stays
 *   authoritative);
 * - fabricates nothing: missing measurements stay NOT_MEASURED, "unknown" is
 *   never zero, ESTIMATED_DATA is never upgraded to REAL_DATA, and portfolio
 *   revenue is claimed only from REAL_DATA provenance;
 * - produces explainable operational recommendations (evidence-citing states,
 *   not a new score) and classifies outcomes from persisted decisions only.
 */
import { summarizeMetricSeries, type AdditiveMetricKey, type MetricPointRaw } from "@/lib/metric-aggregation";

/* ------------------------------------------------------------------ */
/* Operational recommendation taxonomy (states, not a score)            */
/* ------------------------------------------------------------------ */

export const GROWTH_RECOMMENDATIONS = [
  "CONTINUE_EXPERIMENT",
  "COLLECT_MORE_DATA",
  "PAUSE",
  "REASSESS",
  "HUMAN_REVIEW",
  "SCALE_CANDIDATE",
  "LOW_SIGNAL",
  "INSUFFICIENT_DATA",
] as const;
export type GrowthRecommendation = (typeof GROWTH_RECOMMENDATIONS)[number];

export interface GrowthRecommendationView {
  recommendation: GrowthRecommendation;
  /** Persisted facts the recommendation is derived from — no inference. */
  evidence: string[];
}

export type RevenueDataClass = "REAL_DATA" | "ESTIMATED_DATA" | "MIXED" | "NOT_MEASURED";

export interface RevenueExperimentMetrics {
  experimentId: string;
  opportunityId: string;
  status: string;
  decision: string | null;
  /**
   * Portfolio outcome classification from the PERSISTED decision only. A
   * WIN/ITERATE/STOP decision recorded without real measurement data is
   * deliberately NOT classified as measured — the outcome stays UNCERTAIN
   * with an explicit note instead of upgrading the claim.
   */
  outcome:
    | "MEASURED_POSITIVE"
    | "MEASURED_NEGATIVE"
    | "UNCERTAIN"
    | "NOT_MEASURED"
    | "AWAITING_MEASUREMENT"
    | "REQUIRES_REVIEW"
    | "BLOCKED";
  outcomeNote: string | null;
  /**
   * Measurement completeness over the seven additive metrics: distinct
   * recorded metrics / 7. Unknown stays unknown; never padded with zeros.
   */
  measurementCompleteness: number;
  missingMetrics: AdditiveMetricKey[];
  recordCount: number;
  realRecordCount: number;
  estimatedRecordCount: number;
  /** Financial figures — REAL only when sourced from REAL_DATA records. */
  financial: {
    currency: string | null;
    revenue: number | null;
    cost: number | null;
    profit: number | null;
    roi: number | null;
    conversions: number | null;
    dataClass: RevenueDataClass;
    /** Explicit claim scope when revenue is REAL_DATA. */
    revenueProvenanceNote: string | null;
  };
}

export interface RevenueIntelligence {
  dataClass: RevenueDataClass;
  experiments: RevenueExperimentMetrics[];
  portfolioTotals: {
    realRevenue: number | null;
    realCost: number | null;
    realConversions: number | null;
    currency: string | null;
    measuredExperiments: number;
    experimentsAwaitingMeasurement: number;
    experimentsNotMeasured: number;
    totalExperiments: number;
    provenanceNote: string;
  };
  recommendations: Array<GrowthRecommendationView & { experimentId: string }>;
  explanation: string[];
  generatedAt: string;
}

export type RevenueMetricPoint = MetricPointRaw;

/** Minimal persisted facts the pure layer needs per experiment. */
export interface RevenueExperimentInput {
  experimentId: string;
  opportunityId: string;
  status: string;
  decision: string | null;
  isBlocked: boolean;
  requiresHumanApproval: boolean;
  /** Raw metric records for this experiment (bounded upstream). */
  metricPoints: MetricPointRaw[];
}

const ALL_ADDITIVE: AdditiveMetricKey[] = [
  "impressions",
  "clicks",
  "visits",
  "leads",
  "conversions",
  "revenue",
  "cost",
];

const POSITIVE_DECISIONS = new Set(["WIN", "ITERATE"]);
const NEGATIVE_DECISIONS = new Set(["STOP", "KILL"]);

/**
 * Classify one experiment from persisted facts. REAL financial figures are
 * summed from REAL_DATA records only; estimated records never contribute to
 * the real claim (they are counted separately for honesty).
 */
export function classifyRevenueExperiment(input: RevenueExperimentInput): RevenueExperimentMetrics {
  const points = input.metricPoints;
  const realPoints = points.filter((point) => point.dataClass === "REAL_DATA");
  const estimatedPoints = points.filter((point) => point.dataClass === "ESTIMATED_DATA");

  // Financial claim scope: REAL only when at least one REAL_DATA record exists
  // for the relevant metric. Estimated-only data is labeled ESTIMATED_DATA.
  const realSummary = summarizeMetricSeries(realPoints);
  const anySummary = summarizeMetricSeries(points);

  const distinctRecorded = ALL_ADDITIVE.filter((key) => anySummary.totals[key] !== null);
  const measurementCompleteness = points.length === 0 ? 0 : distinctRecorded.length / ALL_ADDITIVE.length;

  const financialDataClass: RevenueDataClass =
    points.length === 0
      ? "NOT_MEASURED"
      : realPoints.length === 0
        ? "ESTIMATED_DATA"
        : estimatedPoints.length === 0
          ? "REAL_DATA"
          : "MIXED";

  const currency =
    realPoints.find((point) => point.revenue !== null || point.cost !== null || point.conversions !== null)?.currency ??
    points.find((point) => point.revenue !== null || point.cost !== null || point.conversions !== null)?.currency ??
    null;

  // ROI/profit come from the existing aggregation (REAL series where available).
  const financial = {
    currency,
    revenue: realSummary.totals.revenue,
    cost: realSummary.totals.cost,
    profit: realSummary.derived.profit,
    roi: realSummary.derived.roi,
    conversions: realSummary.totals.conversions,
    dataClass: financialDataClass,
    revenueProvenanceNote:
      realSummary.totals.revenue !== null
        ? `Revenue sum of ${realPoints.filter((point) => point.revenue !== null).length} REAL_DATA record(s) with explicit source provenance.`
        : realPoints.length === 0 && estimatedPoints.length > 0
          ? "No REAL_DATA revenue: estimated records never upgrade to a real revenue claim."
          : null,
  };

  const { outcome, outcomeNote } = classifyOutcome(input, realPoints.length);
  const missingMetrics = ALL_ADDITIVE.filter((key) => anySummary.totals[key] === null);

  return {
    experimentId: input.experimentId,
    opportunityId: input.opportunityId,
    status: input.status,
    decision: input.decision,
    outcome,
    outcomeNote,
    measurementCompleteness,
    missingMetrics,
    recordCount: points.length,
    realRecordCount: realPoints.length,
    estimatedRecordCount: estimatedPoints.length,
    financial,
  };
}

function classifyOutcome(
  input: RevenueExperimentInput,
  realRecordCount: number,
): { outcome: RevenueExperimentMetrics["outcome"]; outcomeNote: string | null } {
  if (input.isBlocked) {
    return { outcome: "BLOCKED", outcomeNote: "Experiment carries a persisted blocker; resolve before further measurement." };
  }
  const decision = input.decision;
  if (decision !== null && POSITIVE_DECISIONS.has(decision)) {
    if (realRecordCount === 0) {
      return {
        outcome: "UNCERTAIN",
        outcomeNote: `Persisted decision ${decision} exists but no REAL_DATA metric periods were recorded; outcome is not upgraded to measured.`,
      };
    }
    return { outcome: "MEASURED_POSITIVE", outcomeNote: null };
  }
  if (decision !== null && NEGATIVE_DECISIONS.has(decision)) {
    if (realRecordCount === 0) {
      return {
        outcome: "UNCERTAIN",
        outcomeNote: `Persisted decision ${decision} exists but no REAL_DATA metric periods were recorded; outcome is not upgraded to measured.`,
      };
    }
    return { outcome: "MEASURED_NEGATIVE", outcomeNote: null };
  }
  if (decision === "INSUFFICIENT_DATA" || input.status === "ITERATING") {
    return { outcome: "REQUIRES_REVIEW", outcomeNote: null };
  }
  if (realRecordCount > 0) {
    return { outcome: "AWAITING_MEASUREMENT", outcomeNote: "Real measurements exist; no final decision recorded yet." };
  }
  return { outcome: "NOT_MEASURED", outcomeNote: null };
}

/**
 * Evidence-citing operational recommendation. These are deterministic states
 * derived from persisted facts — not a new scoring/ranking system.
 */
export function recommendGrowthAction(input: RevenueExperimentInput): GrowthRecommendationView & { experimentId: string } {
  const view = classifyRevenueExperiment(input);
  const evidence: string[] = [];
  let recommendation: GrowthRecommendation;

  if (view.outcome === "BLOCKED") {
    recommendation = "HUMAN_REVIEW";
    evidence.push("Experiment is blocked by a persisted execution blocker.");
  } else if (input.requiresHumanApproval) {
    recommendation = "HUMAN_REVIEW";
    evidence.push(
      "A persisted WAITING_APPROVAL task exists for this opportunity; approval gates remain mandatory before any scale decision.",
    );
  } else if (view.outcome === "MEASURED_POSITIVE" && view.financial.roi !== null && view.financial.roi > 0) {
    recommendation = "SCALE_CANDIDATE";
    evidence.push(
      `Persisted decision ${view.decision} with REAL_DATA profit/roi (roi=${view.financial.roi.toFixed(2)}).`,
    );
  } else if (view.outcome === "MEASURED_POSITIVE") {
    recommendation = "CONTINUE_EXPERIMENT";
    evidence.push(`Persisted decision ${view.decision} with REAL_DATA periods (${view.realRecordCount}).`);
  } else if (view.outcome === "MEASURED_NEGATIVE") {
    recommendation = "REASSESS";
    evidence.push(`Persisted decision ${view.decision} with REAL_DATA periods (${view.realRecordCount}).`);
  } else if (view.outcome === "UNCERTAIN") {
    recommendation = "HUMAN_REVIEW";
    evidence.push(view.outcomeNote ?? "Decision exists without real measurements.");
  } else if (view.recordCount === 0) {
    recommendation = "COLLECT_MORE_DATA";
    evidence.push("No metric periods recorded for this experiment yet.");
  } else if (view.financial.dataClass === "ESTIMATED_DATA") {
    recommendation = "LOW_SIGNAL";
    evidence.push("Only ESTIMATED_DATA records exist; estimated data never feeds growth decisions.");
  } else {
    recommendation = "COLLECT_MORE_DATA";
    evidence.push(
      `Real periods recorded (${view.realRecordCount}) but no persisted decision yet; measurement completeness ${(view.measurementCompleteness * 100).toFixed(0)}%.`,
    );
  }
  return { experimentId: input.experimentId, recommendation, evidence };
}

/**
 * Compose the portfolio-level revenue read-model. Revenue is aggregated only
 * across experiments with REAL_DATA provenance; with no real data the whole
 * portfolio reports INSUFFICIENT_DATA-honest NOT_MEASURED totals.
 */
export function calculateRevenueIntelligence(
  inputs: readonly RevenueExperimentInput[],
  now = new Date(),
): RevenueIntelligence {
  const experiments = inputs.map((input) => classifyRevenueExperiment(input));
  const recommendations = inputs.map((input) => recommendGrowthAction(input));

  // Real portfolio totals: sum REAL_DATA records across experiments (raw sums,
  // consistent units assumed per recorded currency; mixed currencies keep the
  // first-seen currency and note the limitation).
  let realRevenue: number | null = null;
  let realCost: number | null = null;
  let realConversions: number | null = null;
  let currency: string | null = null;
  let mixedCurrency = false;
  const experimentsWithRealFinancial = new Set<string>();
  for (const input of inputs) {
    const realPoints = input.metricPoints.filter((point) => point.dataClass === "REAL_DATA");
    const financialPoints = realPoints.filter(
      (point) => point.revenue !== null || point.cost !== null || point.conversions !== null,
    );
    if (financialPoints.length === 0) continue;
    experimentsWithRealFinancial.add(input.experimentId);
    const summary = summarizeMetricSeries(realPoints);
    if (summary.totals.revenue !== null) realRevenue = (realRevenue ?? 0) + summary.totals.revenue;
    if (summary.totals.cost !== null) realCost = (realCost ?? 0) + summary.totals.cost;
    if (summary.totals.conversions !== null) realConversions = (realConversions ?? 0) + summary.totals.conversions;
    for (const point of financialPoints) {
      if (currency === null) currency = point.currency;
      else if (currency !== point.currency) mixedCurrency = true;
    }
  }

  const measuredExperiments = experiments.filter(
    (view) => view.outcome === "MEASURED_POSITIVE" || view.outcome === "MEASURED_NEGATIVE",
  ).length;
  const experimentsAwaitingMeasurement = experiments.filter(
    (view) => view.outcome === "AWAITING_MEASUREMENT" || view.outcome === "REQUIRES_REVIEW",
  ).length;
  const experimentsNotMeasured = experiments.filter((view) => view.outcome === "NOT_MEASURED").length;

  const portfolioDataClass: RevenueDataClass =
    experiments.length === 0
      ? "NOT_MEASURED"
      : experimentsWithRealFinancial.size === 0
        ? experiments.every((view) => view.financial.dataClass === "NOT_MEASURED")
          ? "NOT_MEASURED"
          : "ESTIMATED_DATA"
        : experimentsWithRealFinancial.size === experiments.length
          ? "REAL_DATA"
          : "MIXED";

  const explanation = [
    "Revenue intelligence is a read-model over the existing Phase 6B ExperimentMetric aggregation; no parallel revenue model exists.",
    "Portfolio revenue is summed ONLY from REAL_DATA records; estimated records never upgrade the claim.",
    mixedCurrency
      ? "Multiple currencies were recorded; totals are not currency-normalized and are reported per recorded values."
      : "All recorded financial values share a single currency (or none are recorded).",
    "A positive financial outcome does not imply future income; decisions remain bounded and human-reviewable.",
  ];

  return {
    dataClass: portfolioDataClass,
    experiments,
    portfolioTotals: {
      realRevenue,
      realCost,
      realConversions,
      currency,
      measuredExperiments,
      experimentsAwaitingMeasurement,
      experimentsNotMeasured,
      totalExperiments: experiments.length,
      provenanceNote:
        experimentsWithRealFinancial.size === 0
          ? "INSUFFICIENT_DATA: no experiment has REAL_DATA financial metrics; portfolio revenue is NOT_MEASURED and must not be inferred."
          : `Portfolio real revenue/cost/conversions summed from REAL_DATA records on ${experimentsWithRealFinancial.size} experiment(s)${mixedCurrency ? " (mixed currencies; not normalized)" : ""}.`,
    },
    recommendations,
    explanation,
    generatedAt: now.toISOString(),
  };
}
