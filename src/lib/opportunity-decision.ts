/**
 * Opportunity Decision Pipeline (pure, deterministic).
 *
 * Answers: "does the currently available persisted evidence support the NEXT
 * operational step?" It is NOT a profitability prediction — it never claims
 * an opportunity will make money, and it never overrides existing scores.
 *
 * Composition, not duplication: the decision engine sits ON TOP of the
 * existing Phase 10 readiness engine (`opportunity-readiness.ts`) and the
 * cross-run research intelligence (`research-history.ts`). It adds the
 * operational layer they intentionally do not own:
 *
 *   Research Intelligence → Readiness → Validation → Experiment Learning
 *     → Handoff State → Execution Eligibility → Final Decision
 *
 * Honesty rules (inherited and extended):
 * - Every conclusion cites the persisted signal it is derived from.
 * - SAMPLE / ESTIMATED / SIMULATED data is NEVER treated as REAL_DATA.
 * - No external APIs, no API keys, no network, no fabricated market data.
 * - The decision engine is advisory: it performs no external side effects and
 *   cannot publish, send, spend, or execute anything.
 */
import {
  calculateOpportunityReadiness,
  READINESS_POLICY,
  type OpportunityReadiness,
  type ReadinessExperimentInput,
  type ReadinessOpportunityInput,
  type ReadinessResearchRunInput,
  type ReadinessValidationInput,
} from "@/lib/opportunity-readiness";
import { recommendNextAction, type NextActionRecommendation } from "@/lib/opportunity-next-action";
import { deriveOpportunityLifecycle } from "@/lib/opportunity-lifecycle";

/** Allowed decision values (closed set). */
export const DECISION_STATES = [
  "RESEARCH_MORE",
  "VALIDATE",
  "RUN_EXPERIMENT",
  "IMPROVE_EXPERIMENT",
  "REVIEW_CONFLICT",
  "HANDOFF_READY",
  "EXECUTION_READY",
  "HUMAN_REVIEW",
  "BLOCKED",
] as const;

export type OpportunityDecisionState = (typeof DECISION_STATES)[number];

/** Policy for the decision layer (extends the readiness policy, no overrides). */
export const DECISION_POLICY = {
  /**
   * When experiment REAL_DATA periods contradict the research-supported
   * commercial-intent signal, this ratio of estimated→real periods below
   * which estimated data may still be reported as present-but-excluded.
   * Estimated data NEVER informs the decision; this only bounds reporting.
   */
  MAX_REPORTED_ESTIMATED_PERIODS: 60,
  /**
   * Real-data periods required before a completed experiment's outcome can
   * contradict the research signal (mirrors readiness MIN_REAL_METRIC_PERIODS;
   * re-declared here so the decision layer is independently configurable).
   */
  MIN_REAL_METRIC_PERIODS_FOR_CONTRADICTION: READINESS_POLICY.MIN_REAL_METRIC_PERIODS,
} as const;

/** Which decision layers were involved in producing the decision. */
export interface DecisionInputs {
  /** True when the readiness engine produced a usable state. */
  readinessApplied: boolean;
  /** True when a persisted validation summary informed the decision. */
  validationApplied: boolean;
  /** True when persisted experiment metric data informed the decision. */
  experimentApplied: boolean;
  /** True when a persisted handoff row informed the decision. */
  handoffApplied: boolean;
  /** True when persisted execution state informed the decision. */
  executionApplied: boolean;
  /** True when stale research was a decisive factor. */
  freshnessApplied: boolean;
}

/** One structured gap entry, grouped by pipeline layer. */
export interface DecisionGap {
  layer: "EVIDENCE" | "VALIDATION" | "EXPERIMENT" | "EXECUTION";
  code: string;
  detail: string;
}

export interface OpportunityDecision {
  opportunityId: string;
  decision: OpportunityDecisionState;
  /** 0-100 deterministic decision score (operational, NOT quality). */
  decisionScore: number;
  /** The readiness state this decision is derived from. */
  readinessState: OpportunityReadiness["readinessState"];
  /** 0-100 confidence from persisted validation (0 without validation). */
  confidence: number;
  blockers: string[];
  evidenceGaps: DecisionGap[];
  validationGaps: DecisionGap[];
  experimentGaps: DecisionGap[];
  executionGaps: DecisionGap[];
  recommendedAction: NextActionRecommendation;
  explanation: string[];
  /** REAL_DATA | AI_ESTIMATE | SAMPLE_DATA (never claims more than the inputs). */
  dataClass: "REAL_DATA" | "AI_ESTIMATE" | "SAMPLE_DATA";
  generatedAt: string;
  /** Which layers actually informed this decision (audit trail). */
  decisionInputs: DecisionInputs;
  /** Derived lifecycle position (see opportunity-lifecycle.ts). */
  lifecycleState: string;
}

/* ------------------------------------------------------------------ */
/* Execution eligibility inputs (persisted execution state only)       */
/* ------------------------------------------------------------------ */

export interface DecisionExecutionInput {
  /** Latest persisted handoff status (null when no handoff exists). */
  handoffStatus: string | null;
  /** True when an AgentTask exists that is actively running. */
  hasRunningAgentTask: boolean;
  /** True when any completed AgentExecution exists for this opportunity. */
  hasCompletedExecution: boolean;
  /**
   * True when a task is waiting for human approval — an approval/security
   * requirement a person must satisfy (Rule J).
   */
  hasAwaitingApprovalTask: boolean;
  /** True when a task was BLOCKED by the security/approval model. */
  hasBlockedTask: boolean;
}

export interface CalculateOpportunityDecisionInput {
  opportunity: ReadinessOpportunityInput;
  researchRuns: ReadinessResearchRunInput[];
  validation: ReadinessValidationInput | null;
  experiments: ReadinessExperimentInput[];
  execution: DecisionExecutionInput;
  /** Injectable clock for deterministic tests; defaults to now. */
  now?: Date;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function gap(
  layer: DecisionGap["layer"],
  code: string,
  detail: string,
): DecisionGap {
  return { layer, code, detail };
}

function isContradicted(status: string): boolean {
  return status === "MIXED" || status === "CONTRADICTED";
}

/* ------------------------------------------------------------------ */
/* Core engine                                                         */
/* ------------------------------------------------------------------ */

export function calculateOpportunityDecision(
  input: CalculateOpportunityDecisionInput,
): OpportunityDecision {
  const now = input.now ?? new Date();
  const { opportunity, validation, experiments, execution } = input;

  // Compose with the existing readiness engine — never re-derive its rules.
  const readiness = calculateOpportunityReadiness({
    opportunity,
    researchRuns: input.researchRuns,
    validation,
    experiments,
    now,
  });

  const explanation: string[] = [
    `Derived from readiness state ${readiness.readinessState} (computed from persisted data only).`,
  ];
  const blockers: string[] = [...readiness.blockers];

  /* ---------------- Normalized gap sets ---------------- */
  const evidenceGaps: DecisionGap[] = readiness.missingEvidence
    .filter((item) => item.area !== "EXPERIMENT_DATA")
    .map((item) => gap("EVIDENCE", item.area, item.reason));
  const experimentGaps: DecisionGap[] = readiness.missingEvidence
    .filter((item) => item.area === "EXPERIMENT_DATA")
    .map((item) => gap("EXPERIMENT", "EXPERIMENT_DATA", item.reason));
  const validationGaps: DecisionGap[] = [];
  const executionGaps: DecisionGap[] = [];

  // Validation is a distinct layer: when research exists but validation was
  // never persisted, that is a validation-layer gap, not an evidence gap.
  if (input.researchRuns.length > 0 && !validation) {
    validationGaps.push(gap("VALIDATION", "VALIDATION_MISSING", "Research runs exist but no validation summary is persisted"));
  }

  /* ---------------- Experiment summary (REAL_DATA only) ---------------- */
  let realMetricPeriods = 0;
  let estimatedMetricPeriods = 0;
  for (const experiment of experiments) {
    for (const metric of experiment.metrics) {
      if (metric.dataClass === "REAL_DATA") realMetricPeriods += 1;
      else if (metric.dataClass === "ESTIMATED_DATA") estimatedMetricPeriods += 1;
      // SAMPLE_DATA / SIMULATED / unknown classes are ignored entirely.
    }
  }
  const experimentDataClass: "NONE" | "ESTIMATED_DATA" | "REAL_DATA" =
    realMetricPeriods > 0 ? "REAL_DATA" : estimatedMetricPeriods > 0 ? "ESTIMATED_DATA" : "NONE";

  if (estimatedMetricPeriods > DECISION_POLICY.MAX_REPORTED_ESTIMATED_PERIODS) {
    explanation.push(
      `${estimatedMetricPeriods} estimated metric period(s) exist and are reported as present but excluded; estimated data never informs the decision.`,
    );
  }

  /* ---------------- Execution eligibility (persisted state only) -------- */
  const handoffAccepted =
    execution.handoffStatus === "ACCEPTED" || execution.handoffStatus === "COMPLETED";
  const handoffExists = execution.handoffStatus !== null;

  /* ---------------- Decision state machine (first decisive rule wins) --- */
  let decision: OpportunityDecisionState;

  if (opportunity.status === "REJECTED" || opportunity.halalStatus === "NOT_ALLOWED") {
    // Rule K — hard system/data-integrity blocker.
    decision = "BLOCKED";
    explanation.push(
      opportunity.status === "REJECTED"
        ? "Opportunity status is REJECTED; no further operational steps are permitted."
        : "halalStatus is NOT_ALLOWED; no further operational steps are permitted.",
    );
  } else if (readiness.contradictions.length > 0) {
    // Rules C / G — unresolved contradictions in validation or between
    // experiment REAL_DATA and the research signal.
    decision = "REVIEW_CONFLICT";
    explanation.push("Persisted signals contain unresolved contradictions; human review is required before the next step.");
  } else if (execution.hasBlockedTask) {
    // Rule J — security/ownership/approval requirement blocks action.
    decision = "HUMAN_REVIEW";
    explanation.push("A persisted AgentTask was BLOCKED by the security/approval model; a person must review it.");
  } else if (execution.hasAwaitingApprovalTask) {
    // Rule J — approval gate waiting on a person.
    decision = "HUMAN_REVIEW";
    explanation.push("A persisted AgentTask is WAITING_APPROVAL; a person must approve before execution.");
  } else if (input.researchRuns.some((run) => run.status === "RUNNING")) {
    // Research in flight → the current step is still research.
    decision = "RESEARCH_MORE";
    explanation.push("A research run is currently RUNNING.");
  } else if (
    !input.researchRuns.length ||
    readiness.researchFreshness.kind === "NO_RESEARCH"
  ) {
    // Rule A — no research.
    decision = "RESEARCH_MORE";
    explanation.push("No completed research run exists.");
  } else if (readiness.researchFreshness.kind === "STALE_RESEARCH") {
    // Rule D (freshness variant) — stale research must be refreshed first.
    decision = "VALIDATE";
    explanation.push(
      `Stored research is ${readiness.researchFreshness.ageDays} day(s) old (threshold ${readiness.researchFreshness.thresholdDays}); refresh before validation decisions. Stale research does NOT imply demand changed.`,
    );
  } else if (!validation && input.researchRuns.length > 0) {
    // Rule D2 — research is adequate but no validation summary is persisted.
    // Readiness reports no missingEvidence when validation is null (it cannot
    // inspect signals that were never persisted), so this is an explicit rule.
    decision = "VALIDATE";
    explanation.push("Research evidence is adequate but validation has not been persisted for the latest run.");
  } else if (evidenceGaps.length > 0) {
    // Rule B — persisted validation reports evidence gaps (experiment-data
    // gaps are excluded; they belong to the experiment branch below).
    decision = "RESEARCH_MORE";
    explanation.push(
      `${evidenceGaps.length} evidence gap(s) must be closed before validation can be trusted.`,
    );
  } else if (!experimentSufficient(experiments)) {
    // Rules E / F — no experiment, or insufficient REAL_DATA. When an
    // experiment EXISTS but its data is estimated-dominated (no REAL_DATA at
    // all), the fix is better measurement, not a new experiment (Rule F).
    if (experiments.length === 0) {
      decision = "RUN_EXPERIMENT";
      explanation.push("Research and validation are sufficient; no experiment exists yet.");
    } else if (experimentDataClass === "ESTIMATED_DATA") {
      decision = "IMPROVE_EXPERIMENT";
      explanation.push(
        `Experiment data is ESTIMATED_DATA only (${estimatedMetricPeriods} period(s)); estimated data is never treated as real-world performance, so measurement must improve before the data can affect the decision.`,
      );
      experimentGaps.push(
        gap("EXPERIMENT", "ESTIMATED_ONLY", "Experiment data is ESTIMATED_DATA only; estimated data is never treated as REAL_DATA"),
      );
    } else {
      decision = "RUN_EXPERIMENT";
      explanation.push(
        `Experiment has ${realMetricPeriods} REAL_DATA period(s); at least ${READINESS_POLICY.MIN_REAL_METRIC_PERIODS} are required.`,
      );
      experimentGaps.push(
        gap("EXPERIMENT", "REAL_DATA_INSUFFICIENT", `Experiment has ${realMetricPeriods} REAL_DATA period(s), fewer than the required ${READINESS_POLICY.MIN_REAL_METRIC_PERIODS}`),
      );
    }
  } else if (!handoffExists) {
    // Rule H — validated opportunity, experiment sufficient, no handoff yet.
    decision = "HANDOFF_READY";
    explanation.push("Evidence, validation, and experiment data satisfy handoff requirements; create/accept a handoff.");
  } else if (!handoffAccepted) {
    // Rule H (variant) — handoff exists but is not accepted.
    decision = "HANDOFF_READY";
    explanation.push(`Handoff status is ${execution.handoffStatus}; accept it to unlock execution.`);
    executionGaps.push(gap("EXECUTION", "HANDOFF_NOT_ACCEPTED", `Handoff status is ${execution.handoffStatus}; handoff must be ACCEPTED or COMPLETED`));
  } else if (execution.hasRunningAgentTask) {
    // Rule I — execution already in flight.
    decision = "EXECUTION_READY";
    explanation.push("An AgentTask is actively executing; the approved task is being executed.");
  } else {
    // Rule I — approved handoff, nothing running.
    decision = "EXECUTION_READY";
    explanation.push(`Handoff is ${execution.handoffStatus}; approved execution conditions are satisfied.`);
  }

  /* ---------------- Execution gaps for terminal states ---------------- */
  if (decision === "HUMAN_REVIEW" && execution.hasBlockedTask) {
    executionGaps.push(gap("EXECUTION", "TASK_BLOCKED", "A persisted AgentTask is BLOCKED and must be reviewed"));
  }
  if (decision === "HUMAN_REVIEW" && execution.hasAwaitingApprovalTask) {
    executionGaps.push(gap("EXECUTION", "APPROVAL_REQUIRED", "A persisted AgentTask is WAITING_APPROVAL"));
  }

  /* ---------------- Decision score (deterministic, operational) -------- */
  let decisionScore = 0;
  if (input.researchRuns.length > 0) decisionScore += 10;
  if (readiness.researchFreshness.kind === "CURRENT_RESEARCH") decisionScore += 10;
  if (validation) {
    decisionScore += Math.round(Math.max(0, Math.min(1, Number(validation.evidenceCoverage))) * 15);
    decisionScore += Math.min(10, Number(validation.sourceDiversity) * 5);
    if (validation.demandStatus === "SUPPORTED") decisionScore += 5;
    if (validation.commercialIntentStatus === "SUPPORTED") decisionScore += 5;
  }
  if (realMetricPeriods > 0) decisionScore += 5;
  if (experimentSufficient(experiments)) decisionScore += 10;
  if (handoffExists) decisionScore += 10;
  if (handoffAccepted) decisionScore += 10;
  if (execution.hasCompletedExecution) decisionScore += 5;
  decisionScore = Math.max(0, Math.min(100, decisionScore));

  /* ---------------- Confidence ---------------- */
  const confidence = validation
    ? Math.round(Math.max(0, Math.min(1, Number(validation.confidence))) * 100)
    : 0;

  /* ---------------- Next action (exactly one) ---------------- */
  const recommendedAction = recommendNextAction(decision, {
    evidenceAreas: new Set(evidenceGaps.map((item) => item.code)),
    hasContradictions: readiness.contradictions.length > 0,
    staleResearch: readiness.researchFreshness.kind === "STALE_RESEARCH",
    researchRunning: input.researchRuns.some((run) => run.status === "RUNNING"),
    realMetricPeriods,
    estimatedMetricPeriods,
    experimentCount: experiments.length,
    handoffStatus: execution.handoffStatus,
  });

  /* ---------------- Decision inputs audit ---------------- */
  const decisionInputs: DecisionInputs = {
    readinessApplied: true,
    validationApplied: validation !== null,
    experimentApplied: experiments.length > 0,
    handoffApplied: handoffExists,
    executionApplied:
      execution.hasRunningAgentTask || execution.hasCompletedExecution || execution.hasAwaitingApprovalTask || execution.hasBlockedTask,
    freshnessApplied: readiness.researchFreshness.kind !== "NO_RESEARCH",
  };

  /* ---------------- Data class of the decision result ---------------- */
  const dataClass: OpportunityDecision["dataClass"] = opportunity.isSample
    ? "SAMPLE_DATA"
    : validation !== null || realMetricPeriods > 0
      ? "REAL_DATA"
      : "AI_ESTIMATE";

  return {
    opportunityId: opportunity.id,
    decision,
    decisionScore,
    readinessState: readiness.readinessState,
    confidence,
    blockers,
    evidenceGaps,
    validationGaps,
    experimentGaps,
    executionGaps,
    recommendedAction,
    explanation,
    dataClass,
    generatedAt: now.toISOString(),
    decisionInputs,
    lifecycleState: deriveLifecycleState(decision, readiness, execution, experiments.length),
  };
}

/** True when experiment REAL_DATA periods meet the readiness minimum. */
function experimentSufficient(experiments: ReadinessExperimentInput[]): boolean {
  let real = 0;
  for (const experiment of experiments) {
    for (const metric of experiment.metrics) {
      if (metric.dataClass === "REAL_DATA") real += 1;
    }
  }
  return real >= READINESS_POLICY.MIN_REAL_METRIC_PERIODS;
}

/**
 * Derive the lifecycle position (Phase 5) from the decision + readiness +
 * execution state. Delegates to the shared lifecycle module so decision and
 * lifecycle share ONE source of truth. Backward compatible with the existing
 * Opportunity.status field which is never written by this module.
 */
function deriveLifecycleState(
  decision: OpportunityDecisionState,
  readiness: OpportunityReadiness,
  execution: DecisionExecutionInput,
  experimentCount: number,
): string {
  return deriveOpportunityLifecycle({
    decision,
    readinessState: readiness.readinessState,
    researchFreshnessKind: readiness.researchFreshness.kind,
    experimentCount,
    realMetricPeriods: countRealPeriods(readiness),
    execution: {
      hasRunningAgentTask: execution.hasRunningAgentTask,
      hasCompletedExecution: execution.hasCompletedExecution,
    },
  });
}

/** Real-data periods as counted by the readiness engine (single count). */
function countRealPeriods(readiness: OpportunityReadiness): number {
  return readiness.experimentReadiness.realMetricPeriods;
}
