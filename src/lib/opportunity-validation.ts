import type { Evidence, ProviderRunStatus, ResearchRun, ValidationSignal } from "./research-types";
import { buildConclusion, buildValidationSignals, countContradictions } from "./validation";
import type { OpportunityEvidenceBundle } from "./discovery-types";

function emptySignal(key: string, label: string): ValidationSignal {
  return {
    key,
    label,
    status: "INSUFFICIENT",
    evidenceIds: [],
    basis: "No evidence collected. Missing data is not positive evidence.",
  };
}

function signalByKey(signals: ValidationSignal[], key: string, label: string): ValidationSignal {
  return signals.find((signal) => signal.key === key) ?? emptySignal(key, label);
}

/**
 * Monetization is never inferred from missing data. It only mirrors commercial-intent
 * evidence already collected by the research orchestrator.
 */
export function buildMonetizationSignal(signals: ValidationSignal[]): ValidationSignal {
  const commercial = signalByKey(signals, "commercial-intent", "Commercial Intent");
  if (commercial.status === "INSUFFICIENT") {
    return emptySignal("monetization", "Monetization");
  }
  return {
    key: "monetization",
    label: "Monetization",
    status: commercial.status,
    evidenceIds: commercial.evidenceIds,
    basis: `Derived only from commercial-intent evidence. ${commercial.basis}`,
  };
}

function averageQuality(evidence: Evidence[]): number {
  if (!evidence.length) return 0;
  return Number(
    (evidence.reduce((sum, item) => sum + item.qualityScore, 0) / evidence.length).toFixed(2),
  );
}

export function collectContradictions(evidence: Evidence[]): string[] {
  const values = evidence.flatMap((item) => item.contradicts).map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set(values));
}

/**
 * Evidence-based opportunity validation. Wraps existing research signals and
 * never treats missing provider data as support.
 */
export function buildOpportunityEvidenceBundle(run: ResearchRun): OpportunityEvidenceBundle {
  const signals = run.validationSignals.length ? run.validationSignals : buildValidationSignals(run.evidence);
  const demand = signalByKey(signals, "demand", "Demand");
  const painPoint = signalByKey(signals, "pain-point", "Pain Point");
  const trend = signalByKey(signals, "trend", "Trend");
  const commercialIntent = signalByKey(signals, "commercial-intent", "Commercial Intent");
  const competition = signalByKey(signals, "competition", "Competition");
  const monetization = buildMonetizationSignal(signals);
  const contradictionCount = countContradictions(run.evidence, run.findings);
  const contradictions = collectContradictions(run.evidence);
  const coverage = run.evidence.length;
  const diversity = new Set(run.evidence.map((item) => item.source)).size;
  const { conclusion, basis } = run.conclusion
    ? { conclusion: run.conclusion, basis: run.conclusionBasis }
    : buildConclusion(
        run.evidence,
        signals,
        run.confidence,
        contradictionCount,
        run.providersAttempted.length,
        run.providersSucceeded.length,
      );

  return {
    demand,
    painPoint,
    trend,
    commercialIntent,
    competition,
    monetization,
    evidenceQuality: averageQuality(run.evidence),
    evidenceCoverage: coverage,
    sourceDiversity: diversity,
    contradictionCount,
    providerStatuses: run.providerStatuses,
    contradictions,
    conclusion,
    conclusionBasis: basis,
    confidence: run.confidence,
  };
}

export function providerHealthSummary(statuses: ProviderRunStatus[]): string[] {
  return statuses.map((status) => {
    if (status.status === "SUCCEEDED") {
      return `${status.name}: succeeded (${status.evidenceCount} evidence)`;
    }
    if (status.status === "EMPTY") {
      return `${status.name}: empty (ran, no usable evidence)`;
    }
    if (status.status === "CONFIG_ERROR") {
      return `${status.name}: unavailable/not configured — no data invented`;
    }
    return `${status.name}: ${status.status.toLowerCase()}${status.error ? ` (${status.error})` : ""}`;
  });
}

/** Phase 18 validation states. These are explainable gates, not a second decision engine. */
export const OPPORTUNITY_VALIDATION_STATES = [
  "RESEARCH_REQUIRED",
  "EVIDENCE_INSUFFICIENT",
  "VALIDATION_READY",
  "VALIDATED",
  "INVALIDATED",
  "INCONCLUSIVE",
  "BLOCKED",
  "HUMAN_REVIEW",
] as const;
export type OpportunityValidationState = (typeof OPPORTUNITY_VALIDATION_STATES)[number];

export interface OpportunityValidationResult {
  opportunityId: string;
  state: OpportunityValidationState;
  dataClass: "REAL_DATA" | "AI_ESTIMATE" | "SAMPLE_DATA" | "UNKNOWN";
  considered: {
    decision: string;
    readiness: string;
    researchFreshness: string;
    evidenceCoverage: number;
    sourceDiversity: number;
    contradictionCount: number;
    realMetricPeriods: number;
    estimatedMetricPeriods: number;
    experimentCount: number;
    measurementStatus: "REAL_DATA" | "ESTIMATED_DATA" | "NOT_MEASURED";
    providerStates: Array<{ provider: string; status: string; verified: boolean }>;
  };
  reasons: string[];
  missing: string[];
  blockers: string[];
  nextAction: string;
  generatedAt: string;
}

export interface CalculateOpportunityValidationInput {
  opportunityId: string;
  decision: import("./opportunity-decision").OpportunityDecision;
  readiness: import("./opportunity-readiness").OpportunityReadiness;
  providers?: Array<{ provider: string; status: string; verified: boolean }>;
  evidenceCoverage?: number;
  sourceDiversity?: number;
  now?: Date;
}

/**
 * Compose existing readiness and decision outputs into a controlled validation
 * gate. It never executes providers, writes measurements, or claims validation
 * merely because an experiment execution completed.
 */
export function calculateOpportunityValidation(input: CalculateOpportunityValidationInput): OpportunityValidationResult {
  const now = input.now ?? new Date();
  const { decision, readiness } = input;
  const providers = [...(input.providers ?? [])].sort((a, b) => a.provider.localeCompare(b.provider));
  const realMetricPeriods = readiness.experimentReadiness.realMetricPeriods;
  const estimatedMetricPeriods = readiness.experimentReadiness.estimatedMetricPeriods;
  const measurementStatus = realMetricPeriods > 0 ? "REAL_DATA" : estimatedMetricPeriods > 0 ? "ESTIMATED_DATA" : "NOT_MEASURED";
  const missing = readiness.missingEvidence.map((item) => `${item.area}: ${item.reason}`);
  const blockers = [...readiness.blockers];
  const reasons: string[] = [];
  let state: OpportunityValidationState;

  if (decision.decision === "BLOCKED" || readiness.readinessState === "BLOCKED") {
    state = "BLOCKED";
    reasons.push("The authoritative opportunity decision/readiness gate is blocked.");
  } else if (readiness.researchFreshness.kind === "NO_RESEARCH") {
    state = "RESEARCH_REQUIRED";
    reasons.push("No completed or partial research run exists.");
  } else if (readiness.staleResearch) {
    state = "RESEARCH_REQUIRED";
    reasons.push(`Research is ${readiness.researchFreshness.ageDays ?? "unknown"} days old and exceeds the configured freshness threshold.`);
  } else if (readiness.contradictions.length > 0 || decision.decision === "REVIEW_CONFLICT") {
    state = "HUMAN_REVIEW";
    reasons.push("Persisted contradictions require review before progression.");
  } else if (missing.length > 0 || decision.decision === "RESEARCH_MORE") {
    state = "EVIDENCE_INSUFFICIENT";
    reasons.push("Required persisted evidence is missing or below the existing readiness thresholds.");
  } else if (decision.decision === "HANDOFF_READY" || decision.decision === "EXECUTION_READY") {
    state = "VALIDATED";
    reasons.push("Existing decision and readiness gates permit progression from current evidence.");
  } else if (decision.decision === "VALIDATE" || readiness.readinessState === "VALIDATION_REQUIRED") {
    state = "VALIDATION_READY";
    reasons.push("Research and evidence gates are satisfied; a controlled experiment can collect measurements.");
  } else {
    state = "INCONCLUSIVE";
    reasons.push("Current persisted data does not establish a validation or invalidation outcome.");
  }

  if (providers.some((provider) => ["AUTH_FAILED", "CREDIT_LIMITED", "RATE_LIMITED", "UNAVAILABLE", "DEGRADED", "FAILED"].includes(provider.status))) {
    blockers.push("One or more required providers are not healthy; configuration is not treated as health.");
  }
  if (measurementStatus === "ESTIMATED_DATA") {
    reasons.push("Only estimated experiment periods exist; they remain non-real and cannot validate an outcome.");
  } else if (measurementStatus === "NOT_MEASURED") {
    reasons.push("No source-backed experiment measurement exists; measurement status remains NOT_MEASURED.");
  }
  if (state === "BLOCKED") blockers.push("Authoritative decision or readiness is BLOCKED");

  return {
    opportunityId: input.opportunityId,
    state,
    dataClass: decision.dataClass,
    considered: {
      decision: decision.decision,
      readiness: readiness.readinessState,
      researchFreshness: readiness.researchFreshness.kind,
      evidenceCoverage: input.evidenceCoverage ?? 0,
      sourceDiversity: input.sourceDiversity ?? 0,
      contradictionCount: readiness.contradictions.length,
      realMetricPeriods,
      estimatedMetricPeriods,
      experimentCount: readiness.experimentReadiness.experimentCount,
      measurementStatus,
      providerStates: providers,
    },
    reasons,
    missing,
    blockers: [...new Set(blockers)],
    nextAction: readiness.recommendedNextAction.action,
    generatedAt: now.toISOString(),
  };
}
