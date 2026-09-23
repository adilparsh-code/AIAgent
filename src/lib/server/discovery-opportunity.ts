import "server-only";
import type { DiscoveryCandidateSeed, OpportunityEvidenceBundle } from "../discovery-types";
import { calculateOverallScore } from "../scoring";
import { opportunityRepository } from "./repositories/opportunities";
import type { Opportunity } from "../types";

function signalToDemand(status: string): number {
  if (status === "SUPPORTED") return 80;
  if (status === "MIXED") return 45;
  return 0;
}

/**
 * Map evidence to Opportunity score fields without treating missing data as upside.
 * Unmeasured competition is scored as 100 intensity so competitionOpportunity is 0.
 * Unknown startup cost is set high enough that it does not inflate the overall score.
 */
export function scoresFromEvidence(bundle: OpportunityEvidenceBundle | null): Pick<
  Opportunity,
  | "demandScore"
  | "competitionScore"
  | "commercialIntentScore"
  | "automationScore"
  | "differentiationScore"
  | "monetizationStrengthScore"
  | "halalScore"
  | "estimatedStartupCost"
  | "confidence"
  | "overallScore"
> {
  const demandScore = bundle ? signalToDemand(bundle.demand.status) : 0;
  const commercialIntentScore = bundle ? signalToDemand(bundle.commercialIntent.status) : 0;
  const monetizationStrengthScore = bundle ? signalToDemand(bundle.monetization.status) : 0;
  const competitionScore =
    !bundle || bundle.competition.status === "INSUFFICIENT"
      ? 100
      : bundle.competition.status === "SUPPORTED"
        ? 55
        : 70;
  const estimatedStartupCost = 200;
  const automationScore = 0;
  const differentiationScore = 0;
  const halalScore = 0;
  const confidence = bundle ? Math.round(bundle.confidence * 100) : 0;
  const overallScore = calculateOverallScore({
    demand: demandScore,
    commercialIntent: commercialIntentScore,
    competitionOpportunity: 100 - competitionScore,
    startupCost: Math.max(0, 100 - estimatedStartupCost / 2),
    automationPotential: automationScore,
    differentiation: differentiationScore,
    monetizationStrength: monetizationStrengthScore,
    halalCompliance: halalScore,
  });
  return {
    demandScore,
    competitionScore,
    commercialIntentScore,
    automationScore,
    differentiationScore,
    monetizationStrengthScore,
    halalScore,
    estimatedStartupCost,
    confidence,
    overallScore,
  };
}

export function statusFromConclusion(conclusion: string | undefined): Opportunity["status"] {
  switch (conclusion) {
    case "VALIDATED":
      return "VALIDATED";
    case "PROMISING":
      return "VALIDATING";
    case "REJECTED":
    case "CONTRADICTED":
      return "REJECTED";
    case "REQUIRES_HUMAN_REVIEW":
      return "VALIDATING";
    default:
      return "RESEARCHING";
  }
}

export async function createOpportunityForCandidate(
  seed: DiscoveryCandidateSeed,
  bundle: OpportunityEvidenceBundle | null,
  nextAction: string,
  ownerId?: string | null,
): Promise<Opportunity> {
  const scores = scoresFromEvidence(bundle);
  return opportunityRepository.create({
    title: seed.title,
    category: seed.opportunityCategory,
    businessModel: seed.businessModel,
    targetAudience: seed.targetAudience,
    problemSolved: seed.problemHypothesis,
    monetizationMethod:
      bundle && bundle.monetization.status !== "INSUFFICIENT"
        ? "Commercial-intent evidence exists; revenue method is unmeasured."
        : "Unmeasured — no monetization evidence.",
    estimatedStartupCost: scores.estimatedStartupCost,
    demandScore: scores.demandScore,
    competitionScore: scores.competitionScore,
    commercialIntentScore: scores.commercialIntentScore,
    automationScore: scores.automationScore,
    differentiationScore: scores.differentiationScore,
    monetizationStrengthScore: scores.monetizationStrengthScore,
    halalScore: scores.halalScore,
    halalStatus: "REVIEW_REQUIRED",
    overallScore: scores.overallScore,
    confidence: scores.confidence,
    status: statusFromConclusion(bundle?.conclusion),
    evidence: [],
    risks: bundle?.contradictions ?? [],
    nextAction,
    // Created for the authenticated user who ran discovery.
    ownerId: ownerId ?? null,
  });
}
