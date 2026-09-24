import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getPortfolioOperatingCycle } from "@/lib/server/autonomous-operating-loop-service";

/**
 * GET/POST /api/opportunities/operating-loop — authenticated, owner-scoped,
 * bounded, advisory. It intentionally performs no provider call, approval,
 * persistence, or execution.
 */
async function response() {
  const user = await requireUser();
  const { loop, controller, portfolio } = await getPortfolioOperatingCycle(user.id);
  return NextResponse.json({
    cycleId: loop.cycleId,
    controllerCycleId: controller.cycleId,
    portfolioDecision: loop.portfolioDecision,
    queues: controller.queues,
    queueItems: controller.items,
    selectedOpportunityIds: controller.selectedOpportunityIds,
    deferredOpportunityIds: controller.deferredOpportunityIds,
    limits: controller.limits,
    observed: controller.observed,
    selectedOpportunity: loop.selectedOpportunityId
      ? {
          opportunityId: loop.selectedOpportunityId,
          queue: loop.selectedQueue,
          reason: loop.actionReason,
          decision: loop.currentOpportunityDecision,
          priorityFactors: loop.currentOpportunityDecision?.decisionScore ?? 0,
        }
      : null,
    currentStage: loop.cycleStage,
    nextAction: loop.nextAction,
    blockers: loop.blockers,
    requiredApproval: loop.requiredApproval,
    executionEligible: loop.executionEligible,
    explanation: [...loop.explanation, ...controller.reasons],
    dataClass: loop.dataClass,
    generatedAt: loop.generatedAt,
    portfolioExplanation: portfolio.explanation,
  });
}

export async function GET() {
  try {
    return await response();
  } catch (error) {
    return apiError(error, "Failed to load autonomous operating loop");
  }
}

/** POST is an explicit cycle request, not an execution request. */
export async function POST() {
  try {
    return await response();
  } catch (error) {
    return apiError(error, "Failed to run autonomous operating cycle");
  }
}
