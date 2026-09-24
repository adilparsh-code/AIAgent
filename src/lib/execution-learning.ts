/**
 * Phase 19 — execution measurement and learning projection (pure).
 *
 * Reuses the existing experiment sufficiency and signal contracts. A
 * completed execution is not a business result: without source-backed metrics
 * the result is NOT_MEASURED and can never be POSITIVE_SIGNAL.
 */
import {
  assessExperimentSufficiency,
  deriveLearningSignals,
  opportunityLearningSignalFromOutcome,
  outcomeFromSignals,
  type OpportunityLearningSignal,
  type SufficiencyAssessment,
} from "@/lib/experiment-learning";

export const EXECUTION_MEASUREMENT_METRICS = [
  "impressions",
  "clicks",
  "visits",
  "leads",
  "responses",
  "conversions",
  "revenue",
  "cost",
  "completionRate",
  "engagement",
] as const;

export type ExecutionMetricName = (typeof EXECUTION_MEASUREMENT_METRICS)[number];
export type ExecutionMeasurementClass = "REAL_DATA" | "ESTIMATED_DATA" | "SAMPLE_DATA" | "NOT_MEASURED";

export interface ExecutionMetricObservation {
  metric: ExecutionMetricName;
  value: number | null;
  dataClass: ExecutionMeasurementClass;
  source: string;
  observedAt: string;
}

export interface ExecutionLearningResult {
  measurementStatus: "MEASURED" | "NOT_MEASURED";
  dataClass: ExecutionMeasurementClass;
  observedMetrics: Partial<Record<ExecutionMetricName, number>>;
  baseline: { value: number | null; dataClass: "REAL_DATA" | "NOT_MEASURED"; source: string | null; measuredAt: string | null };
  observedChange: number | null;
  dataSufficiency: SufficiencyAssessment["level"];
  sufficiencyBasis: string;
  contradictions: string[];
  learningSignal: OpportunityLearningSignal;
  nextAction: string;
  basis: string[];
}

function add(totals: Record<string, number | null>, metric: string, value: number | null): void {
  if (value === null) return;
  totals[metric] = (totals[metric] ?? 0) + value;
}

/** Build an honest learning result from actual observations only. */
export function deriveExecutionLearning(input: {
  opportunityId: string;
  observations: ExecutionMetricObservation[];
  baseline?: { value: number; source: string; measuredAt: string } | null;
  now?: Date;
}): ExecutionLearningResult {
  const observations = input.observations.filter((item) => EXECUTION_MEASUREMENT_METRICS.includes(item.metric));
  const real = observations.filter((item) => item.dataClass === "REAL_DATA" && item.source.trim() && item.value !== null);
  const nonReal = observations.filter((item) => item.dataClass !== "REAL_DATA" || !item.source.trim());
  const totals: Record<string, number | null> = {};
  for (const item of real) add(totals, item.metric, item.value);
  const observedMetrics = Object.fromEntries(Object.entries(totals).filter(([, value]) => value !== null)) as Partial<Record<ExecutionMetricName, number>>;
  const baseline = input.baseline && Number.isFinite(input.baseline.value)
    ? { value: input.baseline.value, dataClass: "REAL_DATA" as const, source: input.baseline.source, measuredAt: input.baseline.measuredAt }
    : { value: null, dataClass: "NOT_MEASURED" as const, source: null, measuredAt: null };
  const primary = real.find((item) => item.metric === "conversions") ?? real[0];
  const observedChange = primary && baseline.value !== null ? (primary.value ?? 0) - baseline.value : null;
  const sufficiency = assessExperimentSufficiency({
    recordCount: real.length,
    totals: {
      impressions: observedMetrics.impressions ?? null,
      clicks: observedMetrics.clicks ?? null,
      visits: observedMetrics.visits ?? null,
      leads: observedMetrics.leads ?? null,
      conversions: observedMetrics.conversions ?? null,
      revenue: observedMetrics.revenue ?? null,
      cost: observedMetrics.cost ?? null,
    },
    estimatedRecordCount: nonReal.length,
  });
  const signals = deriveLearningSignals({
    sufficiency,
    totals: {
      impressions: observedMetrics.impressions ?? null,
      clicks: observedMetrics.clicks ?? null,
      visits: observedMetrics.visits ?? null,
      leads: observedMetrics.leads ?? null,
      conversions: observedMetrics.conversions ?? null,
      revenue: observedMetrics.revenue ?? null,
      cost: observedMetrics.cost ?? null,
    },
    derived: { ctr: null, conversionRate: null, profit: null, roi: null },
    dataClass: real.length > 0 ? "REAL_DATA" : nonReal.length > 0 ? "ESTIMATED_DATA" : "MIXED",
    decision: sufficiency.level === "INSUFFICIENT" ? "INSUFFICIENT_DATA" : "ITERATE",
  });
  const outcome = outcomeFromSignals(signals);
  const learningSignal = real.length === 0 ? "INSUFFICIENT_DATA" : opportunityLearningSignalFromOutcome(outcome);
  const measurementStatus = real.length > 0 ? "MEASURED" : "NOT_MEASURED";
  const dataClass: ExecutionMeasurementClass = real.length > 0 ? "REAL_DATA" : nonReal.length > 0 ? "ESTIMATED_DATA" : "NOT_MEASURED";
  return {
    measurementStatus,
    dataClass,
    observedMetrics,
    baseline,
    observedChange,
    dataSufficiency: sufficiency.level,
    sufficiencyBasis: sufficiency.basis,
    contradictions: nonReal.length > 0 && real.length > 0 ? ["Non-real observations were retained for reporting but excluded from learning."] : [],
    learningSignal,
    nextAction: real.length === 0 ? "RECORD_MORE_DATA" : learningSignal === "POSITIVE_SIGNAL" ? "REASSESS_PRIORITY" : "RECORD_MORE_DATA",
    basis: [
      `${real.length} source-backed REAL_DATA observation(s) and ${nonReal.length} excluded non-real/unprovenanced observation(s).`,
      baseline.value === null ? "No real baseline was supplied; observed change remains NOT_MEASURED." : `Observed change is ${observedChange}; it is not a prediction.`,
      "Execution completion alone does not establish a business outcome.",
    ],
  };
}
