import "server-only";
import { getPortfolioOperatingCycle } from "@/lib/server/autonomous-operating-loop-service";
import { getOperationalStatus, getSystemHealth } from "@/lib/server/system-health-service";
import { getProviderActivations } from "@/lib/integrations/activation-service";
import { listExecutionsForOwner } from "@/lib/server/execution-repository";
import { planAutonomousActions } from "@/lib/autonomous-action-planner";
import { runAutonomousOperationsCycle, type AutonomousFailureObservation, type AutonomousLearningSignal, type AutonomousOperationsCycle, type PreviousAutonomousAction } from "@/lib/autonomous-operations";
import { readCircuitBreakerSnapshot, writeCircuitBreakerSnapshot } from "@/lib/circuit-breaker";
import { calculatePortfolioHealth } from "@/lib/portfolio-health";

function previousActionsFromExecutions(executions: Awaited<ReturnType<typeof listExecutionsForOwner>>): PreviousAutonomousAction[] {
  return executions.slice(0, 100).map((execution) => ({
    idempotencyKey: execution.idempotencyKey,
    actionType: execution.action,
    state: execution.status === "SUCCEEDED" ? "SUCCEEDED" : execution.status === "FAILED" || execution.status === "TIMEOUT" || execution.status === "RATE_LIMITED" ? "BLOCKED" : "SKIPPED",
    targetId: execution.opportunityId,
  }));
}

function failureObservationsFromExecutions(executions: Awaited<ReturnType<typeof listExecutionsForOwner>>): AutonomousFailureObservation[] {
  return executions
    .filter((execution) => ["FAILED", "TIMEOUT", "RATE_LIMITED", "AUTH_FAILED", "UNAVAILABLE", "BLOCKED"].includes(execution.status))
    .slice(0, 20)
    .map((execution) => ({
      component: execution.integration || "execution",
      error: execution.error ?? execution.status,
      at: execution.updatedAt.toISOString(),
    }));
}

function learningSignalsFromPortfolio(_portfolio: Awaited<ReturnType<typeof getPortfolioOperatingCycle>>["portfolio"]): AutonomousLearningSignal[] {
  // A read-only planning cycle has not observed a before/after change. Even
  // when source-backed metrics exist, do not invent a positive or negative
  // signal; the existing learning service remains authoritative for changes.
  return ["INSUFFICIENT_DATA"];
}

/**
 * Build a safe, owner-scoped Phase 20 operations cycle. This service does not
 * call providers or execute tasks. A future caller may inject the existing
 * task/execution orchestrator; until then every action remains explicitly
 * planned, blocked, or skipped rather than reported as successful.
 */
export async function getAutonomousOperationsCycle(ownerId: string, now = new Date()): Promise<AutonomousOperationsCycle> {
  const [base, systemHealth, operationalStatus, providers, executions] = await Promise.all([
    getPortfolioOperatingCycle(ownerId, now),
    getSystemHealth(ownerId, now),
    getOperationalStatus(ownerId, now),
    getProviderActivations(),
    listExecutionsForOwner(ownerId, 100),
  ]);
  const plan = planAutonomousActions({
    ownerId,
    items: base.controller.items,
    providers,
    systemHealth: systemHealth.status,
    selectedOpportunityIds: base.controller.selectedOpportunityIds,
    now,
  });
  const health = calculatePortfolioHealth({ systemHealth, operationalStatus, providers, cycle: base.loop, now });
  const cycle = await runAutonomousOperationsCycle({
    ownerId,
    loop: base.loop,
    controller: base.controller,
    portfolio: base.portfolio,
    plan,
    systemHealth,
    health,
    providers,
    previousActions: previousActionsFromExecutions(executions),
    failures: failureObservationsFromExecutions(executions),
    learningSignals: learningSignalsFromPortfolio(base.portfolio),
    // MEDIUM-7: continue from the previous cycle's breaker state instead of
    // starting from a closed circuit every time, so a repeatedly failing
    // component is actually stopped rather than retried forever.
    circuitBreakers: readCircuitBreakerSnapshot(ownerId, now),
    now,
  });
  writeCircuitBreakerSnapshot(ownerId, cycle.circuitBreakers);
  return cycle;
}
