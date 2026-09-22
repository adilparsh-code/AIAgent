import { SCORING_WEIGHTS } from "./scoring";
import type { ScoreIntegration } from "./research-types";
import type { OpportunityEvidenceBundle, RankedFactor, RankingBreakdown, ScoreProvenance } from "./discovery-types";

function factor(
  key: string,
  label: string,
  value: number | null,
  provenance: ScoreProvenance,
  basis: string,
): RankedFactor {
  return { key, label, value, provenance, basis };
}

function signalScore(status: string): { value: number | null; provenance: ScoreProvenance; basisSuffix: string } {
  if (status === "SUPPORTED") {
    return { value: 80, provenance: "evidence-backed", basisSuffix: "SUPPORTED by research evidence." };
  }
  if (status === "MIXED") {
    return { value: 45, provenance: "evidence-backed", basisSuffix: "MIXED evidence — not treated as full support." };
  }
  return {
    value: null,
    provenance: "unmeasured",
    basisSuffix: "INSUFFICIENT evidence. Missing data is not a positive signal.",
  };
}

/**
 * Extends the existing scoring system without replacing it.
 * Ranking clearly separates evidence-backed signals, calculated scores, and AI estimates.
 * AI estimates are never used as real-world facts and never fill in missing evidence.
 */
export function buildRankingBreakdown(
  bundle: OpportunityEvidenceBundle,
  scoreIntegration: ScoreIntegration | null,
): RankingBreakdown {
  const demand = signalScore(bundle.demand.status);
  const pain = signalScore(bundle.painPoint.status);
  const commercial = signalScore(bundle.commercialIntent.status);
  const trend = signalScore(bundle.trend.status);
  const competition = signalScore(bundle.competition.status);
  const monetization = signalScore(bundle.monetization.status);

  const factors: RankedFactor[] = [
    factor("demand", "Demand", demand.value, demand.provenance, `${bundle.demand.basis} ${demand.basisSuffix}`),
    factor("pain-point", "Pain / problem", pain.value, pain.provenance, `${bundle.painPoint.basis} ${pain.basisSuffix}`),
    factor(
      "commercial-intent",
      "Commercial intent",
      commercial.value,
      commercial.provenance,
      `${bundle.commercialIntent.basis} ${commercial.basisSuffix}`,
    ),
    factor("trend", "Trend", trend.value, trend.provenance, `${bundle.trend.basis} ${trend.basisSuffix}`),
    factor(
      "competition",
      "Competition",
      competition.value,
      competition.provenance,
      `${bundle.competition.basis} ${competition.basisSuffix} Absence of competition evidence is not a blue-ocean signal.`,
    ),
    factor(
      "monetization",
      "Monetization",
      monetization.value,
      monetization.provenance,
      `${bundle.monetization.basis} ${monetization.basisSuffix}`,
    ),
    factor(
      "evidence-quality",
      "Evidence quality",
      bundle.evidenceCoverage ? Number((bundle.evidenceQuality * 100).toFixed(1)) : null,
      bundle.evidenceCoverage ? "calculated" : "unmeasured",
      bundle.evidenceCoverage
        ? `Average evidence quality ${bundle.evidenceQuality.toFixed(2)} across ${bundle.evidenceCoverage} item(s).`
        : "No evidence to score quality.",
    ),
    factor(
      "coverage",
      "Evidence coverage",
      bundle.evidenceCoverage,
      bundle.evidenceCoverage ? "calculated" : "unmeasured",
      `${bundle.evidenceCoverage} evidence item(s), ${bundle.sourceDiversity} provider(s).`,
    ),
    factor(
      "research-suggested-overall",
      "Existing scoring engine suggestion",
      scoreIntegration?.suggestedOverallScore ?? null,
      scoreIntegration?.suggestedOverallScore == null ? "unmeasured" : "calculated",
      scoreIntegration?.suggestedOverallScore == null
        ? scoreIntegration?.note ??
          "Existing scoring engine did not suggest a score (too few research-supported factors)."
        : `Existing weighted engine suggestion ${scoreIntegration.suggestedOverallScore} (weights unchanged: demand ${SCORING_WEIGHTS.demand}, commercial ${SCORING_WEIGHTS.commercialIntent}). Not a measured revenue figure.`,
    ),
    factor(
      "ai-estimate",
      "AI estimate",
      null,
      "ai-estimate",
      "No AI estimate is used as a real-world fact. Discovery does not invent demand, traffic, or revenue numbers.",
    ),
  ];

  const evidenceValues = factors
    .filter((item) => item.provenance === "evidence-backed" && typeof item.value === "number")
    .map((item) => item.value as number);
  const evidenceBackedScore = evidenceValues.length
    ? Number((evidenceValues.reduce((sum, value) => sum + value, 0) / 6).toFixed(1))
    : 0;

  const calculatedScore = scoreIntegration?.suggestedOverallScore ?? null;
  const aiEstimateScore = null;
  const coverageRatio = bundle.evidenceCoverage > 0 ? Math.min(1, bundle.sourceDiversity / 3) : 0;

  let rankingScore = 0;
  if (bundle.evidenceCoverage > 0) {
    rankingScore =
      evidenceBackedScore * 0.6 +
      bundle.confidence * 100 * 0.25 +
      (calculatedScore ?? 0) * 0.15 +
      coverageRatio * 5;
    rankingScore -= Math.min(25, bundle.contradictionCount * 8);
    rankingScore = Math.max(0, Math.min(100, rankingScore));
  }

  if (bundle.conclusion === "CONTRADICTED") {
    rankingScore = Math.min(rankingScore, 20);
  }
  if (bundle.conclusion === "INSUFFICIENT_EVIDENCE") {
    rankingScore = Math.min(rankingScore, 15);
  }

  rankingScore = Number(rankingScore.toFixed(1));

  const note = bundle.evidenceCoverage
    ? `Ranking uses evidence-backed signals first. Calculated score ${calculatedScore ?? "none"}. AI estimates are not treated as facts. ${bundle.contradictionCount} contradiction(s).`
    : "No evidence collected — ranking score is 0. Missing data is not support.";

  return {
    rankingScore,
    evidenceBackedScore,
    calculatedScore,
    aiEstimateScore,
    coverageRatio: Number(coverageRatio.toFixed(2)),
    factors,
    note,
  };
}

export function compareCandidatesForRank(
  a: { rankingScore: number; evidenceCoverage: number; contradictionCount: number; confidence: number },
  b: { rankingScore: number; evidenceCoverage: number; contradictionCount: number; confidence: number },
): number {
  if (a.evidenceCoverage === 0 && b.evidenceCoverage > 0) return 1;
  if (b.evidenceCoverage === 0 && a.evidenceCoverage > 0) return -1;
  if (b.rankingScore !== a.rankingScore) return b.rankingScore - a.rankingScore;
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  return a.contradictionCount - b.contradictionCount;
}
