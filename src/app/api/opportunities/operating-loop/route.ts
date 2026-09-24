import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getAutonomousOperatingLoop } from "@/lib/server/autonomous-operating-loop-service";

/** GET /api/opportunities/operating-loop — advisory, bounded, owner-scoped. */
export async function GET() {
  try {
    const user = await requireUser();
    const loop = await getAutonomousOperatingLoop(user.id);
    return NextResponse.json({
      cycleId: loop.cycleId,
      portfolioDecision: loop.portfolioDecision,
      selectedOpportunity: loop.selectedOpportunityId
        ? {
            opportunityId: loop.selectedOpportunityId,
            queue: loop.selectedQueue,
            reason: loop.actionReason,
            decision: loop.currentOpportunityDecision,
            priorityFactors: loop.currentOpportunityDecision
              ? loop.currentOpportunityDecision.decisionScore
              : 0,
          }
        : null,
      currentStage: loop.cycleStage,
      nextAction: loop.nextAction,
      blockers: loop.blockers,
      requiredApproval: loop.requiredApproval,
      executionEligible: loop.executionEligible,
      explanation: loop.explanation,
      dataClass: loop.dataClass,
      generatedAt: loop.generatedAt,
    });
  } catch (error) {
    return apiError(error, "Failed to load autonomous operating loop");
  }
}
