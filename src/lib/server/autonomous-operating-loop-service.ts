import "server-only";
import { createAutonomousOperatingLoop, type OperatingLoopExecutionGates, type AutonomousOperatingLoop } from "@/lib/autonomous-operating-loop";
import { calculatePortfolioIntelligence } from "@/lib/opportunity-portfolio";
import { loadOpportunityDecisions } from "@/lib/server/opportunity-decision-loader";

export { DECISION_LOAD_BOUNDS } from "@/lib/server/opportunity-decision-loader";

/**
 * Compose the existing owner-scoped portfolio and decision read-models into
 * one advisory operating cycle. This service performs no writes, provider
 * calls, approvals, or execution.
 */
export async function getAutonomousOperatingLoop(
  ownerId: string,
  now?: Date,
): Promise<AutonomousOperatingLoop> {
  const { entries, truncated } = await loadOpportunityDecisions(ownerId, { now });
  const portfolio = calculatePortfolioIntelligence({
    opportunities: entries.map((entry) => entry.portfolioInput),
    truncated,
    now,
  });
  const decisions = new Map(entries.map((entry) => [entry.opportunityId, entry.decision]));
  const gates = new Map<string, OperatingLoopExecutionGates>();
  for (const entry of entries) {
    const { decision, portfolioInput } = entry;
    gates.set(entry.opportunityId, {
      authenticatedOwner: true,
      opportunityOwned: true,
      decisionState: decision.decision,
      readinessState: decision.readinessState,
      handoffAccepted: portfolioInput.handoffStatus === "ACCEPTED" || portfolioInput.handoffStatus === "COMPLETED",
      taskApprovalSatisfied: !portfolioInput.requiresHumanApproval && !portfolioInput.taskApprovalPending,
      executionPermissions: !portfolioInput.hasExecutionBlocker,
      requiredCapabilityAvailable: decision.decision !== "EXECUTION_READY" || portfolioInput.handoffStatus === "ACCEPTED" || portfolioInput.handoffStatus === "COMPLETED",
      realDataRequired: decision.decision === "EXECUTION_READY",
      dataClass: decision.dataClass,
    });
  }
  return createAutonomousOperatingLoop({ portfolio, decisions, gates, now });
}
