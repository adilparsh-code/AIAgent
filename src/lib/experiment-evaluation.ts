import type { Experiment } from "./types";

/**
 * Phase 5 — experiment evaluation. Pure, rule-based math over recorded metrics.
 * Missing metrics stay missing: they are never replaced with estimates, and any
 * value computed by this module is explicitly labeled ESTIMATED_DATA.
 */

/** Measurable experiment metrics. `undefined` means genuinely missing — never faked. */
export interface ExperimentMetrics {
  impressions?: number;
  clicks?: number;
  visits?: number;
  leads?: number;
  conversions?: number;
  revenue?: number;
  cost?: number;
  profit?: number;
  conversionRate?: number;
  roi?: number;
}

export interface ComputedExperimentMetrics {
  /** Values derived by this module (conversion rate, profit, ROI), flagged ESTIMATED_DATA. */
  derived: {
    conversionRate: number | null;
    profit: number | null;
    roi: number | null;
  };
  classification: "REAL_DATA" | "ESTIMATED_DATA";
  /** Which optional metric fields were absent from the recorded inputs. */
  missing: Array<keyof ExperimentMetrics>;
}

export interface ExperimentEvaluation {
  metrics: ComputedExperimentMetrics;
  decision: {
    decision: "WIN" | "ITERATE" | "STOP" | "INSUFFICIENT_DATA";
    basis: string;
  } | null;
}

/**
 * Decision thresholds. Explicit, documented rules — not AI opinions.
 */
export const DECISION_RULES = {
  /** ROI at or above this (and profit > 0) counts as a WIN when costs exist. */
  WIN_MIN_ROI: 0.2,
  /** Conversions required for a WIN when no costs were recorded (cost === 0). */
  WIN_MIN_CONVERSIONS: 1,
  /** Below this conversion rate an experiment ITERATEs rather than WINs. */
  ITERATE_MAX_CONVERSION_RATE: 0.05,
  /** Click-through rate below this with no conversions suggests weak demand → STOP. */
  STOP_MAX_CTR: 0.01,
} as const;

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Evaluate recorded metrics. Only recorded inputs are used; derived values are
 * computed where mathematically possible and classified ESTIMATED_DATA.
 */
export function evaluateExperimentMetrics(metrics: ExperimentMetrics): ComputedExperimentMetrics {
  const metricFields: Array<keyof ExperimentMetrics> = [
    "impressions",
    "clicks",
    "visits",
    "leads",
    "conversions",
    "revenue",
    "cost",
    "profit",
    "conversionRate",
    "roi",
  ];
  const missing = metricFields.filter((field) => metrics[field] === undefined);

  const conversions = isNonNegativeNumber(metrics.conversions) ? metrics.conversions : null;
  const visits = isNonNegativeNumber(metrics.visits) ? metrics.visits : null;
  const clicks = isNonNegativeNumber(metrics.clicks) ? metrics.clicks : null;
  const impressions = isNonNegativeNumber(metrics.impressions) ? metrics.impressions : null;
  const revenue = isNonNegativeNumber(metrics.revenue) ? metrics.revenue : null;
  const cost = isNonNegativeNumber(metrics.cost) ? metrics.cost : null;

  // conversionRate = conversions / visits, only when both are present (0 visits = 0).
  const conversionRate =
    conversions !== null && visits !== null ? round2(conversions / Math.max(visits, 1)) : null;

  // profit = revenue - cost, only when at least one side is recorded.
  const profit = revenue !== null || cost !== null ? (revenue ?? 0) - (cost ?? 0) : null;

  // ROI = profit / cost. Zero cost means ROI is undefined, not infinite.
  const roi =
    profit !== null && cost !== null && cost > 0 ? round2(profit / cost) : null;

  return {
    derived: { conversionRate, profit, roi },
    // Derived values exist whenever the math was possible — classify honestly.
    classification: "ESTIMATED_DATA",
    missing,
  };
}

/**
 * Explicit decision rules based only on recorded experiment data:
 * - WIN: profit > 0 with ROI ≥ WIN_MIN_ROI, or (zero-cost) conversions ≥ WIN_MIN_CONVERSIONS.
 * - STOP: traffic but no conversions, or CTR below STOP_MAX_CTR.
 * - ITERATE: everything recorded but thresholds not yet met.
 * - INSUFFICIENT_DATA: required inputs absent, so no honest decision is possible.
 * Decisions are computed — they are never fabricated where data is missing.
 */
export function decideExperiment(metrics: ExperimentMetrics, hasTraffic: boolean): ExperimentEvaluation["decision"] {
  const computed = evaluateExperimentMetrics(metrics);
  const { conversionRate, profit, roi } = computed.derived;
  const conversions = isNonNegativeNumber(metrics.conversions) ? metrics.conversions : null;
  const revenue = isNonNegativeNumber(metrics.revenue) ? metrics.revenue : null;
  const cost = isNonNegativeNumber(metrics.cost) ? metrics.cost : null;
  const clicks = isNonNegativeNumber(metrics.clicks) ? metrics.clicks : null;
  const impressions = isNonNegativeNumber(metrics.impressions) ? metrics.impressions : null;

  // Nothing measurable was recorded → the only honest decision is INSUFFICIENT_DATA.
  const conversionsRecorded = conversions !== null;
  const financialsRecorded = revenue !== null || cost !== null;
  if (!conversionsRecorded && !financialsRecorded && !hasTraffic) {
    return {
      decision: "INSUFFICIENT_DATA",
      basis: "No conversions, financials, or traffic recorded; no decision is possible without data.",
    };
  }

  // WIN on financials (costs exist so ROI is meaningful)…
  if (profit !== null && roi !== null && profit > 0 && roi >= DECISION_RULES.WIN_MIN_ROI) {
    return {
      decision: "WIN",
      basis: `Profit ${profit.toFixed(2)} with ROI ${roi.toFixed(2)} ≥ ${DECISION_RULES.WIN_MIN_ROI}.`,
    };
  }
  // …or on zero-cost wins with recorded conversions.
  if (profit !== null && profit > 0 && cost === 0 && conversions !== null && conversions >= DECISION_RULES.WIN_MIN_CONVERSIONS) {
    return {
      decision: "WIN",
      basis: `Profit ${profit.toFixed(2)} at zero recorded cost with ${conversions} conversion(s).`,
    };
  }

  // STOP: traffic arrived but produced nothing, or clicks are essentially absent.
  if (conversions === 0 && hasTraffic) {
    return {
      decision: "STOP",
      basis: "Traffic was recorded but zero conversions resulted.",
    };
  }
  const ctr = clicks !== null && impressions !== null && impressions > 0 ? clicks / impressions : null;
  if (ctr !== null && ctr < DECISION_RULES.STOP_MAX_CTR && (conversions === null || conversions === 0)) {
    return {
      decision: "STOP",
      basis: `CTR ${ctr.toFixed(4)} below ${DECISION_RULES.STOP_MAX_CTR} with no conversions.`,
    };
  }

  // ITERATE: partial support — some data exists but thresholds are not met.
  if (conversionRate !== null && conversionRate < DECISION_RULES.ITERATE_MAX_CONVERSION_RATE) {
    return {
      decision: "ITERATE",
      basis: `Conversion rate ${(conversionRate * 100).toFixed(2)}% below ${(DECISION_RULES.ITERATE_MAX_CONVERSION_RATE * 100).toFixed(0)}%.`,
    };
  }
  if (profit !== null && profit <= 0) {
    return {
      decision: "ITERATE",
      basis: `Profit ${profit.toFixed(2)} is not positive; iterate before scaling.`,
    };
  }
  return {
    decision: "ITERATE",
    basis: "Data recorded but WIN thresholds not yet reached.",
  };
}

/** A feedback record sent back to AIAgent after an experiment completes. */
export interface ExperimentFeedback {
  opportunityId: string;
  experimentId: string;
  actualMetrics: ExperimentMetrics;
  actualRevenue: number | null;
  actualCost: number | null;
  actualProfit: number | null;
  decision: "WIN" | "ITERATE" | "STOP" | "INSUFFICIENT_DATA";
  lessons: string[];
  evidenceGenerated: string[];
  recommendationForFutureResearch: string;
  dataClass: "REAL_DATA" | "ESTIMATED_DATA";
}

/**
 * Build structured feedback for the research/validation layer. Everything is
 * derived from recorded metrics; missing values stay null, never estimated.
 */
export function buildExperimentFeedback(input: {
  opportunityId: string;
  experimentId: string;
  hypothesis: string;
  metrics: ExperimentMetrics;
  decision: "WIN" | "ITERATE" | "STOP" | "INSUFFICIENT_DATA";
}): ExperimentFeedback {
  const computed = evaluateExperimentMetrics(input.metrics);
  const { profit } = computed.derived;
  const revenue = isNonNegativeNumber(input.metrics.revenue) ? input.metrics.revenue : null;
  const cost = isNonNegativeNumber(input.metrics.cost) ? input.metrics.cost : null;

  const lessons: string[] = [];
  if (input.decision === "WIN") {
    lessons.push(`Experiment hypothesis was supported: ${input.hypothesis}`);
  } else if (input.decision === "ITERATE") {
    lessons.push("Result was partially supported; iterate on the offer or channel before scaling.");
  } else if (input.decision === "STOP") {
    lessons.push("Result did not support the hypothesis; stop and record why demand did not convert.");
  } else {
    lessons.push("Not enough recorded data to evaluate the hypothesis; instrument metrics before relaunching.");
  }
  if (computed.missing.length) {
    lessons.push(`Metrics not recorded: ${computed.missing.join(", ")}.`);
  }

  return {
    opportunityId: input.opportunityId,
    experimentId: input.experimentId,
    actualMetrics: input.metrics,
    actualRevenue: revenue,
    actualCost: cost,
    actualProfit: profit,
    decision: input.decision,
    lessons,
    evidenceGenerated: [
      `Experiment ${input.experimentId} on opportunity ${input.opportunityId} recorded ${computed.missing.length ? "partial" : "complete"} metrics.`,
    ],
    recommendationForFutureResearch:
      input.decision === "WIN"
        ? "Research similar demand/commercial-intent patterns; this offer converted."
        : input.decision === "ITERATE"
          ? "Research the chosen channel and pricing to explain the weak conversion before a repeat run."
          : input.decision === "STOP"
            ? "Record a qualitative contradiction for this demand pattern; future runs should weigh it."
            : "Instrument conversion and cost tracking before any future research-based handoff.",
    dataClass: "REAL_DATA",
  };
}
