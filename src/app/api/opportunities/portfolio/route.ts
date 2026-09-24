import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getOpportunityPortfolio } from "@/lib/server/opportunity-portfolio-service";

/**
 * GET /api/opportunities/portfolio — deterministic portfolio intelligence for
 * the signed-in owner, computed from persisted application data only.
 *
 * - requireUser() first; identity comes from the server session.
 * - Owner-scoped: only the caller's own non-sample opportunities are read, so
 *   there is no cross-user opportunity / research / experiment leakage.
 * - Bounded database reads (constant query count), no external API calls, no
 *   secrets, deterministic output.
 * - Advisory only: the portfolio can never execute, publish, send, or spend.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const intelligence = await getOpportunityPortfolio(user.id);
    return NextResponse.json({
      summary: {
        totalOpportunities: intelligence.totalOpportunities,
        activeOpportunities: intelligence.activeOpportunities,
        blockedOpportunities: intelligence.blockedOpportunities,
        researchRequired: intelligence.researchRequired,
        validationRequired: intelligence.validationRequired,
        experimentsRequired: intelligence.experimentsRequired,
        handoffReady: intelligence.handoffReady,
        executionReady: intelligence.executionReady,
        humanReviewRequired: intelligence.humanReviewRequired,
        portfolioConfidence: intelligence.portfolioConfidence,
        staleOpportunityCount: intelligence.staleOpportunityCount,
        bounds: intelligence.bounds,
      },
      queues: intelligence.queues,
      portfolioDecision: intelligence.portfolioDecision,
      recommendedOpportunityIds: intelligence.recommendedOpportunityIds,
      recommendedNextActions: intelligence.recommendedNextActions,
      recommendations: intelligence.recommendations,
      concentrationWarnings: intelligence.concentrationWarnings,
      evidenceQualitySummary: intelligence.evidenceQualitySummary,
      experimentCoverageSummary: intelligence.experimentCoverageSummary,
      explanation: intelligence.explanation,
      dataClass: intelligence.dataClass,
      generatedAt: intelligence.generatedAt,
    });
  } catch (error) {
    return apiError(error, "Failed to load portfolio intelligence");
  }
}
