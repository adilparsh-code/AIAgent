import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getGrowthPortfolioState, GROWTH_PORTFOLIO_BOUNDS } from "@/lib/server/growth-portfolio-service";

/**
 * GET /api/growth/portfolio — Phase 23 owner-scoped growth state.
 *
 * - requireUser() first; identity comes only from the server session.
 * - Reads the caller's own non-sample rows; no cross-tenant access.
 * - Bounded reads; advisory only; never executes, spends, or publishes.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const state = await getGrowthPortfolioState(user.id);
    return NextResponse.json({
      portfolioDecision: state.portfolioDecision,
      capacity: state.capacity,
      runawaySignals: state.runawaySignals,
      closedLoopSummary: state.closedLoopSummary,
      experiments: state.experiments,
      queues: state.controller.queues,
      selectedOpportunityIds: state.controller.selectedOpportunityIds,
      deferredOpportunityIds: state.controller.deferredOpportunityIds,
      controllerReasons: state.controller.reasons,
      explanation: state.explanation,
      dataClass: state.dataClass,
      generatedAt: state.generatedAt,
      bounds: GROWTH_PORTFOLIO_BOUNDS,
    });
  } catch (error) {
    return apiError(error, "Failed to load growth portfolio state");
  }
}
