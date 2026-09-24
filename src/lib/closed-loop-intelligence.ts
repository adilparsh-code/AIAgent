import type { ExperimentLearningContract } from "./experiment-learning";

/** Small provider/service-neutral view consumed from the existing ranking service. */
export interface ClosedLoopRankingView {
  experimentDelta: number;
  newScore: number;
  previousScore: number;
  changed: boolean;
  contradiction: string;
  validationContext: string;
  explanation: string[];
}

export type ClosedLoopMeasurementState = "MEASURED_REAL_DATA" | "MEASURED_ESTIMATED_DATA" | "NOT_MEASURED";
export type ClosedLoopLearningState = "LEARNED" | "CONTRADICTORY" | "INSUFFICIENT_DATA";
export type ClosedLoopReassessmentState = "REASSESSED" | "NO_CHANGE" | "NOT_REASSESSED";

export interface ClosedLoopAssessment {
  version: 1;
  experimentId: string;
  opportunityId: string;
  measurementState: ClosedLoopMeasurementState;
  learningState: ClosedLoopLearningState;
  reassessmentState: ClosedLoopReassessmentState;
  prioritizationChanged: boolean;
  outcome: ExperimentLearningContract["outcome"];
  decision: ExperimentLearningContract["decision"];
  confidence: number;
  contradiction: string;
  explanation: string[];
}

/**
 * Compose the Phase 22 loop around the existing deterministic contracts.
 * This module adds no score, revenue, or success inference of its own.
 */
export function assessClosedLoop(input: {
  learning: ExperimentLearningContract;
  ranking: ClosedLoopRankingView;
  rankingAvailable?: boolean;
}): ClosedLoopAssessment {
  const { learning, ranking } = input;
  const evidenceClass = learning.experimentEvidence.dataClass;
  const hasMeasurement = Object.values(learning.experimentEvidence.metrics).some((value) => value !== null);
  const measurementState: ClosedLoopMeasurementState = !hasMeasurement
    ? "NOT_MEASURED"
    : evidenceClass === "REAL_DATA"
      ? "MEASURED_REAL_DATA"
      : evidenceClass === "ESTIMATED_DATA"
        ? "MEASURED_ESTIMATED_DATA"
        : "NOT_MEASURED";
  const hasPositive = learning.learningSignals.some((signal) => signal.key.startsWith("POSITIVE"));
  const hasNegative = learning.learningSignals.some((signal) => signal.key.startsWith("NEGATIVE"));
  const learningState: ClosedLoopLearningState = learning.outcome === "INSUFFICIENT"
    ? "INSUFFICIENT_DATA"
    : hasPositive && hasNegative || learning.outcome === "MIXED"
      ? "CONTRADICTORY"
      : "LEARNED";
  const rankingAvailable = input.rankingAvailable ?? true;
  const reassessmentState: ClosedLoopReassessmentState = !rankingAvailable
    ? "NOT_REASSESSED"
    : ranking.changed
      ? "REASSESSED"
      : "NO_CHANGE";
  const explanation = [
    `Measurement: ${measurementState} from the persisted experiment metric series.`,
    `Learning: ${learningState}; recorded outcome ${learning.outcome} and decision ${learning.decision}.`,
    rankingAvailable
      ? `Reassessment: ${reassessmentState}; effective score ${ranking.previousScore.toFixed(1)} → ${ranking.newScore.toFixed(1)} with ${ranking.experimentDelta >= 0 ? "+" : ""}${ranking.experimentDelta.toFixed(1)} bounded experiment delta.`
      : "Reassessment: not available; ranking was not changed.",
    `Validation context: ${ranking.validationContext}. Contradiction: ${ranking.contradiction}.`,
    ...ranking.explanation,
  ];
  return {
    version: 1,
    experimentId: learning.experimentId,
    opportunityId: learning.opportunityId,
    measurementState,
    learningState,
    reassessmentState,
    prioritizationChanged: rankingAvailable && ranking.changed,
    outcome: learning.outcome,
    decision: learning.decision,
    confidence: learning.confidence,
    contradiction: ranking.contradiction,
    explanation,
  };
}
