import { describe, expect, it } from "vitest";
import { evaluateAutonomyGate } from "@/lib/autonomy-policy";
import { createCircuitBreakerSnapshot, recordCircuitFailure } from "@/lib/circuit-breaker";
import { runAutonomousOperationsCycle, type AutonomousOperationsInput } from "@/lib/autonomous-operations";
import type { AutonomousActionPlan, AutonomousPlannedAction } from "@/lib/autonomous-action-planner";
import type { PortfolioOperatingController, PortfolioOperatingItem } from "@/lib/portfolio-operating-controller";
import type { ProviderActivation } from "@/lib/integrations/provider-activation";
import type { SystemHealth } from "@/lib/system-health";
import type { OpportunityPortfolioIntelligence } from "@/lib/opportunity-portfolio";
import type { AutonomousOperatingLoop } from "@/lib/autonomous-operating-loop";

const NOW = new Date("2026-09-24T18:00:00.000Z");
const item: PortfolioOperatingItem = {
  opportunityId: "opp-1", queue: "RESEARCH_QUEUE", stage: "RESEARCH", selected: true, requiredApproval: false, blocked: false,
  reasons: ["Research is required."], priorityScore: 50, recommendationReason: "Research gap exists.", dataClass: "AI_ESTIMATE",
};
const action: AutonomousPlannedAction = {
  actionType: "RESEARCH_MORE", target: { opportunityId: "opp-1", queue: item.queue, stage: item.stage }, reason: "Research gap exists.",
  prerequisites: ["Research gap exists."], riskSafetyStatus: "SAFE", requiredCapability: "SEARCH", approvalRequirement: "NOT_REQUIRED",
  expectedObservation: "A provider result or an explicit blocker.", idempotencyKey: "owner:task:provider:RESEARCH_MORE:entity", dataClass: "UNKNOWN", provider: "brave-search", requiresRealData: false,
};
const plan: AutonomousActionPlan = { generatedAt: NOW.toISOString(), actions: [action], consideredOpportunityIds: [item.opportunityId], deferredOpportunityIds: [], limits: { maxActions: 10, maxProviderCalls: 4, maxRetries: 3 }, dataClass: "UNKNOWN" };
const loop = { cycleId: "cycle-1", generatedAt: NOW.toISOString(), portfolioDecision: "FILL_RESEARCH_GAPS", selectedOpportunityId: "opp-1", selectedQueue: "RESEARCH_QUEUE", currentOpportunityDecision: null, currentLifecycle: "RESEARCHING", nextAction: "Research more.", actionReason: "Research gap exists.", blocked: false, blockers: [], requiredApproval: false, executionEligible: false, dataClass: "AI_ESTIMATE", cycleStage: "RESEARCH", explanation: ["Existing portfolio decision."] } as AutonomousOperatingLoop;
const controller = { cycleId: "portfolio-cycle-1", portfolioDecision: "FILL_RESEARCH_GAPS", queues: { RESEARCH_QUEUE: ["opp-1"], VALIDATION_QUEUE: [], EXPERIMENT_QUEUE: [], LEARNING_QUEUE: [], HANDOFF_QUEUE: [], EXECUTION_QUEUE: [], HUMAN_REVIEW_QUEUE: [], BLOCKED_QUEUE: [], MONITOR_QUEUE: [] }, items: [item], selectedOpportunityIds: ["opp-1"], deferredOpportunityIds: [], limits: { maxOpportunitiesPerCycle: 5, maxResearchRuns: 2, maxConcurrentExperiments: 3, maxConcurrentExecutions: 2, maxMetricsPerCycle: 50, maxRetries: 3 }, observed: { activeResearchRuns: 0, activeExperiments: 0, activeExecutions: 0, metricsAvailable: 0 }, blocked: false, reasons: [], generatedAt: NOW.toISOString() } as PortfolioOperatingController;
const portfolio = { totalOpportunities: 1, generatedAt: NOW.toISOString() } as OpportunityPortfolioIntelligence;
const systemHealth = { status: "HEALTHY", checks: [], criticalFailures: [], warnings: [], degradedComponents: [], healthyComponents: [], providerStates: [], generatedAt: NOW.toISOString() } as SystemHealth;
const providers: ProviderActivation[] = [{ provider: "brave-search", status: "HEALTHY", capabilities: ["SEARCH"], configured: true, healthCheckRequired: false, liveTestRequired: true, approvalRequired: false, safeReason: "A real provider health check succeeded.", lastHealthCheckAt: NOW.toISOString(), requiredVariables: [], optionalVariables: [] }];

function input(overrides: Partial<AutonomousOperationsInput> = {}): AutonomousOperationsInput {
  return { ownerId: "owner-1", loop, controller, portfolio, plan, systemHealth, health: null, providers, now: NOW, ...overrides };
}

describe("Phase 20 autonomous operations", () => {
  it("blocks provider actions when configuration has not become health", () => {
    const result = evaluateAutonomyGate({ actionType: "RESEARCH_MORE", capability: "SEARCH", providerStatus: "READY_FOR_HEALTH_CHECK", providerName: "brave-search", authenticated: true, ownerVerified: true, authorized: true, approvalRequired: false, approvalGranted: true, dataClass: "UNKNOWN", idempotencyKey: "key", concurrencyAvailable: true, stopConditions: [], systemHealth: "HEALTHY" });
    expect(result.state).toBe("BLOCKED");
    expect(result.canExecute).toBe(false);
    expect(result.reason).toContain("configuration is not health");
  });

  it("requires approval for dangerous capabilities and never bypasses it", () => {
    const result = evaluateAutonomyGate({ actionType: "EXECUTE", capability: "SPEND_MONEY", providerStatus: "HEALTHY", authenticated: true, ownerVerified: true, authorized: true, approvalRequired: true, approvalGranted: false, dataClass: "REAL_DATA", idempotencyKey: "key", concurrencyAvailable: true, stopConditions: [], systemHealth: "HEALTHY" });
    expect(result.state).toBe("WAITING_FOR_APPROVAL");
    expect(result.canExecute).toBe(false);
    expect(result.approvalRequired).toBe(true);
  });

  it("does not report a missing executor as successful", async () => {
    const result = await runAutonomousOperationsCycle(input());
    expect(result.actionsExecuted).toHaveLength(0);
    expect(result.actionsSkipped[0]?.state).toBe("SKIPPED");
    expect(result.finalState).toBe("CONTINUE");
    expect(result.events.some((event) => event.event === "AUTONOMOUS_CYCLE_COMPLETED")).toBe(true);
  });

  it("delegates only to the injected existing-boundary executor", async () => {
    const result = await runAutonomousOperationsCycle(input({ executeAction: async () => ({ status: "SUCCEEDED", observation: "Provider returned an actual observation.", dataClass: "REAL_DATA" }) }));
    expect(result.actionsExecuted[0]?.state).toBe("EXECUTED");
    expect(result.resourceUsage.providerCalls).toBe(1);
    expect(result.finalState).toBe("COMPLETE");
  });

  it("suppresses an equivalent completed action by idempotency key", async () => {
    const result = await runAutonomousOperationsCycle(input({ previousActions: [{ idempotencyKey: action.idempotencyKey, actionType: action.actionType, state: "SUCCEEDED" }] }));
    expect(result.actionsExecuted[0]?.state).toBe("DUPLICATE");
    expect(result.deduplication.duplicates).toBe(1);
  });

  it("classifies a timeout and recommends bounded recovery", async () => {
    const result = await runAutonomousOperationsCycle(input({ executeAction: async () => ({ status: "TIMEOUT", observation: "The provider timed out.", dataClass: "UNKNOWN", error: "timeout" }) }));
    expect(result.failures[0]?.category).toBe("TIMEOUT");
    expect(result.recoveryActions).toContain("BACKOFF");
    expect(result.resourceUsage.retries).toBe(1);
  });

  it("opens a circuit after repeated component failures", () => {
    let snapshot = createCircuitBreakerSnapshot(NOW);
    snapshot = recordCircuitFailure(snapshot, "brave-search", "TIMEOUT", NOW);
    snapshot = recordCircuitFailure(snapshot, "brave-search", "TIMEOUT", NOW);
    const opened = recordCircuitFailure(snapshot, "brave-search", "TIMEOUT", NOW);
    expect(opened.records["brave-search"]?.state).toBe("OPEN");
    expect(opened.openComponents).toEqual(["brave-search"]);
  });

  it("blocks immediately when approval is revoked", () => {
    const result = evaluateAutonomyGate({ actionType: "EXECUTE", capability: "SPEND_MONEY", providerStatus: "HEALTHY", authenticated: true, ownerVerified: true, authorized: true, approvalRequired: true, approvalGranted: false, approvalRevoked: true, dataClass: "REAL_DATA", idempotencyKey: "key", concurrencyAvailable: true, stopConditions: [], systemHealth: "HEALTHY" });
    expect(result.state).toBe("BLOCKED");
    expect(result.reason).toContain("revoked");
  });

  it("keeps operational events free of credential-shaped input", async () => {
    const result = await runAutonomousOperationsCycle(input({ executeAction: async () => ({ status: "FAILED", observation: "failed", dataClass: "UNKNOWN", error: "api_key=super-secret-value" }) }));
    expect(result.events.every((event) => !event.safeMessage.includes("super-secret-value"))).toBe(true);
  });

  it("keeps NOT_MEASURED observations out of REAL_DATA learning", async () => {
    const result = await runAutonomousOperationsCycle(input({ measurements: [{ label: "conversion", dataClass: "NOT_MEASURED", source: null, periodStart: null, periodEnd: null }] }));
    expect(result.measurements[0]?.dataClass).toBe("NOT_MEASURED");
    expect(result.learningSignals).toEqual(["INSUFFICIENT_DATA"]);
  });

  it("enforces the bounded concurrent operation count", async () => {
    const actions = [action, { ...action, target: { ...action.target, opportunityId: "opp-2" }, idempotencyKey: "key-2" }, { ...action, target: { ...action.target, opportunityId: "opp-3" }, idempotencyKey: "key-3" }];
    const result = await runAutonomousOperationsCycle(input({ plan: { ...plan, actions }, executeAction: async () => ({ status: "SUCCEEDED", observation: "bounded observation", dataClass: "REAL_DATA" }) }));
    expect(result.actionsExecuted).toHaveLength(2);
    expect(result.actionsSkipped.filter((item) => item.state === "BLOCKED")).toHaveLength(1);
  });

  it("keeps sample and estimated data out of real-data execution", () => {
    const result = evaluateAutonomyGate({ actionType: "EXECUTE", capability: "READ_DATA", providerStatus: "HEALTHY", authenticated: true, ownerVerified: true, authorized: true, approvalRequired: false, approvalGranted: true, dataClass: "SAMPLE_DATA", requiresRealData: true, idempotencyKey: "key", concurrencyAvailable: true, stopConditions: [], systemHealth: "HEALTHY" });
    expect(result.canExecute).toBe(false);
    expect(result.reason).toContain("REAL_DATA");
  });
});
