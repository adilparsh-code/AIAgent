/**
 * Experiment prioritization (pure, deterministic).
 *
 * Decides which opportunities should receive experimentation attention first,
 * based ONLY on measurable persisted system state.
 *
 * This is explicitly NOT:
 * - investment advice, financial forecasting, or guaranteed-income prediction
 * - a "best/worst/winner/most profitable" opportunity ranking
 *
 * It is an OPERATIONAL attention queue. Every factor is explicit, weighted,
 * and explainable: each one returns the value it read, the weight applied, the
 * resulting contribution, and the persisted basis for that value. A factor
 * whose input is missing scores 0 and says so — values are never invented.
 *
 * Data-class rules (inherited, never relaxed):
 * - REAL_DATA may contribute to sufficiency.
 * - SAMPLE_DATA / ESTIMATED_DATA / UNKNOWN never count as real evidence.
 */

/** Explicit factor weights. Documented and centralized — no magic numbers. */
export const EXPERIMENT_PRIORITY_WEIGHTS = {
  /** How decision-ready the opportunity already is (0-100 decision score). */
  DECISION_READINESS: 20,
  /** Fewest open evidence gaps on the research side. */
  EVIDENCE_COMPLETENESS: 15,
  /** Recorded REAL_DATA experiment coverage (0 → 1). */
  REAL_DATA_COVERAGE: 20,
  /** An experiment row already exists to measure. */
  EXPERIMENT_AVAILABILITY: 10,
  /** Research is within the freshness threshold. */
  RESEARCH_FRESHNESS: 10,
  /** A persisted experiment decision exists (learning signal available). */
  LEARNING_SIGNAL: 10,
  /** The latest experiment measurement is within the freshness threshold. */
  EXPERIMENT_FRESHNESS: 10,
  /** No pending human approval is blocking the flow. */
  APPROVAL_FLOW: 5,
} as const;

/** Explicit penalty weights, subtracted from the weighted factor sum. */
export const EXPERIMENT_PRIORITY_PENALTIES = {
  /** Unresolved persisted contradictions require human review first. */
  CONTRADICTION: 25,
  /** A security/approval gate is blocking execution flow. */
  EXECUTION_BLOCKER: 15,
  /** A task is waiting on human approval. */
  APPROVAL_REQUIRED: 10,
  /** Stored research is older than the freshness threshold. */
  STALE_RESEARCH: 10,
  /** Experiment exists but REAL_DATA coverage is below the minimum. */
  INSUFFICIENT_REAL_DATA: 10,
} as const;

export const EXPERIMENT_PRIORITY_POLICY = {
  /** Recorded REAL_DATA periods required before data can inform a decision. */
  MIN_REAL_METRIC_PERIODS: 2,
  /** Days after which experiment measurements are considered stale. */
  EXPERIMENT_FRESHNESS_DAYS: 30,
  /** Points removed per open evidence gap (gaps are usually few). */
  POINTS_PER_EVIDENCE_GAP: 20,
  /** Clamp for the per-gap evidence completeness deduction. */
  MAX_EVIDENCE_GAP_DEDUCTION: 60,
} as const;

export type ExperimentPriorityFactorKey = keyof typeof EXPERIMENT_PRIORITY_WEIGHTS;
export type ExperimentPriorityPenaltyKey = keyof typeof EXPERIMENT_PRIORITY_PENALTIES;

/** One explainable factor (or penalty) contribution. */
export interface ExperimentPriorityFactor {
  key: ExperimentPriorityFactorKey | ExperimentPriorityPenaltyKey;
  kind: "FACTOR" | "PENALTY";
  /** Normalized 0-1 value read from persisted state (null when not persisted). */
  value: number | null;
  /** Weight (or penalty magnitude) applied, in points. */
  weight: number;
  /** Signed points this factor contributed to the final score. */
  contribution: number;
  /** Persisted fact this value came from. */
  basis: string;
}

/**
 * Neutral operational label. Never "best", "worst", "winner", "loser",
 * "profitable", or any financial claim.
 */
export type OperationalLabel =
  | "Requires research"
  | "Ready for validation"
  | "Ready for experiment"
  | "Experiment data insufficient"
  | "Needs measurement refresh"
  | "Ready for handoff"
  | "Execution approval pending"
  | "Review required"
  | "Blocked";

export interface OpportunityPriorityInput {
  opportunityId: string;
  /** 0-100 decision score from the decision engine (operational, not quality). */
  decisionScore: number;
  /** Open evidence gaps on the research side (count). */
  evidenceGapCount: number;
  /** Open validation gaps (count). */
  validationGapCount: number;
  /** Decision readiness state (verbatim). */
  decisionState: string;
  /** Experiment rows exist for this opportunity. */
  hasExperiment: boolean;
  /** Count of REAL_DATA experiment periods (estimated/sample never counted). */
  realMetricPeriods: number;
  /** Count of estimated experiment periods (reported, never sufficient). */
  estimatedMetricPeriods: number;
  /** Latest experiment measurement date (null when no metrics recorded). */
  lastExperimentMetricAt: Date | string | null;
  /** A persisted experiment decision exists → a learning signal is available. */
  hasLearningSignal: boolean;
  /** Research freshness kind from the readiness engine. */
  researchFreshnessKind: "NO_RESEARCH" | "STALE_RESEARCH" | "CURRENT_RESEARCH";
  /** Unresolved contradictions are persisted. */
  hasContradictions: boolean;
  /** A task is waiting on human approval. */
  requiresHumanApproval: boolean;
  /** A security/approval gate is blocking flow. */
  hasExecutionBlocker: boolean;
  /** True when the opportunity is hard-blocked (REJECTED / NOT_ALLOWED). */
  isBlocked: boolean;
  /** Data class of the opportunity itself. */
  dataClass: "REAL_DATA" | "AI_ESTIMATE" | "SAMPLE_DATA";
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

export interface OpportunityPriority {
  opportunityId: string;
  /** 0-100 operational attention score (NOT a quality/profitability score). */
  priorityScore: number;
  factors: ExperimentPriorityFactor[];
  /** Neutral operational label — never a financial/ranking claim. */
  label: OperationalLabel;
  /** Why this opportunity sits where it does (persisted basis). */
  reason: string;
  dataClass: "REAL_DATA" | "AI_ESTIMATE" | "SAMPLE_DATA";
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function daysBetween(from: Date | string, to: Date): number | null {
  const time = new Date(from).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.floor((to.getTime() - time) / (24 * 60 * 60 * 1000));
}

/**
 * Compute the operational priority for one opportunity. Deterministic: the
 * same persisted inputs always produce the same score, factors, and label.
 */
export function computeOpportunityPriority(input: OpportunityPriorityInput): OpportunityPriority {
  const now = input.now ?? new Date();
  const factors: ExperimentPriorityFactor[] = [];
  const add = (
    key: ExperimentPriorityFactorKey | ExperimentPriorityPenaltyKey,
    kind: "FACTOR" | "PENALTY",
    value: number | null,
    weight: number,
    basis: string,
  ) => {
    const contribution = kind === "PENALTY" ? -(weight * (value ?? 0)) : weight * (value ?? 0);
    factors.push({ key, kind, value, weight, contribution: Math.round(contribution * 100) / 100, basis });
  };

  /* ---------------- Factors ---------------- */
  add(
    "DECISION_READINESS",
    "FACTOR",
    clamp(input.decisionScore) / 100,
    EXPERIMENT_PRIORITY_WEIGHTS.DECISION_READINESS,
    `decision score ${Math.round(clamp(input.decisionScore))}/100 (${input.decisionState})`,
  );

  const evidenceGapValue = clamp(
    1 -
      Math.min(
        EXPERIMENT_PRIORITY_POLICY.MAX_EVIDENCE_GAP_DEDUCTION,
        (input.evidenceGapCount + input.validationGapCount) *
          EXPERIMENT_PRIORITY_POLICY.POINTS_PER_EVIDENCE_GAP,
      ) /
        100,
  );
  add(
    "EVIDENCE_COMPLETENESS",
    "FACTOR",
    evidenceGapValue,
    EXPERIMENT_PRIORITY_WEIGHTS.EVIDENCE_COMPLETENESS,
    `${input.evidenceGapCount} evidence gap(s), ${input.validationGapCount} validation gap(s)`,
  );

  // Only REAL_DATA contributes; estimated periods are reported, never scored.
  const realCoverage =
    input.realMetricPeriods <= 0
      ? 0
      : Math.min(1, input.realMetricPeriods / EXPERIMENT_PRIORITY_POLICY.MIN_REAL_METRIC_PERIODS);
  add(
    "REAL_DATA_COVERAGE",
    "FACTOR",
    realCoverage,
    EXPERIMENT_PRIORITY_WEIGHTS.REAL_DATA_COVERAGE,
    `${input.realMetricPeriods} REAL_DATA period(s) (${input.estimatedMetricPeriods} estimated period(s) excluded)`,
  );

  add(
    "EXPERIMENT_AVAILABILITY",
    "FACTOR",
    input.hasExperiment ? 1 : 0,
    EXPERIMENT_PRIORITY_WEIGHTS.EXPERIMENT_AVAILABILITY,
    input.hasExperiment ? "an experiment row exists" : "no experiment row exists yet",
  );

  add(
    "RESEARCH_FRESHNESS",
    "FACTOR",
    input.researchFreshnessKind === "CURRENT_RESEARCH" ? 1 : 0,
    EXPERIMENT_PRIORITY_WEIGHTS.RESEARCH_FRESHNESS,
    `research freshness is ${input.researchFreshnessKind}`,
  );

  add(
    "LEARNING_SIGNAL",
    "FACTOR",
    input.hasLearningSignal ? 1 : 0,
    EXPERIMENT_PRIORITY_WEIGHTS.LEARNING_SIGNAL,
    input.hasLearningSignal ? "a persisted experiment decision is available" : "no persisted experiment decision yet",
  );

  let experimentAgeDays: number | null = null;
  if (!input.lastExperimentMetricAt) {
    add(
      "EXPERIMENT_FRESHNESS",
      "FACTOR",
      0,
      EXPERIMENT_PRIORITY_WEIGHTS.EXPERIMENT_FRESHNESS,
      "no experiment measurement is persisted",
    );
  } else {
    experimentAgeDays = daysBetween(input.lastExperimentMetricAt, now);
    if (experimentAgeDays === null) {
      add(
        "EXPERIMENT_FRESHNESS",
        "FACTOR",
        0,
        EXPERIMENT_PRIORITY_WEIGHTS.EXPERIMENT_FRESHNESS,
        "the latest experiment measurement date is not parseable; treated as absent, never invented",
      );
    } else {
      add(
        "EXPERIMENT_FRESHNESS",
        "FACTOR",
        experimentAgeDays <= EXPERIMENT_PRIORITY_POLICY.EXPERIMENT_FRESHNESS_DAYS ? 1 : 0,
        EXPERIMENT_PRIORITY_WEIGHTS.EXPERIMENT_FRESHNESS,
        `latest experiment measurement is ${experimentAgeDays} day(s) old (threshold ${EXPERIMENT_PRIORITY_POLICY.EXPERIMENT_FRESHNESS_DAYS})`,
      );
    }
  }

  add(
    "APPROVAL_FLOW",
    "FACTOR",
    input.requiresHumanApproval || input.hasExecutionBlocker ? 0 : 1,
    EXPERIMENT_PRIORITY_WEIGHTS.APPROVAL_FLOW,
    input.requiresHumanApproval
      ? "a task is WAITING_APPROVAL"
      : input.hasExecutionBlocker
        ? "a task is BLOCKED by the security/approval model"
        : "no pending approval requirement",
  );

  /* ---------------- Penalties ---------------- */
  if (input.hasContradictions) {
    add("CONTRADICTION", "PENALTY", 1, EXPERIMENT_PRIORITY_PENALTIES.CONTRADICTION, "unresolved persisted contradictions require human review");
  }
  if (input.hasExecutionBlocker) {
    add("EXECUTION_BLOCKER", "PENALTY", 1, EXPERIMENT_PRIORITY_PENALTIES.EXECUTION_BLOCKER, "a task is BLOCKED by the security/approval model");
  }
  if (input.requiresHumanApproval) {
    add("APPROVAL_REQUIRED", "PENALTY", 1, EXPERIMENT_PRIORITY_PENALTIES.APPROVAL_REQUIRED, "a task is WAITING_APPROVAL");
  }
  if (input.researchFreshnessKind === "STALE_RESEARCH") {
    add("STALE_RESEARCH", "PENALTY", 1, EXPERIMENT_PRIORITY_PENALTIES.STALE_RESEARCH, "stored research is older than the freshness threshold");
  }
  if (input.hasExperiment && input.realMetricPeriods < EXPERIMENT_PRIORITY_POLICY.MIN_REAL_METRIC_PERIODS) {
    add(
      "INSUFFICIENT_REAL_DATA",
      "PENALTY",
      1,
      EXPERIMENT_PRIORITY_PENALTIES.INSUFFICIENT_REAL_DATA,
      `only ${input.realMetricPeriods} REAL_DATA period(s) recorded; at least ${EXPERIMENT_PRIORITY_POLICY.MIN_REAL_METRIC_PERIODS} are required`,
    );
  }

  const rawScore = factors.reduce((total, factor) => total + factor.contribution, 0);
  const priorityScore = Math.round(clamp(rawScore));

  /* ---------------- Neutral operational label + reason ---------------- */
  let label: OperationalLabel;
  let reason: string;
  if (input.isBlocked) {
    label = "Blocked";
    reason = "Opportunity is REJECTED or NOT_ALLOWED; it cannot receive experimentation attention.";
  } else if (input.hasContradictions) {
    label = "Review required";
    reason = "Unresolved persisted contradictions must be reviewed by a human before experimentation.";
  } else if (input.requiresHumanApproval) {
    label = "Execution approval pending";
    reason = "A task is waiting for human approval before flow can continue.";
  } else if (input.researchFreshnessKind === "NO_RESEARCH") {
    label = "Requires research";
    reason = "No completed research run exists yet.";
  } else if (input.researchFreshnessKind === "STALE_RESEARCH") {
    label = "Needs measurement refresh";
    reason = "Stored research is older than the freshness threshold; refresh before experimenting.";
  } else if (input.evidenceGapCount > 0 || input.validationGapCount > 0) {
    label = "Ready for validation";
    reason = `${input.evidenceGapCount} evidence gap(s) and ${input.validationGapCount} validation gap(s) remain open.`;
  } else if (!input.hasExperiment) {
    label = "Ready for experiment";
    reason = "Research and validation are sufficient and no experiment exists yet.";
  } else if (input.realMetricPeriods < EXPERIMENT_PRIORITY_POLICY.MIN_REAL_METRIC_PERIODS) {
    label = "Experiment data insufficient";
    reason = `Experiment has ${input.realMetricPeriods} REAL_DATA period(s) (${input.estimatedMetricPeriods} estimated excluded); at least ${EXPERIMENT_PRIORITY_POLICY.MIN_REAL_METRIC_PERIODS} are required.`;
  } else if (experimentAgeDays !== null && experimentAgeDays > EXPERIMENT_PRIORITY_POLICY.EXPERIMENT_FRESHNESS_DAYS) {
    label = "Needs measurement refresh";
    reason = `Latest REAL_DATA measurement is ${experimentAgeDays} day(s) old.`;
  } else {
    label = "Ready for handoff";
    reason = "Evidence, validation, and REAL_DATA experiment coverage are sufficient.";
  }

  return {
    opportunityId: input.opportunityId,
    priorityScore,
    factors,
    label,
    reason,
    dataClass: input.dataClass,
  };
}

/**
 * Rank opportunities for experimentation attention. Deterministic ordering:
 * score descending, then opportunityId ascending as a stable tie-break.
 * Neutral operational ordering only — never a quality/profitability ranking.
 */
export function prioritizeOpportunities(inputs: OpportunityPriorityInput[]): OpportunityPriority[] {
  return inputs
    .map((input) => computeOpportunityPriority(input))
    .sort((a, b) => b.priorityScore - a.priorityScore || a.opportunityId.localeCompare(b.opportunityId));
}
