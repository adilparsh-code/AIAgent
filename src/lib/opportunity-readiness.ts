/**
 * Opportunity Decision Readiness Engine (pure, deterministic).
 *
 * Answers, from PERSISTED application data only:
 *   1. What do we actually know about this opportunity?
 *   2. What evidence is still missing?
 *   3. Is it research-ready / validation-ready / handoff-ready / blocked?
 *   4. What is the safest next action?
 *   5. Is the existing research stale?
 *   6. Are experiments providing enough REAL data to affect the decision?
 *   7. Are there contradictions requiring human review?
 *
 * Honesty rules:
 * - No external APIs, no API keys, no network. Every conclusion cites the
 *   persisted signal it is derived from (explanation[]).
 * - Estimated / AI / sample data is never treated as real-world evidence.
 * - Stale research only means "older than the configured threshold"; it NEVER
 *   claims demand changed or disappeared.
 * - Existing opportunity scores are never overridden or recomputed here.
 * - No market conclusions ("the market is good") — only decision states.
 */

/** Allowed readiness states. */
export const READINESS_STATES = [
  "RESEARCH_REQUIRED",
  "RESEARCH_IN_PROGRESS",
  "EVIDENCE_INSUFFICIENT",
  "VALIDATION_REQUIRED",
  "VALIDATION_CONFLICTED",
  "EXPERIMENT_REQUIRED",
  "EXPERIMENT_INSUFFICIENT",
  "HANDOFF_READY",
  "HUMAN_REVIEW_REQUIRED",
  "READY_FOR_EXECUTION",
  "BLOCKED",
] as const;

export type OpportunityReadinessState = (typeof READINESS_STATES)[number];

/** Configurable freshness policy. No hard-coded business assumptions inline. */
export const READINESS_POLICY = {
  /** Research older than this many days is marked stale (default threshold). */
  DEFAULT_RESEARCH_FRESHNESS_DAYS: 30,
  /** Bounded query limits — the engine never loads unbounded rows. */
  MAX_EXPERIMENTS: 20,
  MAX_METRICS_PER_EXPERIMENT: 60,
  /** Minimum REAL_DATA measurement periods before experiment data can inform a decision. */
  MIN_REAL_METRIC_PERIODS: 2,
} as const;

/** Evidence-gap areas (machine-readable, closed set). */
export const READINESS_EVIDENCE_AREAS = [
  "DEMAND",
  "PAIN_POINT",
  "COMMERCIAL_INTENT",
  "TREND",
  "COMPETITION",
  "SOURCE_DIVERSITY",
  "CONTRADICTION_RESOLUTION",
  "EXPERIMENT_DATA",
] as const;

export type ReadinessEvidenceArea = (typeof READINESS_EVIDENCE_AREAS)[number];

export type ReadinessSeverity = "HIGH" | "MEDIUM" | "LOW";

export interface MissingEvidence {
  area: ReadinessEvidenceArea;
  reason: string;
  severity: ReadinessSeverity;
}

export interface Contradiction {
  /** Which persisted signal produced the contradiction. */
  source: string;
  detail: string;
}

export type FreshnessKind = "NO_RESEARCH" | "STALE_RESEARCH" | "CURRENT_RESEARCH";

export interface ResearchFreshness {
  kind: FreshnessKind;
  isStale: boolean;
  ageDays: number | null;
  thresholdDays: number;
  lastResearchAt: string | null;
}

export type ExperimentDataClassSummary = "REAL_DATA" | "ESTIMATED_DATA" | "NONE";

export interface ExperimentReadiness {
  experimentCount: number;
  /** Count of REAL_DATA measurement periods available (estimated data excluded). */
  realMetricPeriods: number;
  estimatedMetricPeriods: number;
  /** REAL_DATA data class when enough real periods exist, ESTIMATED_DATA when only estimated/sample data exists, NONE when no experiment data exists. */
  dataClass: ExperimentDataClassSummary;
  sufficient: boolean;
  /** Persisted experiment decision values, verbatim (no interpretation). */
  decisions: string[];
  /** True when the experiment outcome contradicts the research conclusion. */
  contradictsResearch: boolean;
}

export interface HandoffReadiness {
  ready: boolean;
  /** Human-readable, grounded reasons why handoff is (not) ready. */
  reasons: string[];
  /** Status of the most recent handoff row, if any (verbatim). */
  handoffStatus: string | null;
}

export interface RecommendedNextAction {
  action: string;
  /** The persisted blocker this action resolves. */
  basis: string;
}

export interface OpportunityReadiness {
  opportunityId: string;
  readinessState: OpportunityReadinessState;
  /** 0-100 deterministic decision-readiness score (NOT an opportunity quality score). */
  readinessScore: number;
  /** 0-100 confidence derived only from persisted validation/evidence coverage. */
  confidence: number;
  blockers: string[];
  missingEvidence: MissingEvidence[];
  contradictions: Contradiction[];
  staleResearch: boolean;
  researchFreshness: ResearchFreshness;
  experimentReadiness: ExperimentReadiness;
  handoffReadiness: HandoffReadiness;
  recommendedNextAction: RecommendedNextAction;
  explanation: string[];
  dataClass: "REAL_DATA" | "AI_ESTIMATE" | "SAMPLE_DATA";
  generatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Inputs: normalized rows exactly as persisted.                       */
/* ------------------------------------------------------------------ */

export interface ReadinessResearchRunInput {
  id: string;
  status: string;
  startedAt: Date | string;
  completedAt?: Date | string | null;
  evidenceCount: number;
  confidence: number;
}

export interface ReadinessValidationInput {
  demandStatus: string;
  painPointStatus: string;
  commercialIntentStatus: string;
  trendStatus: string;
  competitionStatus: string;
  evidenceCoverage: number;
  sourceDiversity: number;
  contradictionCount: number;
  confidence: number;
}

export interface ReadinessExperimentInput {
  id: string;
  status: string;
  decision: string | null;
  /** Metric periods: only dataClass + bounded aggregates are needed. */
  metrics: Array<{
    dataClass: string;
    conversions: number | null;
    revenue: number | null;
    cost: number | null;
  }>;
}

export interface ReadinessOpportunityInput {
  id: string;
  status: string;
  halalStatus: string;
  isSample: boolean;
  /** True when a persisted handoff row exists and has been accepted. */
  handoffStatus: string | null;
  risksCount: number;
}

export interface CalculateOpportunityReadinessInput {
  opportunity: ReadinessOpportunityInput;
  researchRuns: ReadinessResearchRunInput[];
  validation: ReadinessValidationInput | null;
  experiments: ReadinessExperimentInput[];
  /** Override for tests / callers with their own policy. */
  freshnessThresholdDays?: number;
  /** Injectable clock for deterministic tests; defaults to now. */
  now?: Date;
}

/* ------------------------------------------------------------------ */
/* Freshness                                                           */
/* ------------------------------------------------------------------ */

export function calculateResearchFreshness(
  researchRuns: ReadinessResearchRunInput[],
  thresholdDays: number = READINESS_POLICY.DEFAULT_RESEARCH_FRESHNESS_DAYS,
  now: Date = new Date(),
): ResearchFreshness {
  const completedOrStarted = researchRuns
    .filter((run) => run.status === "COMPLETED" || run.status === "PARTIAL")
    .map((run) => new Date(run.completedAt ?? run.startedAt).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => b - a);

  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  if (completedOrStarted.length === 0) {
    return {
      kind: "NO_RESEARCH",
      isStale: true,
      ageDays: null,
      thresholdDays,
      lastResearchAt: null,
    };
  }
  const lastResearchAt = new Date(completedOrStarted[0]!);
  const ageDays = Math.floor((now.getTime() - lastResearchAt.getTime()) / (24 * 60 * 60 * 1000));
  const isStale = ageDays > thresholdDays;
  return {
    kind: isStale ? "STALE_RESEARCH" : "CURRENT_RESEARCH",
    isStale,
    ageDays: Math.max(0, ageDays),
    thresholdDays,
    lastResearchAt: lastResearchAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

const SIGNAL_STATUSES: Record<string, ReadinessEvidenceArea> = {
  demandStatus: "DEMAND",
  painPointStatus: "PAIN_POINT",
  commercialIntentStatus: "COMMERCIAL_INTENT",
  trendStatus: "TREND",
  competitionStatus: "COMPETITION",
};

const SIGNAL_LABELS: Record<string, string> = {
  demandStatus: "Demand",
  painPointStatus: "Pain point",
  commercialIntentStatus: "Commercial intent",
  trendStatus: "Trend",
  competitionStatus: "Competition",
};

/** Validation signal is considered present only when SUPPORTED (MIXED is a contradiction). */
function signalSupported(status: string): boolean {
  return status === "SUPPORTED";
}

function signalContradicted(status: string): boolean {
  return status === "MIXED" || status === "CONTRADICTED";
}

/* ------------------------------------------------------------------ */
/* Core engine                                                         */
/* ------------------------------------------------------------------ */

export function calculateOpportunityReadiness(
  input: CalculateOpportunityReadinessInput,
): OpportunityReadiness {
  const now = input.now ?? new Date();
  const thresholdDays =
    input.freshnessThresholdDays ?? READINESS_POLICY.DEFAULT_RESEARCH_FRESHNESS_DAYS;
  const opportunity = input.opportunity;
  const explanation: string[] = [];
  const blockers: string[] = [];
  const missingEvidence: MissingEvidence[] = [];
  const contradictions: Contradiction[] = [];

  /* ---------------- Handoff / execution preconditions ---------------- */
  const handoffAccepted = opportunity.handoffStatus === "ACCEPTED" || opportunity.handoffStatus === "COMPLETED";
  const handoffExists = opportunity.handoffStatus !== null;
  const opportunityRejected = opportunity.status === "REJECTED" || opportunity.halalStatus === "NOT_ALLOWED";

  /* ---------------- Experiment readiness ---------------- */
  let realMetricPeriods = 0;
  let estimatedMetricPeriods = 0;
  let realRevenueTotal = 0;
  let realCostTotal = 0;
  let realConversionsTotal = 0;
  for (const experiment of input.experiments) {
    for (const metric of experiment.metrics) {
      if (metric.dataClass === "REAL_DATA") {
        realMetricPeriods += 1;
        realRevenueTotal += metric.revenue ?? 0;
        realCostTotal += metric.cost ?? 0;
        realConversionsTotal += metric.conversions ?? 0;
      } else if (metric.dataClass === "ESTIMATED_DATA") {
        estimatedMetricPeriods += 1;
      }
      // SAMPLE_DATA / unknown classes are ignored entirely — never evidence.
    }
  }
  const experimentDataClass: ExperimentDataClassSummary =
    realMetricPeriods > 0 ? "REAL_DATA" : estimatedMetricPeriods > 0 ? "ESTIMATED_DATA" : "NONE";
  const experimentSufficient = realMetricPeriods >= READINESS_POLICY.MIN_REAL_METRIC_PERIODS;
  const experimentReadiness: ExperimentReadiness = {
    experimentCount: input.experiments.length,
    realMetricPeriods,
    estimatedMetricPeriods,
    dataClass: experimentDataClass,
    sufficient: experimentSufficient,
    decisions: input.experiments
      .map((experiment) => experiment.decision)
      .filter((decision): decision is string => Boolean(decision)),
    contradictsResearch: false,
  };

  /* ---------------- Research freshness ---------------- */
  const freshness = calculateResearchFreshness(input.researchRuns, thresholdDays, now);
  explanation.push(
    freshness.kind === "NO_RESEARCH"
      ? "No research run has been completed for this opportunity."
      : `Latest research run is ${freshness.ageDays} day(s) old (threshold ${freshness.thresholdDays} days) — ${freshness.kind === "STALE_RESEARCH" ? "STALE: stored research is older than the configured freshness threshold; it does NOT imply demand changed" : "within the freshness threshold"}.`,
  );
  if (freshness.kind === "NO_RESEARCH") {
    blockers.push("No completed research run exists");
  } else if (freshness.kind === "STALE_RESEARCH") {
    blockers.push(`Stored research is ${freshness.ageDays} days old (freshness threshold ${freshness.thresholdDays} days)`);
  }

  /* ---------------- Validation-derived evidence gaps ---------------- */
  const validation = input.validation;
  if (validation) {
    explanation.push(
      `Validation evidence coverage is ${Math.round(Number(validation.evidenceCoverage) * 100)}%.`,
    );
    explanation.push(
      `Validation source diversity is ${validation.sourceDiversity} distinct source(s).`,
    );
    for (const [key, area] of Object.entries(SIGNAL_STATUSES)) {
      const status = (validation as unknown as Record<string, string>)[key] ?? "INSUFFICIENT";
      explanation.push(`${SIGNAL_LABELS[key]} validation is ${status}.`);
      if (signalContradicted(status)) {
        contradictions.push({
          source: `validation.${key}`,
          detail: `${SIGNAL_LABELS[key]} validation contains contradictory signals (${status}).`,
        });
      } else if (!signalSupported(status)) {
        missingEvidence.push({
          area,
          reason: `${area.replace(/_/g, " ")} signal is ${status}`,
          severity: area === "COMMERCIAL_INTENT" || area === "DEMAND" ? "HIGH" : "MEDIUM",
        });
      }
    }
    if (validation.sourceDiversity < 2) {
      missingEvidence.push({
        area: "SOURCE_DIVERSITY",
        reason: `Evidence comes from ${validation.sourceDiversity} distinct source(s); at least 2 are required`,
        severity: "MEDIUM",
      });
    }
    if (validation.contradictionCount > 0 || contradictions.length > 0) {
      explanation.push(
        `Validation contains ${validation.contradictionCount} contradictory signal(s).`,
      );
      if (validation.contradictionCount > 0) {
        contradictions.push({
          source: "validation.contradictionCount",
          detail: `${validation.contradictionCount} contradictory evidence item(s) recorded in validation.`,
        });
      }
      missingEvidence.push({
        area: "CONTRADICTION_RESOLUTION",
        reason: "Contradictory evidence requires human resolution",
        severity: "HIGH",
      });
    }
  } else if (input.researchRuns.length > 0) {
    explanation.push("Research runs exist but no validation summary was persisted yet.");
  }

  if (experimentDataClass === "ESTIMATED_DATA") {
    explanation.push(
      `Experiment data exists but is ESTIMATED_DATA only (${estimatedMetricPeriods} period(s)); it is not treated as real-world performance.`,
    );
    missingEvidence.push({
      area: "EXPERIMENT_DATA",
      reason: "Experiment has estimated data only; REAL_DATA measurements are required",
      severity: "HIGH",
    });
  } else if (experimentDataClass === "REAL_DATA" && !experimentSufficient) {
    explanation.push(
      `Experiment has ${realMetricPeriods} REAL_DATA measurement period(s); at least ${READINESS_POLICY.MIN_REAL_METRIC_PERIODS} are required.`,
    );
    missingEvidence.push({
      area: "EXPERIMENT_DATA",
      reason: `Experiment has only ${realMetricPeriods} REAL_DATA measurement period(s)`,
      severity: "MEDIUM",
    });
  } else if (experimentDataClass === "REAL_DATA" && experimentSufficient) {
    explanation.push(
      `Experiment has ${realMetricPeriods} REAL_DATA measurement period(s) (estimated periods are excluded from this count).`,
    );
  }

  /* ---------------- Experiment vs research contradiction ---------------- */
  const hasValidation = validation !== null;
  if (
    hasValidation &&
    validation!.commercialIntentStatus === "SUPPORTED" &&
    experimentDataClass === "REAL_DATA" &&
    experimentSufficient &&
    realConversionsTotal === 0 &&
    input.experiments.some((experiment) => ["COMPLETED", "STOPPED", "KILL"].includes(experiment.status) || experiment.decision === "KILL")
  ) {
    experimentReadiness.contradictsResearch = true;
    contradictions.push({
      source: "experiment-metrics vs validation.commercialIntentStatus",
      detail:
        "Research supported commercial intent, but the completed experiment recorded zero conversions across its REAL_DATA periods.",
    });
    explanation.push(
      "Experiment REAL_DATA outcome contradicts the research-supported commercial intent signal.",
    );
  }

  /* ---------------- Score + confidence ---------------- */
  // Deterministic decision-readiness score built ONLY from persisted facts.
  // This is NOT an opportunity quality score and never touches existing scores.
  let readinessScore = 0;
  if (input.researchRuns.length > 0) readinessScore += 15;
  if (freshness.kind === "CURRENT_RESEARCH") readinessScore += 15;
  if (validation) {
    readinessScore += Math.round(Math.max(0, Math.min(1, Number(validation.evidenceCoverage))) * 20);
    readinessScore += Math.min(10, validation.sourceDiversity * 5);
    if (signalSupported(validation.demandStatus)) readinessScore += 10;
    if (signalSupported(validation.commercialIntentStatus)) readinessScore += 10;
  }
  if (experimentDataClass === "REAL_DATA") readinessScore += 5;
  if (experimentSufficient) readinessScore += 5;
  if (handoffExists) readinessScore += 5;
  if (handoffAccepted) readinessScore += 5;
  readinessScore = Math.max(0, Math.min(100, readinessScore));

  // Confidence mirrors persisted validation confidence when present; otherwise 0.
  const confidence = validation
    ? Math.round(Math.max(0, Math.min(1, Number(validation.confidence))) * 100)
    : 0;

  /* ---------------- State machine (ordered, first decisive rule wins) ---- */
  let readinessState: OpportunityReadinessState;

  if (opportunityRejected) {
    readinessState = "BLOCKED";
    blockers.push(
      opportunity.status === "REJECTED"
        ? "Opportunity status is REJECTED"
        : "Opportunity halalStatus is NOT_ALLOWED",
    );
  } else if (input.researchRuns.some((run) => run.status === "RUNNING")) {
    readinessState = "RESEARCH_IN_PROGRESS";
    explanation.push("A research run is currently RUNNING.");
  } else if (freshness.kind === "NO_RESEARCH") {
    readinessState = "RESEARCH_REQUIRED";
  } else if (contradictions.length > 0) {
    // Validation contradictions (incl. experiment-vs-research) need a human.
    readinessState = "HUMAN_REVIEW_REQUIRED";
    if (!validation) {
      readinessState = "VALIDATION_REQUIRED";
    }
  } else if (freshness.kind === "STALE_RESEARCH") {
    readinessState = "VALIDATION_REQUIRED";
    explanation.push(
      "Stored research is stale. A fresh research run is required before validation/handoff decisions; existing evidence is not deleted or rewritten.",
    );
  } else if (!validation) {
    readinessState = "VALIDATION_REQUIRED";
    explanation.push("Research exists but validation has not been persisted for the latest run.");
  } else if (
    missingEvidence.some((gap) => gap.area === "CONTRADICTION_RESOLUTION")
  ) {
    readinessState = "VALIDATION_CONFLICTED";
  } else if (missingEvidence.length > 0) {
    const nonExperimentGaps = missingEvidence.filter((gap) => gap.area !== "EXPERIMENT_DATA");
    if (nonExperimentGaps.length === 0 && input.experiments.length > 0) {
      // The only gaps are experiment-data gaps: the research/validation side
      // is fine, the experiment side is what blocks the decision.
      readinessState = "EXPERIMENT_INSUFFICIENT";
      explanation.push(
        experimentDataClass === "ESTIMATED_DATA"
          ? "Experiment data is ESTIMATED_DATA only and cannot be treated as real-world performance."
          : `Experiment has only ${realMetricPeriods} REAL_DATA measurement period(s).`,
      );
    } else {
      readinessState = "EVIDENCE_INSUFFICIENT";
      explanation.push(
        `${missingEvidence.length} evidence gap(s) must be closed before validation can be trusted.`,
      );
    }
  } else if (!handoffExists && !experimentSufficient && input.experiments.length === 0) {
    readinessState = "EXPERIMENT_REQUIRED";
    explanation.push("Research and validation are complete; no experiment exists yet.");
  } else if (!handoffExists && !experimentSufficient) {
    readinessState = "EXPERIMENT_INSUFFICIENT";
    explanation.push("Experiment exists but has insufficient REAL_DATA periods to affect the decision.");
  } else if (handoffAccepted) {
    readinessState = "READY_FOR_EXECUTION";
    explanation.push(
      `Persisted handoff status is ${opportunity.handoffStatus}; approved execution conditions are satisfied.`,
    );
  } else {
    readinessState = "HANDOFF_READY";
    explanation.push("Evidence, validation, and experiment data are sufficient to create/accept a handoff.");
  }

  /* ---------------- Handoff readiness reasons ---------------- */
  const handoffReasons: string[] = [];
  if (readinessState === "READY_FOR_EXECUTION" || readinessState === "HANDOFF_READY") {
    handoffReasons.push(
      readinessState === "READY_FOR_EXECUTION"
        ? `Handoff is ${opportunity.handoffStatus}; execution may proceed through approved tasks.`
        : "Evidence, validation, and experiment data are sufficient; handoff can be created/accepted.",
    );
    if (experimentSufficient) {
      handoffReasons.push(`Experiment has ${realMetricPeriods} REAL_DATA periods supporting the decision.`);
    }
  } else {
    if (freshness.kind === "NO_RESEARCH") handoffReasons.push("No completed research run exists");
    if (freshness.kind === "STALE_RESEARCH") handoffReasons.push("Stored research is stale (older than the configured freshness threshold)");
    if (!validation && input.researchRuns.length > 0) handoffReasons.push("Validation has not been persisted for the latest research run");
    for (const gap of missingEvidence) {
      handoffReasons.push(`${gap.area.replace(/_/g, " ")}: ${gap.reason}`);
    }
    for (const contradiction of contradictions) {
      handoffReasons.push(contradiction.detail);
    }
    if (input.experiments.length === 0 && validation && missingEvidence.length === 0 && contradictions.length === 0 && freshness.kind === "CURRENT_RESEARCH") {
      handoffReasons.push("No validation experiment exists yet");
    }
    if (input.experiments.length > 0 && !experimentSufficient) {
      handoffReasons.push(
        experimentDataClass === "ESTIMATED_DATA"
          ? "Experiment has insufficient REAL_DATA (estimated data only)"
          : `Experiment has insufficient REAL_DATA (${realMetricPeriods} period(s))`,
      );
    }
  }
  const handoffReadiness: HandoffReadiness = {
    ready: readinessState === "HANDOFF_READY" || readinessState === "READY_FOR_EXECUTION",
    reasons: handoffReasons,
    handoffStatus: opportunity.handoffStatus,
  };

  /* ---------------- Next action (grounded in the decisive blocker) ------ */
  let recommendedNextAction: RecommendedNextAction;
  switch (readinessState) {
    case "RESEARCH_REQUIRED":
      recommendedNextAction = { action: "Run research", basis: "No completed research run exists" };
      break;
    case "RESEARCH_IN_PROGRESS":
      recommendedNextAction = { action: "Wait for the running research run to finish", basis: "A research run is RUNNING" };
      break;
    case "VALIDATION_REQUIRED":
      recommendedNextAction = freshness.kind === "STALE_RESEARCH"
        ? { action: "Refresh research", basis: `Stored research is ${freshness.ageDays} days old (threshold ${freshness.thresholdDays})` }
        : { action: "Run research to produce validation", basis: "Research runs exist without a persisted validation summary" };
      break;
    case "VALIDATION_CONFLICTED":
      recommendedNextAction = { action: "Review contradictory evidence", basis: "Validation contains unresolved contradictory signals" };
      break;
    case "HUMAN_REVIEW_REQUIRED":
      recommendedNextAction = { action: "Review contradictory evidence", basis: "Persisted signals conflict and require human resolution" };
      break;
    case "EVIDENCE_INSUFFICIENT": {
      const worst = missingEvidence.find((gap) => gap.severity === "HIGH") ?? missingEvidence[0]!;
      const actionByArea: Record<ReadinessEvidenceArea, string> = {
        DEMAND: "Collect demand evidence",
        PAIN_POINT: "Collect pain-point evidence",
        COMMERCIAL_INTENT: "Collect commercial-intent evidence",
        TREND: "Collect trend evidence",
        COMPETITION: "Collect competition evidence",
        SOURCE_DIVERSITY: "Collect evidence from additional distinct sources",
        CONTRADICTION_RESOLUTION: "Review contradictory evidence",
        EXPERIMENT_DATA: "Record additional REAL_DATA metrics",
      };
      recommendedNextAction = {
        action: actionByArea[worst.area],
        basis: worst.reason,
      };
      break;
    }
    case "EXPERIMENT_REQUIRED":
      recommendedNextAction = { action: "Create validation experiment", basis: "No experiment exists for a validated opportunity" };
      break;
    case "EXPERIMENT_INSUFFICIENT":
      recommendedNextAction = {
        action: "Record additional REAL_DATA metrics",
        basis:
          experimentDataClass === "ESTIMATED_DATA"
            ? "Experiment data is ESTIMATED_DATA only"
            : `Only ${realMetricPeriods} REAL_DATA period(s) recorded`,
      };
      break;
    case "HANDOFF_READY":
      recommendedNextAction = { action: "Create/accept handoff", basis: "Evidence, validation, and experiment data are sufficient" };
      break;
    case "READY_FOR_EXECUTION":
      recommendedNextAction = { action: "Execute approved task", basis: `Handoff is ${opportunity.handoffStatus}` };
      break;
    case "BLOCKED":
      recommendedNextAction = {
        action: "Resolve blocking status before further work",
        basis: opportunity.status === "REJECTED" ? "Opportunity status is REJECTED" : "Opportunity halalStatus is NOT_ALLOWED",
      };
      break;
  }

  /* ---------------- Data class of the readiness result itself ---------- */
  // The result interprets persisted rows: REAL_DATA when it rests on real
  // validation/metrics, AI_ESTIMATE never applies (we invent nothing), and
  // SAMPLE_DATA when the opportunity itself is a sample row.
  const dataClass: OpportunityReadiness["dataClass"] = opportunity.isSample
    ? "SAMPLE_DATA"
    : experimentDataClass === "REAL_DATA" || validation !== null
      ? "REAL_DATA"
      : "AI_ESTIMATE";

  return {
    opportunityId: opportunity.id,
    readinessState,
    readinessScore,
    confidence,
    blockers,
    missingEvidence,
    contradictions,
    staleResearch: freshness.isStale && freshness.kind === "STALE_RESEARCH",
    researchFreshness: freshness,
    experimentReadiness,
    handoffReadiness,
    recommendedNextAction,
    explanation,
    dataClass,
    generatedAt: now.toISOString(),
  };
}
