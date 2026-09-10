import type { ScoreBreakdown } from "./types";

// Scoring weights - transparent and configurable
export const SCORING_WEIGHTS = {
  demand: 0.2,
  commercialIntent: 0.2,
  competitionOpportunity: 0.15,
  startupCost: 0.1,
  automationPotential: 0.1,
  differentiation: 0.1,
  monetizationStrength: 0.1,
  halalCompliance: 0.05,
} as const;

export const WEIGHT_LABELS: Record<keyof typeof SCORING_WEIGHTS, string> = {
  demand: "Demand",
  commercialIntent: "Commercial Intent",
  competitionOpportunity: "Competition Opportunity",
  startupCost: "Startup Cost",
  automationPotential: "Automation Potential",
  differentiation: "Differentiation",
  monetizationStrength: "Monetization Strength",
  halalCompliance: "Halal/Compliance Confidence",
};

/**
 * Calculate the overall opportunity score using weighted factors.
 * All scores are 0-100. The result is 0-100.
 */
export function calculateOverallScore(breakdown: ScoreBreakdown): number {
  const score =
    breakdown.demand * SCORING_WEIGHTS.demand +
    breakdown.commercialIntent * SCORING_WEIGHTS.commercialIntent +
    breakdown.competitionOpportunity * SCORING_WEIGHTS.competitionOpportunity +
    breakdown.startupCost * SCORING_WEIGHTS.startupCost +
    breakdown.automationPotential * SCORING_WEIGHTS.automationPotential +
    breakdown.differentiation * SCORING_WEIGHTS.differentiation +
    breakdown.monetizationStrength * SCORING_WEIGHTS.monetizationStrength +
    breakdown.halalCompliance * SCORING_WEIGHTS.halalCompliance;

  return Math.round(score * 10) / 10;
}

/**
 * Get the weighted contribution of each factor to the overall score.
 */
export function getScoreContributions(breakdown: ScoreBreakdown): {
  key: keyof ScoreBreakdown;
  label: string;
  rawScore: number;
  weight: number;
  weightedScore: number;
}[] {
  return (Object.keys(SCORING_WEIGHTS) as Array<keyof typeof SCORING_WEIGHTS>).map(
    (key) => ({
      key,
      label: WEIGHT_LABELS[key],
      rawScore: breakdown[key],
      weight: SCORING_WEIGHTS[key],
      weightedScore: Math.round(breakdown[key] * SCORING_WEIGHTS[key] * 10) / 10,
    })
  );
}

/**
 * A NOT_ALLOWED opportunity must never receive a normal positive recommendation.
 * Returns a safe recommendation string instead.
 */
export function getRecommendation(halalStatus: string, title: string, score: number): string {
  if (halalStatus === "NOT_ALLOWED") {
    return `Blocked: ${title} is marked NOT_ALLOWED and cannot be recommended. Review compliance before any action.`;
  }
  if (halalStatus === "REVIEW_REQUIRED") {
    return `Human review required before scaling ${title} (score ${score.toFixed(1)}/100). Automated screening is not a religious ruling.`;
  }
  return `Recommended: continue validating ${title} (score ${score.toFixed(1)}/100).`;
}

/**
 * Validate that all scores are within 0-100 range.
 */
export function validateScores(breakdown: ScoreBreakdown): boolean {
  return Object.values(breakdown).every(
    (score) => typeof score === "number" && score >= 0 && score <= 100
  );
}
