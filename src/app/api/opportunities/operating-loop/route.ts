import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getAutonomousOperationsCycle } from "@/lib/server/autonomous-operations-service";

/**
 * GET/POST /api/opportunities/operating-loop — authenticated, owner-scoped,
 * bounded, advisory. It intentionally performs no provider call, approval,
 * persistence, or execution.
 */
async function response() {
  const user = await requireUser();
  const operations = await getAutonomousOperationsCycle(user.id);
  const loop = {
    cycleId: operations.cycleId,
    portfolioDecision: operations.portfolio.portfolioDecision,
    selectedOpportunityId: operations.actionsConsidered[0]?.target.opportunityId ?? operations.controller.selectedOpportunityIds[0] ?? null,
    selectedQueue: operations.actionsConsidered[0]?.target.queue ?? null,
    currentOpportunityDecision: null,
    currentLifecycle: null,
    nextAction: operations.nextRecommendedAction,
    actionReason: operations.explanation[0] ?? "Bounded autonomous operations cycle.",
    blocked: operations.finalState === "BLOCKED",
    blockers: operations.blockers,
    requiredApproval: operations.finalState === "WAITING_FOR_APPROVAL",
    executionEligible: operations.actionsExecuted.some((action) => action.action.actionType === "EXECUTE"),
    dataClass: operations.portfolio.dataClass,
    cycleStage: operations.startState,
    explanation: operations.explanation,
    generatedAt: operations.completedAt,
  };
  const controller = operations.controller;
  const portfolio = operations.portfolio;
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
          priorityFactors: 0,
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
    operations: {
      cycleId: operations.cycleId,
      finalState: operations.finalState,
      stages: operations.stages,
      actionsConsidered: operations.actionsConsidered,
      actionsExecuted: operations.actionsExecuted,
      actionsSkipped: operations.actionsSkipped,
      blockers: operations.blockers,
      failures: operations.failures,
      recoveryActions: operations.recoveryActions,
      measurements: operations.measurements,
      learningSignals: operations.learningSignals,
      nextRecommendedAction: operations.nextRecommendedAction,
      health: operations.health,
      events: operations.events,
      resourceUsage: operations.resourceUsage,
      limits: operations.limits,
      circuitBreakers: operations.circuitBreakers,
      deduplication: operations.deduplication,
      explanation: operations.explanation,
    },
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
