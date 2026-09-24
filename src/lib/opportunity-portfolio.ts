/**
 * Opportunity Portfolio Intelligence (pure, deterministic).
 *
 * Evaluates the CURRENT portfolio of opportunities collectively and answers:
 * "given the opportunities and their current evidence, readiness, decision,
 * experiment, handoff and execution states, what should the system process
 * next?"
 *
 * This is NOT a profitability prediction system. It makes no revenue, income,
 * investment, or market-size claim, and it never labels an opportunity
 * best/worst/winner/loser.
 *
 * Composition, not duplication: every input row is the EXISTING read-model
 * output (readiness engine + decision engine + persisted experiment/handoff
 * facts). The portfolio layer only aggregates and buckets — it introduces no
 * second persisted status system and re-derives no individual decision.
 *
 * Data-class rules (inherited, never relaxed): SAMPLE_DATA / ESTIMATED_DATA /
 * UNKNOWN never count as real evidence. Nothing here invents demand, revenue,
 * conversion, market size, profitability, or user counts.
 */
import {
  prioritizeOpportunities,
  type OpportunityPriority,
  type OpportunityPriorityInput,
  type OperationalLabel,
} from "@/lib/experiment-prioritization";

/* ------------------------------------------------------------------ */
/* Policy (explicit, centralized thresholds)                            */
/* ------------------------------------------------------------------ */

export const PORTFOLIO_POLICY = {
  /** Max opportunities loaded from the database (bounded reads). */
  MAX_OPPORTUNITIES: 50,
  /** Max opportunities recommended for attention in one response. */
  MAX_RECOMMENDED: 5,
  /** Research backlog at/above this count raises a concentration warning. */
  RESEARCH_BACKLOG_WARNING: 5,
  VALIDATION_BACKLOG_WARNING: 5,
  /** Human-approval backlog warning threshold. */
  APPROVAL_BACKLOG_WARNING: 3,
  /** Unresolved-conflict cluster warning threshold. */
  CONFLICT_CLUSTER_WARNING: 3,
  /** Opportunities sharing the same evidence gap trigger this warning. */
  SHARED_BLOCKER_WARNING: 3,
  /** Opportunities with insufficient REAL_DATA trigger this warning. */
  INSUFFICIENT_EXPERIMENT_WARNING: 3,
  /** Share of active opportunities whose research is stale (0-1). */
  STALE_SHARE_WARNING: 0.4,
  /** Opportunities whose latest research run FAILED before this warning. */
  FAILED_RUN_WARNING: 3,
} as const;

/* ------------------------------------------------------------------ */
/* Buckets (Phase 2)                                                   */
/* ------------------------------------------------------------------ */

export const PORTFOLIO_QUEUES = [
  "RESEARCH_QUEUE",
  "VALIDATION_QUEUE",
  "EXPERIMENT_QUEUE",
  "LEARNING_QUEUE",
  "HANDOFF_QUEUE",
  "EXECUTION_QUEUE",
  "HUMAN_REVIEW_QUEUE",
  "BLOCKED_QUEUE",
  "MONITOR_QUEUE",
] as const;

export type PortfolioQueue = (typeof PORTFOLIO_QUEUES)[number];

/* ------------------------------------------------------------------ */
/* Portfolio decision (Phase 5)                                        */
/* ------------------------------------------------------------------ */

export const PORTFOLIO_DECISIONS = [
  "FILL_RESEARCH_GAPS",
  "VALIDATE_OPPORTUNITIES",
  "RUN_EXPERIMENTS",
  "IMPROVE_EXPERIMENTS",
  "REVIEW_CONFLICTS",
  "COMPLETE_HANDOFFS",
  "EXECUTE_APPROVED_WORK",
  "HUMAN_REVIEW_REQUIRED",
  "MONITOR",
] as const;

export type PortfolioDecision = (typeof PORTFOLIO_DECISIONS)[number];

/* ------------------------------------------------------------------ */
/* Input: one row per opportunity (existing read-model output)         */
/* ------------------------------------------------------------------ */

export interface PortfolioOpportunityInput {
  opportunityId: string;
  /** Decision from the decision engine (verbatim). */
  decision: string;
  /** Readiness state from the readiness engine (verbatim). */
  readinessState: string;
  /** Lifecycle state from the lifecycle read-model (verbatim). */
  lifecycleState: string;
  /** 0-100 decision confidence (from persisted validation). */
  confidence: number;
  /** 0-100 decision score (operational, not quality). */
  decisionScore: number;
  /** Data class of the decision result itself. */
  dataClass: "REAL_DATA" | "AI_ESTIMATE" | "SAMPLE_DATA";
  /** Research freshness kind from the readiness engine. */
  researchFreshnessKind: "NO_RESEARCH" | "STALE_RESEARCH" | "CURRENT_RESEARCH";
  evidenceGapCount: number;
  validationGapCount: number;
  experimentGapCount: number;
  executionGapCount: number;
  blockerCount: number;
  /** Unresolved persisted contradictions. */
  hasContradictions: boolean;
  /** Evidence-gap codes, used for shared-blocker concentration detection. */
  evidenceGapCodes: string[];
  experimentCount: number;
  realMetricPeriods: number;
  estimatedMetricPeriods: number;
  experimentDataClass: "NONE" | "ESTIMATED_DATA" | "REAL_DATA";
  experimentSufficient: boolean;
  lastExperimentMetricAt: Date | string | null;
  /** A persisted experiment decision exists (learning signal available). */
  hasLearningSignal: boolean;
  handoffStatus: string | null;
  requiresHumanApproval: boolean;
  hasExecutionBlocker: boolean;
  isBlocked: boolean;
  /** Latest persisted research run status ("FAILED" raises a warning). */
  latestResearchRunStatus: string | null;
}

export interface EvidenceQualitySummary {
  opportunitiesWithValidationConfidence: number;
  averageConfidence: number;
  realDataOpportunities: number;
  aiEstimateOpportunities: number;
  /** Honest statement of what the portfolio can and cannot conclude. */
  nonRealDataLimitations: string[];
}

export interface ExperimentCoverageSummary {
  opportunitiesWithExperiments: number;
  withSufficientRealData: number;
  withInsufficientRealData: number;
  estimatedOnly: number;
  withNoData: number;
  averageRealMetricPeriods: number;
}

export interface ConcentrationWarning {
  code: string;
  detail: string;
  /** How many opportunities triggered the warning (deterministic). */
  affected: number;
  kind: "BACKLOG" | "SHARED_BLOCKER" | "DATA_QUALITY" | "DEPENDENCY";
}

export interface PortfolioRecommendation {
  opportunityId: string;
  /** Neutral operational label — never a quality/profitability claim. */
  label: OperationalLabel;
  /** Persisted reason for the label. */
  reason: string;
  priorityScore: number;
}

export interface OpportunityPortfolioIntelligence {
  totalOpportunities: number;
  activeOpportunities: number;
  blockedOpportunities: number;
  researchRequired: number;
  validationRequired: number;
  experimentsRequired: number;
  handoffReady: number;
  executionReady: number;
  humanReviewRequired: number;
  portfolioConfidence: number;
  concentrationWarnings: ConcentrationWarning[];
  staleOpportunityCount: number;
  evidenceQualitySummary: EvidenceQualitySummary;
  experimentCoverageSummary: ExperimentCoverageSummary;
  recommendedOpportunityIds: string[];
  recommendedNextActions: string[];
  /** Deterministic operational buckets (read-model projection, not persisted). */
  queues: Record<PortfolioQueue, string[]>;
  portfolioDecision: PortfolioDecision;
  recommendations: PortfolioRecommendation[];
  explanation: string[];
  dataClass: "REAL_DATA" | "AI_ESTIMATE" | "SAMPLE_DATA";
  generatedAt: string;
  /** Bounded-read limits applied by the server loader (transparency). */
  bounds: { maxOpportunities: number; truncated: boolean };
}

/* ------------------------------------------------------------------ */
/* Bucketing                                                           */
/* ------------------------------------------------------------------ */

/**
 * Map an opportunity's decision to its operational queue. Pure projection of
 * the existing decision read-model — never a new persisted status.
 */
export function bucketForOpportunity(input: PortfolioOpportunityInput): PortfolioQueue {
  switch (input.decision) {
    case "BLOCKED":
      return "BLOCKED_QUEUE";
    case "HUMAN_REVIEW":
    case "REVIEW_CONFLICT":
      // Conflict/approval resolution is human work: it sits in the human
      // review queue, not in an automated queue.
      return "HUMAN_REVIEW_QUEUE";
    case "RESEARCH_MORE":
      return "RESEARCH_QUEUE";
    case "VALIDATE":
      return "VALIDATION_QUEUE";
    case "RUN_EXPERIMENT":
      // No experiment yet → create one; an existing experiment with missing
      // data → the learning queue (measure and learn from what exists).
      return input.experimentCount === 0 ? "EXPERIMENT_QUEUE" : "LEARNING_QUEUE";
    case "IMPROVE_EXPERIMENT":
      return "LEARNING_QUEUE";
    case "HANDOFF_READY":
      return "HANDOFF_QUEUE";
    case "EXECUTION_READY":
      // EXECUTION_READY means execution is still PENDING → active queue. Only
      // when the lifecycle shows the work is already in flight or finished
      // (EXECUTING / MEASURING / LEARNED) does it move to monitoring.
      return ["EXECUTING", "MEASURING", "LEARNED"].includes(input.lifecycleState)
        ? "MONITOR_QUEUE"
        : "EXECUTION_QUEUE";
    default:
      // Unknown decision never fabricates a queue: treat as monitored.
      return "MONITOR_QUEUE";
  }
}

function emptyQueues(): Record<PortfolioQueue, string[]> {
  return {
    RESEARCH_QUEUE: [],
    VALIDATION_QUEUE: [],
    EXPERIMENT_QUEUE: [],
    LEARNING_QUEUE: [],
    HANDOFF_QUEUE: [],
    EXECUTION_QUEUE: [],
    HUMAN_REVIEW_QUEUE: [],
    BLOCKED_QUEUE: [],
    MONITOR_QUEUE: [],
  };
}

/* ------------------------------------------------------------------ */
/* Portfolio decision rules (Phase 5)                                  */
/* ------------------------------------------------------------------ */

/**
 * Derive ONE portfolio-level decision from the existing opportunity decisions.
 * First decisive rule wins, in documented order. The portfolio decision is
 * derived only from persisted opportunity decisions — never AI-generated.
 */
function derivePortfolioDecision(counts: {
  researchRequired: number;
  validationRequired: number;
  experimentQueue: number;
  learningQueue: number;
  conflictCount: number;
  handoffReady: number;
  executionReady: number;
  approvalReviewCount: number;
  total: number;
}): PortfolioDecision {
  if (counts.total === 0) return "MONITOR";
  if (counts.researchRequired > 0) return "FILL_RESEARCH_GAPS";
  if (counts.validationRequired > 0) return "VALIDATE_OPPORTUNITIES";
  if (counts.experimentQueue > 0) return "RUN_EXPERIMENTS";
  if (counts.learningQueue > 0) return "IMPROVE_EXPERIMENTS";
  if (counts.conflictCount > 0) return "REVIEW_CONFLICTS";
  if (counts.handoffReady > 0) return "COMPLETE_HANDOFFS";
  if (counts.executionReady > 0) return "EXECUTE_APPROVED_WORK";
  if (counts.approvalReviewCount > 0) return "HUMAN_REVIEW_REQUIRED";
  return "MONITOR";
}

/** Single portfolio-level action string (neutral, operational, no claims). */
function portfolioActionForDecision(decision: PortfolioDecision): string {
  switch (decision) {
    case "FILL_RESEARCH_GAPS":
      return "Collect missing research evidence across the portfolio.";
    case "VALIDATE_OPPORTUNITIES":
      return "Validate researched opportunities that lack validation.";
    case "RUN_EXPERIMENTS":
      return "Create experiments for validated opportunities.";
    case "IMPROVE_EXPERIMENTS":
      return "Improve experiment measurement to gather REAL_DATA.";
    case "REVIEW_CONFLICTS":
      return "Review contradictory evidence across opportunities.";
    case "COMPLETE_HANDOFFS":
      return "Complete or accept AI Income Lab handoffs.";
    case "EXECUTE_APPROVED_WORK":
      return "Execute approved work for execution-ready opportunities.";
    case "HUMAN_REVIEW_REQUIRED":
      return "Complete pending human approvals.";
    case "MONITOR":
      return "Monitor the portfolio; no queued work requires action.";
  }
}

/* ------------------------------------------------------------------ */
/* Core engine                                                         */
/* ------------------------------------------------------------------ */

export function calculatePortfolioIntelligence(options: {
  opportunities: PortfolioOpportunityInput[];
  /** Set by the server loader when the read hit the bounded limit. */
  truncated?: boolean;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}): OpportunityPortfolioIntelligence {
  const now = options.now ?? new Date();
  const rows = options.opportunities ?? [];
  const explanation: string[] = [];

  const queues = emptyQueues();
  for (const row of rows) {
    queues[bucketForOpportunity(row)].push(row.opportunityId);
  }
  // Deterministic queue ordering (ids sorted) regardless of input order.
  for (const key of PORTFOLIO_QUEUES) queues[key].sort();

  const totalOpportunities = rows.length;
  const blockedOpportunities = queues.BLOCKED_QUEUE.length;
  // "Active" = not hard-blocked.
  const activeOpportunities = totalOpportunities - blockedOpportunities;
  const researchRequired = queues.RESEARCH_QUEUE.length;
  const validationRequired = queues.VALIDATION_QUEUE.length;
  const experimentRequired = queues.EXPERIMENT_QUEUE.length;
  const learningRequired = queues.LEARNING_QUEUE.length;
  const handoffReady = queues.HANDOFF_QUEUE.length;
  const executionReady = queues.EXECUTION_QUEUE.length;
  const humanReviewRequired = queues.HUMAN_REVIEW_QUEUE.length;

  const conflictCount = rows.filter((row) => row.hasContradictions).length;
  const approvalReviewCount = rows.filter(
    (row) => !row.hasContradictions && (row.requiresHumanApproval || row.hasExecutionBlocker),
  ).length;
  const staleOpportunityCount = rows.filter(
    (row) => row.researchFreshnessKind === "STALE_RESEARCH",
  ).length;

  /* ---------------- Portfolio decision ---------------- */
  const portfolioDecision = derivePortfolioDecision({
    researchRequired,
    validationRequired,
    experimentQueue: experimentRequired,
    learningQueue: learningRequired,
    conflictCount,
    handoffReady,
    executionReady,
    approvalReviewCount,
    total: totalOpportunities,
  });

  /* ---------------- Evidence quality summary ---------------- */
  const withConfidence = rows.filter((row) => row.confidence > 0);
  const averageConfidence =
    withConfidence.length > 0
      ? Math.round(withConfidence.reduce((sum, row) => sum + row.confidence, 0) / withConfidence.length)
      : 0;
  const realDataOpportunities = rows.filter((row) => row.dataClass === "REAL_DATA").length;
  const aiEstimateOpportunities = rows.filter((row) => row.dataClass === "AI_ESTIMATE").length;
  const nonRealDataLimitations: string[] = [];
  if (aiEstimateOpportunities > 0) {
    nonRealDataLimitations.push(
      `${aiEstimateOpportunities} opportunity(ies) have no persisted real validation or REAL_DATA metrics; their decision inputs are AI_ESTIMATE and cannot support a market conclusion`,
    );
  }
  if (staleOpportunityCount > 0) {
    nonRealDataLimitations.push(
      `${staleOpportunityCount} opportunity(ies) hold research older than the freshness threshold; staleness does not imply demand changed`,
    );
  }
  const estimatedOnly = rows.filter(
    (row) => row.experimentDataClass === "ESTIMATED_DATA",
  ).length;
  if (estimatedOnly > 0) {
    nonRealDataLimitations.push(
      `${estimatedOnly} opportunity(ies) have ESTIMATED_DATA experiment metrics only; estimated data is never treated as REAL_DATA`,
    );
  }
  if (nonRealDataLimitations.length === 0) {
    nonRealDataLimitations.push(
      "All counted evidence and experiment metrics in this portfolio are REAL_DATA.",
    );
  }

  const evidenceQualitySummary: EvidenceQualitySummary = {
    opportunitiesWithValidationConfidence: withConfidence.length,
    averageConfidence,
    realDataOpportunities,
    aiEstimateOpportunities,
    nonRealDataLimitations,
  };

  /* ---------------- Experiment coverage summary ---------------- */
  const withExperiments = rows.filter((row) => row.experimentCount > 0);
  const withSufficientRealData = withExperiments.filter((row) => row.experimentSufficient).length;
  const withInsufficientRealData =
    withExperiments.length - withSufficientRealData - rows.filter((row) => row.experimentDataClass === "ESTIMATED_DATA").length;
  const averageRealMetricPeriods =
    withExperiments.length > 0
      ? Math.round(
          (withExperiments.reduce((sum, row) => sum + row.realMetricPeriods, 0) / withExperiments.length) * 100,
        ) / 100
      : 0;
  const experimentCoverageSummary: ExperimentCoverageSummary = {
    opportunitiesWithExperiments: withExperiments.length,
    withSufficientRealData,
    withInsufficientRealData: Math.max(0, withInsufficientRealData),
    estimatedOnly,
    withNoData: rows.filter((row) => row.experimentDataClass === "NONE").length,
    averageRealMetricPeriods,
  };

  /* ---------------- Concentration warnings (Phase 6) ---------------- */
  const concentrationWarnings: ConcentrationWarning[] = [];
  if (researchRequired >= PORTFOLIO_POLICY.RESEARCH_BACKLOG_WARNING) {
    concentrationWarnings.push({
      code: "RESEARCH_BACKLOG",
      detail: `${researchRequired} opportunities are waiting for research`,
      affected: researchRequired,
      kind: "BACKLOG",
    });
  }
  if (validationRequired >= PORTFOLIO_POLICY.VALIDATION_BACKLOG_WARNING) {
    concentrationWarnings.push({
      code: "VALIDATION_BACKLOG",
      detail: `${validationRequired} opportunities are waiting for validation`,
      affected: validationRequired,
      kind: "BACKLOG",
    });
  }
  if (approvalReviewCount >= PORTFOLIO_POLICY.APPROVAL_BACKLOG_WARNING) {
    concentrationWarnings.push({
      code: "APPROVAL_BACKLOG",
      detail: `${approvalReviewCount} opportunities are waiting on human approval`,
      affected: approvalReviewCount,
      kind: "BACKLOG",
    });
  }
  if (conflictCount >= PORTFOLIO_POLICY.CONFLICT_CLUSTER_WARNING) {
    concentrationWarnings.push({
      code: "CONFLICT_CLUSTER",
      detail: `${conflictCount} opportunities carry unresolved contradictions requiring human review`,
      affected: conflictCount,
      kind: "BACKLOG",
    });
  }
  // Shared evidence gaps across opportunities (same missing area).
  const gapCounts = new Map<string, number>();
  for (const row of rows) {
    for (const code of new Set(row.evidenceGapCodes ?? [])) {
      gapCounts.set(code, (gapCounts.get(code) ?? 0) + 1);
    }
  }
  for (const [code, count] of [...gapCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )) {
    if (count >= PORTFOLIO_POLICY.SHARED_BLOCKER_WARNING) {
      concentrationWarnings.push({
        code: `SHARED_BLOCKER_${code}`,
        detail: `${count} opportunities share the same open ${code.replace(/_/g, " ").toLowerCase()} gap`,
        affected: count,
        kind: "SHARED_BLOCKER",
      });
    }
  }
  const insufficientRealDataCount = rows.filter(
    (row) => row.experimentCount > 0 && !row.experimentSufficient,
  ).length;
  if (insufficientRealDataCount >= PORTFOLIO_POLICY.INSUFFICIENT_EXPERIMENT_WARNING) {
    concentrationWarnings.push({
      code: "INSUFFICIENT_EXPERIMENT_DATA",
      detail: `${insufficientRealDataCount} experiments lack sufficient REAL_DATA coverage`,
      affected: insufficientRealDataCount,
      kind: "DATA_QUALITY",
    });
  }
  const staleShare = activeOpportunities > 0 ? staleOpportunityCount / activeOpportunities : 0;
  if (staleShare >= PORTFOLIO_POLICY.STALE_SHARE_WARNING) {
    concentrationWarnings.push({
      code: "STALE_RESEARCH_CLUSTER",
      detail: `${Math.round(staleShare * 100)}% of active opportunities hold stale research`,
      affected: staleOpportunityCount,
      kind: "DATA_QUALITY",
    });
  }
  const failedRunCount = rows.filter(
    (row) => row.latestResearchRunStatus === "FAILED",
  ).length;
  if (failedRunCount >= PORTFOLIO_POLICY.FAILED_RUN_WARNING) {
    concentrationWarnings.push({
      code: "SHARED_RESEARCH_FAILURE",
      detail: `${failedRunCount} opportunities have a FAILED latest research run (may indicate a shared provider issue)`,
      affected: failedRunCount,
      kind: "DEPENDENCY",
    });
  }

  /* ---------------- Recommendations (Phase 9, neutral labels) ---------- */
  const priorityInputs: OpportunityPriorityInput[] = rows.map((row) => ({
    opportunityId: row.opportunityId,
    decisionScore: row.decisionScore,
    evidenceGapCount: row.evidenceGapCount,
    validationGapCount: row.validationGapCount,
    decisionState: row.decision,
    hasExperiment: row.experimentCount > 0,
    realMetricPeriods: row.realMetricPeriods,
    estimatedMetricPeriods: row.estimatedMetricPeriods,
    lastExperimentMetricAt: row.lastExperimentMetricAt,
    hasLearningSignal: row.hasLearningSignal,
    researchFreshnessKind: row.researchFreshnessKind,
    hasContradictions: row.hasContradictions,
    requiresHumanApproval: row.requiresHumanApproval,
    hasExecutionBlocker: row.hasExecutionBlocker,
    isBlocked: row.isBlocked,
    dataClass: row.dataClass,
    now,
  }));
  const ranked: OpportunityPriority[] = prioritizeOpportunities(priorityInputs);
  const recommendations: PortfolioRecommendation[] = ranked
    .slice(0, PORTFOLIO_POLICY.MAX_RECOMMENDED)
    .map((item) => ({
      opportunityId: item.opportunityId,
      label: item.label,
      reason: item.reason,
      priorityScore: item.priorityScore,
    }));
  const recommendedOpportunityIds = recommendations.map((item) => item.opportunityId);
  const recommendedNextActions = recommendations.map((item) => `${item.label}: ${item.reason}`);

  /* ---------------- Explanation ---------------- */
  explanation.push(
    `Portfolio decision is ${portfolioDecision}: ${portfolioActionForDecision(portfolioDecision)}`,
  );
  explanation.push(
    `${totalOpportunities} total opportunity(ies); ${activeOpportunities} active, ${blockedOpportunities} blocked.`,
  );
  if (staleOpportunityCount > 0) {
    explanation.push(
      `${staleOpportunityCount} opportunity(ies) hold research older than the freshness threshold; staleness never implies demand changed.`,
    );
  }
  if (experimentCoverageSummary.estimatedOnly > 0) {
    explanation.push(
      `${experimentCoverageSummary.estimatedOnly} experiment(s) contain ESTIMATED_DATA only; estimated data never informs the portfolio decision.`,
    );
  }
  if (options.truncated) {
    explanation.push(
      `Bounded read applied: at most ${PORTFOLIO_POLICY.MAX_OPPORTUNITIES} opportunities are aggregated; the portfolio view is bounded.`,
    );
  }

  /* ---------------- Portfolio confidence ---------------- */
  // Average of persisted validation confidence across the portfolio; 0 when
  // nothing real backs it. Never invented.
  const portfolioConfidence = averageConfidence;

  /* ---------------- Data class of the portfolio result ---------------- */
  const dataClass: OpportunityPortfolioIntelligence["dataClass"] =
    realDataOpportunities > 0 ? "REAL_DATA" : aiEstimateOpportunities > 0 ? "AI_ESTIMATE" : "REAL_DATA";

  return {
    totalOpportunities,
    activeOpportunities,
    blockedOpportunities,
    researchRequired,
    validationRequired,
    experimentsRequired: experimentRequired,
    handoffReady,
    executionReady,
    humanReviewRequired,
    portfolioConfidence,
    concentrationWarnings,
    staleOpportunityCount,
    evidenceQualitySummary,
    experimentCoverageSummary,
    recommendedOpportunityIds,
    recommendedNextActions,
    queues,
    portfolioDecision,
    recommendations,
    explanation,
    dataClass,
    generatedAt: now.toISOString(),
    bounds: { maxOpportunities: PORTFOLIO_POLICY.MAX_OPPORTUNITIES, truncated: Boolean(options.truncated) },
  };
}
