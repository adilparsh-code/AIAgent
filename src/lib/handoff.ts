import type { Evidence, ResearchConclusion } from "./research-types";
import type { Opportunity } from "./types";

/**
 * Phase 5 — Opportunity Handoff Contract (machine-readable).
 *
 * A handoff package is the stable boundary between AIAgent (research/validation)
 * and AI Income Lab (execution/experiments). Every field is traceable to
 * persisted opportunity/research data; nothing is invented here.
 */
export type HandoffStatus = "DRAFT" | "HANDOFF_READY" | "ACCEPTED" | "REJECTED" | "COMPLETED";

export type MetricDataClass = "REAL_DATA" | "ESTIMATED_DATA";

/** A single monetization option carried into the handoff (from the opportunity). */
export interface HandoffMonetizationOption {
  method: string;
}

/**
 * Evidence snapshot included in the package. Full evidence rows stay in the
 * research run; the package carries the traceable references and scores.
 */
export interface HandoffEvidenceRef {
  evidenceId: string;
  source: string;
  url: string;
  title: string;
  supports: string[];
}

export type HandoffRecommendedExperimentType = "MVP_BUILD" | "ASSET_LAUNCH";

/**
 * Input required to build a handoff. The opportunity must already have its
 * last research run persisted (the research engine fills these fields).
 */
export interface HandoffSourceData {
  opportunity: Opportunity;
  lastResearchConclusion: ResearchConclusion | null;
  lastResearchConfidence: number | null;
  lastResearchEvidence: Evidence[];
  /** Optional explicit hypothesis; when omitted one is derived from the opportunity. */
  experimentHypothesisOverride?: string | null;
}

/**
 * The Opportunity Handoff Contract. This is the serialized object AI Income
 * Lab accepts; its shape is versioned so the boundary stays stable.
 */
export interface OpportunityHandoffContract {
  contractVersion: 1;
  handoffId: string;
  opportunityId: string;
  title: string;
  category: string;
  targetAudience: string;
  problem: string;
  validationConclusion: ResearchConclusion | null;
  confidence: number | null;
  score: number | null;
  evidence: HandoffEvidenceRef[];
  monetizationOptions: HandoffMonetizationOption[];
  risks: string[];
  recommendedExperiment: HandoffRecommendedExperimentType;
  experimentHypothesis: string;
  successCriteria: string[];
  budgetLimit: number | null;
  timeLimitDays: number | null;
  handoffStatus: HandoffStatus;
}

/**
 * Why an opportunity is or is not eligible for handoff. Every rule maps to a
 * persisted fact — conclusions come from evidence-driven validation, never
 * from an AI opinion.
 */
export type HandoffIneligibilityReason =
  | "OPPORTUNITY_REJECTED"
  | "OPPORTUNITY_HALAL_NOT_ALLOWED"
  | "NO_RESEARCH_RUN"
  | "VALIDATION_NOT_PERMITS_IMPLEMENTATION"
  | "NO_EVIDENCE"
  | "CONTRADICTIONS_PRESENT"
  | "NO_CONFIDENCE"
  | "NO_SCORE"
  | "MISSING_EXPERIMENT_HYPOTHESIS"
  | "MISSING_SUCCESS_CRITERIA"
  | "MISSING_RISKS";

export interface HandoffEligibility {
  eligible: boolean;
  reasons: HandoffIneligibilityReason[];
}

/**
 * THE authoritative handoff eligibility policy.
 *
 * Every handoff path — the canonical opportunity handoff contract and the
 * discovery candidate projection — must decide through this module. There is
 * exactly one list of implementation-permitted conclusions and exactly one
 * gate function; a second list would reintroduce the HIGH-2 conflict where
 * discovery advertised a candidate as handoff-ready that the canonical handoff
 * API then rejected.
 */
export const HANDOFF_IMPLEMENTATION_PERMITTED_CONCLUSIONS: readonly ResearchConclusion[] = [
  "VALIDATED",
  "REQUIRES_HUMAN_REVIEW",
] as const;

const IMPLEMENTATION_PERMITTED_CONCLUSIONS: ReadonlySet<ResearchConclusion> = new Set(
  HANDOFF_IMPLEMENTATION_PERMITTED_CONCLUSIONS,
);

/**
 * Conclusions that permit implementation. PROMISING is deliberately excluded
 * (per product rule: only validated opportunities proceed) but REQUIRES_HUMAN_REVIEW
 * is permitted because a human has reviewed and explicitly chosen to proceed.
 * REJECTED never permits implementation.
 */
export function isImplementationPermittedConclusion(
  conclusion: ResearchConclusion | null | undefined,
): boolean {
  return conclusion !== null && conclusion !== undefined && IMPLEMENTATION_PERMITTED_CONCLUSIONS.has(conclusion);
}

/**
 * Normalized facts evaluated by the single handoff gate. Callers translate their
 * own data shape into these facts; the rules themselves live in one place.
 */
export interface HandoffGateFacts {
  /** The evidence-driven research conclusion, or null when no run exists. */
  conclusion: ResearchConclusion | null;
  /** Opportunity is explicitly REJECTED (canonical path only). */
  opportunityRejected?: boolean;
  /** Opportunity is explicitly NOT_ALLOWED under the halal model. */
  halalNotAllowed?: boolean;
  /** At least one evidence item supports the conclusion. */
  hasEvidence: boolean;
  /** A finite, recorded confidence value exists. */
  hasConfidence: boolean;
  /** A finite, recorded score exists. */
  hasScore: boolean;
  /** Risks are recorded. */
  hasRisks: boolean;
  /** A non-empty experiment hypothesis can be produced. */
  hasHypothesis?: boolean;
  /**
   * Discovery cannot prove an opportunity-level rejection flag, so it declares
   * the extra gate it *can* prove: contradictions recorded against the
   * evidence. The canonical path leaves this false because a contradicting run
   * is exactly the case a human explicitly reviewed (REQUIRES_HUMAN_REVIEW).
   */
  blockOnContradictions?: boolean;
  /** Number of contradictions recorded for the underlying run. */
  contradictionCount?: number;
}

/**
 * The one handoff gate. Returns every reason an opportunity is not eligible, so
 * a caller can never report a reason list from a different rule set.
 */
export function evaluateHandoffGate(facts: HandoffGateFacts): HandoffEligibility {
  const reasons: HandoffIneligibilityReason[] = [];

  if (facts.opportunityRejected) reasons.push("OPPORTUNITY_REJECTED");
  if (facts.halalNotAllowed) reasons.push("OPPORTUNITY_HALAL_NOT_ALLOWED");

  if (!facts.conclusion) reasons.push("NO_RESEARCH_RUN");
  else if (!isImplementationPermittedConclusion(facts.conclusion)) {
    reasons.push("VALIDATION_NOT_PERMITS_IMPLEMENTATION");
  }

  if (!facts.hasEvidence) reasons.push("NO_EVIDENCE");
  if (facts.blockOnContradictions && (facts.contradictionCount ?? 0) > 0) {
    reasons.push("CONTRADICTIONS_PRESENT");
  }
  if (!facts.hasConfidence) reasons.push("NO_CONFIDENCE");
  if (!facts.hasScore) reasons.push("NO_SCORE");
  if (facts.hasHypothesis === false) reasons.push("MISSING_EXPERIMENT_HYPOTHESIS");
  if (!facts.hasRisks) reasons.push("MISSING_RISKS");

  return { eligible: reasons.length === 0, reasons };
}

/**
 * Discovery-side projection of the same policy. Discovery proves conclusion,
 * evidence coverage, confidence and contradictions; score, risks and hypothesis
 * are derived earlier in the discovery pipeline and are re-checked against the
 * persisted opportunity by the canonical handoff path.
 */
export function evaluateResearchHandoffReadiness(facts: {
  conclusion: ResearchConclusion;
  confidence: number;
  evidenceCoverage: number;
  contradictionCount: number;
}): HandoffEligibility {
  return evaluateHandoffGate({
    conclusion: facts.conclusion,
    hasEvidence: facts.evidenceCoverage > 0,
    hasConfidence: Number.isFinite(facts.confidence),
    hasScore: true,
    hasRisks: true,
    hasHypothesis: true,
    blockOnContradictions: true,
    contradictionCount: facts.contradictionCount,
  });
}

/** Default hypothesis used when the opportunity has no explicit one — traceable to its problem statement. */
export function defaultExperimentHypothesis(opportunity: Opportunity): string {
  return (
    `Shipping a minimal version of "${opportunity.title}" will produce early ` +
    `adoption signals from ${opportunity.targetAudience || "the target audience"} ` +
    `(problem: ${opportunity.problemSolved || "as documented"}).`
  );
}

/** The hypothesis carried by the handoff: explicit override when valid, otherwise derived. */
export function resolveExperimentHypothesis(source: HandoffSourceData): string {
  const override = source.experimentHypothesisOverride?.trim();
  return override ? override : defaultExperimentHypothesis(source.opportunity);
}

/**
 * Validate that an opportunity may be marked HANDOFF_READY. Explicit, documented
 * rules only — no invented market data and no AI judgment.
 */
export function evaluateHandoffEligibility(source: HandoffSourceData): HandoffEligibility {
  const { opportunity, lastResearchConclusion, lastResearchConfidence, lastResearchEvidence } = source;

  return evaluateHandoffGate({
    conclusion: lastResearchConclusion ?? null,
    opportunityRejected: opportunity.status === "REJECTED",
    halalNotAllowed: opportunity.halalStatus === "NOT_ALLOWED",
    hasEvidence: Array.isArray(lastResearchEvidence) && lastResearchEvidence.length > 0,
    hasConfidence:
      lastResearchConfidence !== null &&
      lastResearchConfidence !== undefined &&
      Number.isFinite(lastResearchConfidence),
    hasScore:
      opportunity.overallScore !== null &&
      opportunity.overallScore !== undefined &&
      Number.isFinite(opportunity.overallScore),
    hasRisks: Array.isArray(opportunity.risks) && opportunity.risks.length > 0,
    hasHypothesis: resolveExperimentHypothesis(source).trim().length > 0,
  });
}

/**
 * Success criteria recorded on the handoff. Derived only from persisted facts:
 * the research conclusion, evidence coverage and the opportunity's own target.
 * Nothing numeric is invented — criteria are qualitative and traceable.
 */
export function buildSuccessCriteria(source: HandoffSourceData): string[] {
  const criteria: string[] = [];
  const { lastResearchEvidence, lastResearchConclusion } = source;
  if (lastResearchEvidence.length > 0) {
    criteria.push(
      `MVP tested with the recorded evidence base (${lastResearchEvidence.length} evidence item(s) from research).`,
    );
  }
  if (lastResearchConclusion) {
    criteria.push(`Execution outcome recorded against the research conclusion: ${lastResearchConclusion}.`);
  }
  if (source.opportunity.nextAction) {
    criteria.push(`First step executed: ${source.opportunity.nextAction}.`);
  }
  return criteria;
}

export function buildMonetizationOptions(opportunity: Opportunity): HandoffMonetizationOption[] {
  return opportunity.monetizationMethod
    .split(/[;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((method) => ({ method }));
}
