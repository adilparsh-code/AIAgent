import type { ExperimentFeedback } from "./experiment-evaluation";

/**
 * Phase 6C — experiment feedback → learning signals → bounded, explainable
 * re-ranking. Pure and deterministic: the same inputs always produce the same
 * signals, scores, confidence, and explanations. No LLM assigns scores; every
 * number below comes from an explicit rule over RECORDED data.
 *
 * Core principles (enforced here and tested):
 * - Experiment evidence is a distinct evidence class from research evidence.
 * - A single experiment is never market truth: its influence on the ranking is
 *   bounded by EXPERIMENT_INFLUENCE_CAP.
 * - ESTIMATED_DATA experiments weigh far less than REAL_DATA ones and can
 *   never produce high-confidence signals.
 * - Conflicting experiment outcomes are surfaced as MIXED, never averaged away.
 */

/** Versioned feedback contract persisted on Experiment.feedback and exposed via API. */
export interface ExperimentLearningContract {
  feedbackVersion: 2;
  opportunityId: string;
  experimentId: string;
  experimentEvidence: {
    dataClass: "REAL_DATA" | "ESTIMATED_DATA" | "MIXED";
    measurementPeriod: { from: string | null; to: string | null };
    metrics: {
      impressions: number | null;
      clicks: number | null;
      visits: number | null;
      leads: number | null;
      conversions: number | null;
      revenue: number | null;
      cost: number | null;
    };
    derived: {
      profit: number | null;
      roi: number | null;
      ctr: number | null;
      conversionRate: number | null;
    };
  };
  outcome: "POSITIVE" | "NEGATIVE" | "MIXED" | "INSUFFICIENT";
  decision: "WIN" | "ITERATE" | "STOP" | "INSUFFICIENT_DATA";
  learningSignals: LearningSignal[];
  researchImplications: string[];
  confidence: number; // 0-1, confidence in the LEARNING, not in market truth
  rankingImpact: { eligible: boolean; reason: string; maxContribution: number };
  generatedAt: string;
}

export type LearningSignalKey =
  | "POSITIVE_DEMAND_SIGNAL"
  | "NEGATIVE_DEMAND_SIGNAL"
  | "POSITIVE_CONVERSION_SIGNAL"
  | "NEGATIVE_CONVERSION_SIGNAL"
  | "POSITIVE_MONETIZATION_SIGNAL"
  | "NEGATIVE_MONETIZATION_SIGNAL"
  | "POSITIVE_UNIT_ECONOMICS_SIGNAL"
  | "NEGATIVE_UNIT_ECONOMICS_SIGNAL"
  | "INSUFFICIENT_EXPERIMENT_DATA";

export interface LearningSignal {
  key: LearningSignalKey;
  basis: string;
  dataClass: "REAL_DATA" | "ESTIMATED_DATA" | "MIXED";
  /** Recorded facts the signal rests on — traceable to experiment metrics. */
  evidence: string[];
}

/** Explicit sufficiency thresholds. Documented, centralized — no scattered magic numbers. */
export const SUFFICIENCY_THRESHOLDS = {
  /**
   * Impressions needed for a MEANINGFUL traffic-based signal. Rationale: below
   * a few hundred impressions a single click swings the conversion rate by
   * whole percentage points, so demand/conversion readings are noise.
   */
  MIN_IMPRESSIONS_MEANINGFUL: 500,
  /**
   * Impressions for a STRONG signal (~a dozen+ expected conversions at typical
   * 1-3% rates). Kept modest so small honest experiments still count.
   */
  MIN_IMPRESSIONS_STRONG: 5000,
  /** Recorded cost below which financial results are too thin to rank on. */
  MIN_COST_MEANINGFUL: 50,
  /** Revenue below which monetization evidence is weak. */
  MIN_REVENUE_MEANINGFUL: 50,
  /** Conversions needed for a meaningful conversion signal. */
  MIN_CONVERSIONS_MEANINGFUL: 3,
  /** Distinct measurement periods (days) for a long-running experiment. */
  MIN_PERIODS_STRONG: 7,
} as const;

export type SufficiencyLevel = "INSUFFICIENT" | "LOW_SIGNAL" | "MEANINGFUL_SIGNAL" | "STRONG_SIGNAL";

export interface SufficiencyAssessment {
  level: SufficiencyLevel;
  basis: string;
  factors: {
    recordCount: number;
    totalImpressions: number | null;
    totalCost: number | null;
    totalConversions: number | null;
    periodCount: number;
  };
}

/**
 * Assess whether an experiment's RECORDED data is sufficient to learn from.
 * Uses only metrics actually present; missing metrics never count as zeros.
 */
export function assessExperimentSufficiency(summary: {
  recordCount: number;
  totals: {
    impressions: number | null;
    clicks: number | null;
    visits: number | null;
    leads: number | null;
    conversions: number | null;
    revenue: number | null;
    cost: number | null;
  };
  estimatedRecordCount: number;
}): SufficiencyAssessment {
  const { totals, recordCount, estimatedRecordCount } = summary;
  const realRecords = recordCount - estimatedRecordCount;
  const factors = {
    recordCount,
    totalImpressions: totals.impressions,
    totalCost: totals.cost,
    totalConversions: totals.conversions,
    periodCount: recordCount,
  };

  const impressions = totals.impressions ?? 0;
  const cost = totals.cost ?? 0;
  const conversions = totals.conversions;

  // Nothing (or only estimated rows) recorded → nothing to learn from.
  if (recordCount === 0 || realRecords === 0) {
    return { level: "INSUFFICIENT", basis: "No recorded metric periods exist for this experiment.", factors };
  }
  // Records exist but no measurement value was recorded in any of them.
  const anyMeasurement = Object.values(totals).some((value) => value !== null);
  if (!anyMeasurement) {
    return {
      level: "INSUFFICIENT",
      basis: "Metric periods exist but no measurement values were recorded — nothing to learn from.",
      factors,
    };
  }
  if (realRecords < 2 && impressions < SUFFICIENCY_THRESHOLDS.MIN_IMPRESSIONS_MEANINGFUL && cost < SUFFICIENCY_THRESHOLDS.MIN_COST_MEANINGFUL) {
    return {
      level: "INSUFFICIENT",
      basis: `Only ${realRecords} recorded period(s) with ${totals.impressions ?? "no"} impressions and ${totals.cost ?? "no"} cost — below minimum measurable scale.`,
      factors,
    };
  }

  const strongImpressions = impressions >= SUFFICIENCY_THRESHOLDS.MIN_IMPRESSIONS_STRONG;
  const strongDuration = recordCount >= SUFFICIENCY_THRESHOLDS.MIN_PERIODS_STRONG;
  const meaningfulImpressions = impressions >= SUFFICIENCY_THRESHOLDS.MIN_IMPRESSIONS_MEANINGFUL;
  const meaningfulCost = cost >= SUFFICIENCY_THRESHOLDS.MIN_COST_MEANINGFUL;
  const meaningfulConversions = conversions !== null && conversions >= SUFFICIENCY_THRESHOLDS.MIN_CONVERSIONS_MEANINGFUL;

  if (strongImpressions || (strongDuration && (meaningfulImpressions || meaningfulCost))) {
    return {
      level: "STRONG_SIGNAL",
      basis: `${recordCount} recorded period(s), ${impressions} impressions${totals.cost !== null ? `, ${cost} cost` : ""} — meets strong-signal thresholds.`,
      factors,
    };
  }
  if (meaningfulImpressions || meaningfulCost || meaningfulConversions) {
    return {
      level: "MEANINGFUL_SIGNAL",
      basis: `Recorded scale (${impressions} impressions, ${cost} cost, ${conversions ?? "no"} conversions) meets meaningful-signal thresholds.`,
      factors,
    };
  }
  return {
    level: "LOW_SIGNAL",
    basis: "Some data recorded but below meaningful-signal thresholds; treat conclusions as indicative only.",
    factors,
  };
}

const POSITIVE_NEGATIVE_PAIRS: Array<{
  positive: LearningSignalKey;
  negative: LearningSignalKey;
  applies: (totals: AssessTotals, derived: DerivedForSignals) => "positive" | "negative" | null;
  evidence: (totals: AssessTotals, derived: DerivedForSignals) => string[];
}> = [];

interface AssessTotals {
  impressions: number | null;
  clicks: number | null;
  visits: number | null;
  leads: number | null;
  conversions: number | null;
  revenue: number | null;
  cost: number | null;
}
interface DerivedForSignals {
  ctr: number | null;
  conversionRate: number | null;
  profit: number | null;
  roi: number | null;
}

/**
 * Derive learning signals from recorded + derived data and the sufficiency
 * level. Signals are ONLY produced when sufficiency is at least LOW_SIGNAL and
 * the underlying metric was actually recorded. Zero is a real measurement
 * (negative signal); missing is not (no signal).
 */
export function deriveLearningSignals(input: {
  sufficiency: SufficiencyAssessment;
  totals: AssessTotals;
  derived: DerivedForSignals;
  dataClass: "REAL_DATA" | "ESTIMATED_DATA" | "MIXED";
  decision: "WIN" | "ITERATE" | "STOP" | "INSUFFICIENT_DATA";
}): LearningSignal[] {
  const { sufficiency, totals, derived, dataClass } = input;
  if (sufficiency.level === "INSUFFICIENT") {
    return [
      {
        key: "INSUFFICIENT_EXPERIMENT_DATA",
        basis: sufficiency.basis,
        dataClass,
        evidence: [`${sufficiency.factors.recordCount} recorded period(s)`],
      },
    ];
  }

  void POSITIVE_NEGATIVE_PAIRS;
  const signals: LearningSignal[] = [];
  const push = (key: LearningSignalKey, basis: string, evidence: string[]) =>
    signals.push({ key, basis, dataClass, evidence });

  // Demand: impressions/clicks are the demand proxies actually measured.
  if (totals.clicks !== null && totals.impressions !== null && totals.impressions > 0) {
    const ctr = derived.ctr;
    if (ctr !== null && ctr >= 0.02) {
      push("POSITIVE_DEMAND_SIGNAL", `CTR ${(ctr * 100).toFixed(2)}% at or above the 2% demand threshold.`, [
        `${totals.clicks} clicks from ${totals.impressions} impressions`,
      ]);
    } else if (ctr !== null && ctr < 0.01) {
      push("NEGATIVE_DEMAND_SIGNAL", `CTR ${(ctr * 100).toFixed(2)}% below the 1% weak-demand threshold.`, [
        `${totals.clicks} clicks from ${totals.impressions} impressions`,
      ]);
    }
  }

  // Conversion: explicit recorded conversions only.
  if (totals.conversions !== null) {
    if (totals.conversions >= SUFFICIENCY_THRESHOLDS.MIN_CONVERSIONS_MEANINGFUL) {
      push(
        "POSITIVE_CONVERSION_SIGNAL",
        `${totals.conversions} recorded conversions meet the ≥${SUFFICIENCY_THRESHOLDS.MIN_CONVERSIONS_MEANINGFUL} meaningful threshold.`,
        [`${totals.conversions} conversions over ${sufficiency.factors.recordCount} period(s)`],
      );
    } else if (totals.conversions === 0 && sufficiency.level !== "LOW_SIGNAL") {
      push("NEGATIVE_CONVERSION_SIGNAL", "Zero conversions were recorded across measured traffic.", [
        `0 conversions over ${sufficiency.factors.recordCount} period(s)`,
        totals.impressions !== null ? `${totals.impressions} impressions` : "impressions not recorded",
      ]);
    }
  }

  // Monetization: recorded revenue only.
  if (totals.revenue !== null) {
    if (totals.revenue >= SUFFICIENCY_THRESHOLDS.MIN_REVENUE_MEANINGFUL) {
      push("POSITIVE_MONETIZATION_SIGNAL", `Recorded revenue ${totals.revenue.toFixed(2)} meets the meaningful threshold.`, [
        `${totals.revenue.toFixed(2)} recorded revenue`,
      ]);
    } else if (totals.revenue === 0 && sufficiency.level !== "LOW_SIGNAL") {
      push("NEGATIVE_MONETIZATION_SIGNAL", "Zero recorded revenue despite measured traffic/cost.", [
        "0 recorded revenue",
      ]);
    }
  }

  // Unit economics: recorded profit/ROI.
  if (derived.profit !== null && derived.roi !== null) {
    if (derived.profit > 0 && derived.roi >= 0.2) {
      push("POSITIVE_UNIT_ECONOMICS_SIGNAL", `Profit ${derived.profit.toFixed(2)} with ROI ${derived.roi.toFixed(2)}.`, [
        `revenue ${totals.revenue?.toFixed(2) ?? "n/a"} − cost ${totals.cost?.toFixed(2) ?? "n/a"}`,
      ]);
    } else if (derived.profit < 0) {
      push("NEGATIVE_UNIT_ECONOMICS_SIGNAL", `Recorded loss of ${Math.abs(derived.profit).toFixed(2)}.`, [
        `revenue ${totals.revenue?.toFixed(2) ?? "n/a"} − cost ${totals.cost?.toFixed(2) ?? "n/a"}`,
      ]);
    }
  }

  return signals.length
    ? signals
    : [
        {
          key: "INSUFFICIENT_EXPERIMENT_DATA",
          basis: "Recorded data did not meet any signal rule; no inference is drawn.",
          dataClass,
          evidence: [],
        },
      ];
}

/** Outcome roll-up for one experiment. */
export function outcomeFromSignals(signals: LearningSignal[]): ExperimentLearningContract["outcome"] {
  const insufficient = signals.some((s) => s.key === "INSUFFICIENT_EXPERIMENT_DATA");
  if (insufficient) return "INSUFFICIENT";
  const positives = signals.filter((s) => s.key.startsWith("POSITIVE")).length;
  const negatives = signals.filter((s) => s.key.startsWith("NEGATIVE")).length;
  if (positives > 0 && negatives > 0) return "MIXED";
  if (positives > 0) return "POSITIVE";
  if (negatives > 0) return "NEGATIVE";
  return "INSUFFICIENT";
}

export const EXPERIMENT_INFLUENCE_CAP = 10;
export const ESTIMATED_DATA_WEIGHT = 0.3;
export const CONTRADICTION_PENALTIES = {
  mixedExperiments: 3,
  experimentContradictsResearch: 5,
} as const;
/** Sufficiency → share of the influence cap a positive/negative outcome may use. */
export const SUFFICIENCY_WEIGHTS: Record<SufficiencyLevel, number> = {
  INSUFFICIENT: 0,
  LOW_SIGNAL: 0.25,
  MEANINGFUL_SIGNAL: 0.6,
  STRONG_SIGNAL: 1,
};

export interface RankingAdjustment {
  /** Bounded delta applied to the research score (may be negative). */
  delta: number;
  /** Explanation of every contributing factor. */
  explanation: string[];
  signals: LearningSignal[];
  sufficiency: SufficiencyAssessment;
  evidenceQuality: "REAL_DATA" | "ESTIMATED_DATA" | "MIXED";
  contradiction: "NONE" | "MIXED_EXPERIMENT_EVIDENCE" | "EXPERIMENT_CONTRADICTS_RESEARCH";
  confidence: number;
}

/**
 * Compute the bounded ranking adjustment for ONE experiment's feedback.
 * Deterministic; every component is explained.
 */
export function computeExperimentRankingImpact(input: {
  contract: ExperimentLearningContract;
  totals: AssessTotals;
  derived: DerivedForSignals;
  sufficiency: SufficiencyAssessment;
  signals: LearningSignal[];
  dataClass: "REAL_DATA" | "ESTIMATED_DATA" | "MIXED";
  researchConclusion: string | null;
}): RankingAdjustment {
  const { sufficiency, signals, dataClass, totals, derived, researchConclusion } = input;
  const explanation: string[] = [];

  const outcome = outcomeFromSignals(signals);
  const positives = signals.filter((s) => s.key.startsWith("POSITIVE"));
  const negatives = signals.filter((s) => s.key.startsWith("NEGATIVE"));

  // Evidence quality dampens estimated data.
  const qualityWeight = dataClass === "REAL_DATA" ? 1 : dataClass === "ESTIMATED_DATA" ? ESTIMATED_DATA_WEIGHT : 1 - (1 - ESTIMATED_DATA_WEIGHT) / 2;

  let direction = 0;
  if (positives.length > negatives.length) direction = 1;
  else if (negatives.length > positives.length) direction = -1;

  const magnitude = EXPERIMENT_INFLUENCE_CAP * SUFFICIENCY_WEIGHTS[sufficiency.level] * qualityWeight;
  const delta = Number((direction * magnitude).toFixed(1));
  if (direction !== 0) {
    explanation.push(
      `${direction > 0 ? "+" : ""}${delta} from experiment evidence: ${positives.length} positive and ${negatives.length} negative signal(s) at ${sufficiency.level.toLowerCase().replace("_", " ")} sufficiency (${dataClass.toLowerCase().replace("_", " ")}).`,
    );
  } else if (sufficiency.level === "INSUFFICIENT") {
    explanation.push("Insufficient recorded experiment data; no ranking impact is applied.");
  } else if (signals.length) {
    explanation.push("No net ranking change: signals balance out or none were strong enough to apply.");
  }

  // Contradiction detection (explicit, never hidden).
  let contradiction: RankingAdjustment["contradiction"] = "NONE";
  const hasNegative = negatives.length > 0;
  const researchPositive = researchConclusion === "VALIDATED" || researchConclusion === "PROMISING";
  if (positives.length > 0 && negatives.length > 0) {
    contradiction = "MIXED_EXPERIMENT_EVIDENCE";
    explanation.push(`MIXED_EXPERIMENT_EVIDENCE: ${positives.map((s) => s.key).join(", ")} alongside ${negatives.map((s) => s.key).join(", ")}.`);
  } else if (researchPositive && negatives.length > 0) {
    contradiction = "EXPERIMENT_CONTRADICTS_RESEARCH";
    explanation.push(`Experiment contradicts the research conclusion (${researchConclusion}); uncertainty is preserved, research evidence is not discarded.`);
  }

  // Learning confidence: sufficiency × evidence quality × consistency (0-1).
  const consistency = signals.length === 0 ? 0 : positives.length === 0 || negatives.length === 0 ? 1 : 0.4;
  const confidence = Number(
    Math.min(
      1,
      SUFFICIENCY_WEIGHTS[sufficiency.level] *
        (dataClass === "REAL_DATA" ? 1 : dataClass === "ESTIMATED_DATA" ? ESTIMATED_DATA_WEIGHT : 0.65) *
        (0.5 + 0.5 * consistency),
    ).toFixed(2),
  );

  void totals;
  void derived;

  return {
    delta,
    explanation,
    signals,
    sufficiency,
    evidenceQuality: dataClass,
    contradiction,
    confidence,
  };
}

/** Aggregate several experiments' adjustments into one bounded opportunity-level impact. */
export function aggregateExperimentImpacts(
  adjustments: RankingAdjustment[],
): {
  delta: number;
  explanation: string[];
  contradiction: RankingAdjustment["contradiction"];
  experimentConfidence: number;
  experimentCount: number;
  completedCount: number;
} {
  if (adjustments.length === 0) {
    return {
      delta: 0,
      explanation: ["No completed experiment feedback exists for this opportunity."],
      contradiction: "NONE",
      experimentConfidence: 0,
      experimentCount: 0,
      completedCount: 0,
    };
  }

  const explanation: string[] = [];
  // Conflicting outcomes stay visible: net delta is the sum of per-experiment
  // bounded deltas, but a MIXED flag is raised when directions disagree.
  const directions = adjustments.map((a) => Math.sign(a.delta));
  const hasPositive = directions.some((d) => d > 0);
  const hasNegative = directions.some((d) => d < 0);
  const anyMixed = adjustments.some((a) => a.contradiction === "MIXED_EXPERIMENT_EVIDENCE");

  let contradiction: RankingAdjustment["contradiction"] = "NONE";
  if (hasPositive && hasNegative) {
    contradiction = "MIXED_EXPERIMENT_EVIDENCE";
    explanation.push(
      `MIXED_EXPERIMENT_EVIDENCE across experiments: ${adjustments.filter((a) => a.delta > 0).length} positive vs ${adjustments.filter((a) => a.delta < 0).length} negative — neither is treated as market truth.`,
    );
  } else if (anyMixed || adjustments.some((a) => a.contradiction === "EXPERIMENT_CONTRADICTS_RESEARCH")) {
    contradiction = "EXPERIMENT_CONTRADICTS_RESEARCH";
  }

  // Bounded aggregation: cap the SUM so many small experiments cannot swamp
  // research evidence either.
  const rawDelta = adjustments.reduce((sum, a) => sum + a.delta, 0);
  const delta = Number(Math.max(-EXPERIMENT_INFLUENCE_CAP, Math.min(EXPERIMENT_INFLUENCE_CAP, rawDelta)).toFixed(1));
  if (Math.abs(rawDelta) > EXPERIMENT_INFLUENCE_CAP) {
    explanation.push(`Aggregate experiment influence capped at ±${EXPERIMENT_INFLUENCE_CAP} (raw ${rawDelta.toFixed(1)}).`);
  }
  for (const adjustment of adjustments) explanation.push(...adjustment.explanation);

  // Opportunity-level experiment confidence: evidence-weighted mean.
  const totalWeight = adjustments.reduce((sum, a) => sum + Math.max(a.confidence, 0.05), 0);
  const experimentConfidence = Number(
    (adjustments.reduce((sum, a) => sum + a.confidence * Math.max(a.confidence, 0.05), 0) / totalWeight).toFixed(2),
  );

  return {
    delta,
    explanation,
    contradiction,
    experimentConfidence,
    experimentCount: adjustments.length,
    completedCount: adjustments.filter((a) => a.sufficiency.level !== "INSUFFICIENT").length,
  };
}

/** Validation-context classification combining research + experiment evidence. */
export type ValidationContext =
  | "RESEARCH_SUPPORTED"
  | "EXPERIMENT_SUPPORTED"
  | "BOTH_SUPPORTED"
  | "CONTRADICTED"
  | "INSUFFICIENT";

export function classifyValidationContext(input: {
  researchConclusion: string | null;
  experimentDelta: number;
  experimentCount: number;
}): ValidationContext {
  const researchPositive = input.researchConclusion === "VALIDATED" || input.researchConclusion === "PROMISING";
  const researchNegative = input.researchConclusion === "REJECTED" || input.researchConclusion === "CONTRADICTED";
  const experimentPositive = input.experimentDelta > 0;
  const experimentNegative = input.experimentDelta < 0;

  if (researchPositive && experimentPositive) return "BOTH_SUPPORTED";
  if (researchPositive && experimentNegative) return "CONTRADICTED";
  if (researchNegative && experimentPositive) return "EXPERIMENT_SUPPORTED";
  if (researchNegative && experimentNegative) return "CONTRADICTED";
  if (researchPositive) return "RESEARCH_SUPPORTED";
  if (experimentPositive || experimentNegative) return "EXPERIMENT_SUPPORTED";
  if (researchNegative) return "CONTRADICTED";
  return "INSUFFICIENT";
}

/** Merge research + experiment confidence WITHOUT collapsing into the score. */
export function combineConfidence(input: {
  researchConfidence: number | null; // 0-1 or 0-100 from research runs
  experimentConfidence: number; // 0-1 from aggregateExperimentImpacts
  experimentCount: number;
}): number {
  const research = input.researchConfidence === null ? null : input.researchConfidence > 1 ? input.researchConfidence / 100 : input.researchConfidence;
  if (research === null) return Number(input.experimentConfidence.toFixed(2));
  if (input.experimentCount === 0) return Number(research.toFixed(2));
  // Weighted blend: research remains the base; experiments add evidence but
  // can never reduce measured confidence below the research floor.
  const blend = research * 0.6 + input.experimentConfidence * 0.4;
  return Number(Math.max(blend, research * 0.8).toFixed(2));
}

/**
 * Build the versioned learning contract from already-computed pieces (kept as
 * a pure function so persistence and API layers share one shape).
 */
export function buildLearningContract(input: {
  opportunityId: string;
  experimentId: string;
  measurementPeriod: { from: string | null; to: string | null };
  totals: AssessTotals;
  derived: DerivedForSignals;
  sufficiency: SufficiencyAssessment;
  signals: LearningSignal[];
  dataClass: "REAL_DATA" | "ESTIMATED_DATA" | "MIXED";
  decision: "WIN" | "ITERATE" | "STOP" | "INSUFFICIENT_DATA";
  researchImplications: string[];
  rankingImpact: { eligible: boolean; reason: string; maxContribution: number };
  generatedAt: string;
}): ExperimentLearningContract {
  return {
    feedbackVersion: 2,
    opportunityId: input.opportunityId,
    experimentId: input.experimentId,
    experimentEvidence: {
      dataClass: input.dataClass,
      measurementPeriod: input.measurementPeriod,
      metrics: input.totals,
      derived: input.derived,
    },
    outcome: outcomeFromSignals(input.signals),
    decision: input.decision,
    learningSignals: input.signals,
    researchImplications: input.researchImplications,
    confidence: Number(
      Math.min(
        1,
        SUFFICIENCY_WEIGHTS[input.sufficiency.level] * (input.dataClass === "REAL_DATA" ? 1 : input.dataClass === "ESTIMATED_DATA" ? ESTIMATED_DATA_WEIGHT : 0.65),
      ).toFixed(2),
    ),
    rankingImpact: input.rankingImpact,
    generatedAt: input.generatedAt,
  };
}
