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
 * Conclusions that permit implementation. PROMISING is deliberately excluded
 * (per product rule: only validated opportunities proceed) but REQUIRES_HUMAN_REVIEW
 * is permitted because a human has reviewed and explicitly chosen to proceed.
 * REJECTED never permits implementation.
 */
const IMPLEMENTATION_PERMITTED_CONCLUSIONS: ReadonlySet<ResearchConclusion> = new Set([
  "VALIDATED",
  "REQUIRES_HUMAN_REVIEW",
]);

export function isImplementationPermittedConclusion(conclusion: ResearchConclusion | null): boolean {
  return conclusion !== null && IMPLEMENTATION_PERMITTED_CONCLUSIONS.has(conclusion);
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
  const reasons: HandoffIneligibilityReason[] = [];
  const { opportunity, lastResearchConclusion, lastResearchConfidence, lastResearchEvidence } = source;

  if (opportunity.status === "REJECTED") reasons.push("OPPORTUNITY_REJECTED");
  if (opportunity.halalStatus === "NOT_ALLOWED") reasons.push("OPPORTUNITY_HALAL_NOT_ALLOWED");
  if (!lastResearchConclusion) reasons.push("NO_RESEARCH_RUN");
  else if (!isImplementationPermittedConclusion(lastResearchConclusion)) {
    reasons.push("VALIDATION_NOT_PERMITS_IMPLEMENTATION");
  }
  if (!lastResearchEvidence || lastResearchEvidence.length === 0) reasons.push("NO_EVIDENCE");
  if (
    lastResearchConfidence === null ||
    lastResearchConfidence === undefined ||
    !Number.isFinite(lastResearchConfidence)
  ) {
    reasons.push("NO_CONFIDENCE");
  }
  if (
    opportunity.overallScore === null ||
    opportunity.overallScore === undefined ||
    !Number.isFinite(opportunity.overallScore)
  ) {
    reasons.push("NO_SCORE");
  }
  if (!resolveExperimentHypothesis(source)) reasons.push("MISSING_EXPERIMENT_HYPOTHESIS");
  if (!opportunity.risks || opportunity.risks.length === 0) reasons.push("MISSING_RISKS");

  return { eligible: reasons.length === 0, reasons };
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
