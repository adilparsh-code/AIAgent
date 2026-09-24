/**
 * Phase 20 — bounded autonomous operations engine.
 *
 * This is a composition layer. It consumes existing portfolio decisions,
 * health, provider activation, recovery, learning, and execution contracts;
 * it does not replace them, call providers directly, or persist a second
 * operating state machine.
 */
import { createAutonomousOperatingLoop, type AutonomousOperatingLoop } from "@/lib/autonomous-operating-loop";
import { planAutonomousActions, type AutonomousActionPlan, type AutonomousPlannedAction } from "@/lib/autonomous-action-planner";
import { evaluateAutonomyGate, type AutonomyGateResult } from "@/lib/autonomy-policy";
import { classifyFailure, determineRecoveryPolicy, type FailureCategory, type RecoveryAction } from "@/lib/failure-classification";
import { createCircuitBreakerSnapshot, isCircuitOpen, recordCircuitFailure, recordCircuitSuccess, type CircuitBreakerSnapshot } from "@/lib/circuit-breaker";
import { createOperationalEvent, type OperationalEvent } from "@/lib/operational-events";
import type { ProviderActivation } from "@/lib/integrations/provider-activation";
import type { PortfolioOperatingController } from "@/lib/portfolio-operating-controller";
import type { PortfolioHealth } from "@/lib/portfolio-health";
import type { OpportunityPortfolioIntelligence } from "@/lib/opportunity-portfolio";
import type { SystemHealth } from "@/lib/system-health";

export const AUTONOMOUS_OPERATIONS_LIMITS = {
  maxActionsPerCycle: 10,
  maxProviderCalls: 4,
  maxExperiments: 3,
  maxExecutions: 2,
  maxResearchRuns: 2,
  maxRetries: 3,
  maxConcurrentOperations: 2,
  maxOperationsPerOpportunity: 3,
  maxCycleDurationMs: 60_000,
} as const;

export const AUTONOMOUS_OPERATIONS_STAGES = [
  "OBSERVE",
  "ASSESS",
  "SELECT",
  "RESEARCH",
  "VALIDATE",
  "EXPERIMENT",
  "HANDOFF",
  "EXECUTE",
  "MEASURE",
  "LEARN",
  "RECOVER",
  "REASSESS",
  "COMPLETE",
] as const;
export type AutonomousOperationsStage = (typeof AUTONOMOUS_OPERATIONS_STAGES)[number];

export type AutonomousActionState = "EXECUTED" | "SKIPPED" | "BLOCKED" | "DUPLICATE" | "WAITING_FOR_APPROVAL";
export type AutonomousLearningSignal = "POSITIVE_SIGNAL" | "NEGATIVE_SIGNAL" | "MIXED_SIGNAL" | "INSUFFICIENT_DATA" | "NO_CHANGE" | "CONTRADICTORY_SIGNAL";

export interface PreviousAutonomousAction {
  idempotencyKey: string;
  actionType: string;
  state: "EXECUTED" | "COMPLETED" | "SUCCEEDED" | "SKIPPED" | "BLOCKED" | "DUPLICATE";
  targetId?: string | null;
}

export interface AutonomousFailureObservation {
  component: string;
  error: string;
  at?: string;
}

export interface AutonomousMeasurementObservation {
  label: string;
  dataClass: "REAL_DATA" | "ESTIMATED_DATA" | "SAMPLE_DATA" | "NOT_MEASURED" | "UNKNOWN";
  source: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface AutonomousActionExecutionResult {
  status: "SUCCEEDED" | "FAILED" | "TIMEOUT" | "RATE_LIMITED" | "AUTH_FAILED" | "UNAVAILABLE" | "BLOCKED";
  observation: string;
  dataClass: "REAL_DATA" | "AI_GENERATED" | "AI_ESTIMATE" | "SAMPLE_DATA" | "ESTIMATED_DATA" | "NOT_MEASURED" | "UNKNOWN";
  error?: string | null;
}

export type AutonomousActionExecutor = (action: AutonomousPlannedAction) => Promise<AutonomousActionExecutionResult>;

export interface AutonomousActionResult {
  action: AutonomousPlannedAction;
  state: AutonomousActionState;
  gate: AutonomyGateResult;
  observation: string;
  failureCategory?: FailureCategory;
  recoveryAction?: RecoveryAction;
  circuitBreakerOpened: boolean;
}

export interface AutonomousOperationsCycle {
  cycleId: string;
  ownerId: string;
  startedAt: string;
  completedAt: string;
  stages: AutonomousOperationsStage[];
  startState: string;
  finalState: "COMPLETE" | "CONTINUE" | "BLOCKED" | "RECOVERING" | "WAITING_FOR_APPROVAL";
  actionsConsidered: AutonomousPlannedAction[];
  actionsExecuted: AutonomousActionResult[];
  actionsSkipped: AutonomousActionResult[];
  blockers: string[];
  failures: Array<{ component: string; category: FailureCategory; safeMessage: string }>;
  recoveryActions: RecoveryAction[];
  measurements: AutonomousMeasurementObservation[];
  learningSignals: AutonomousLearningSignal[];
  nextRecommendedAction: string;
  health: PortfolioHealth | null;
  controller: PortfolioOperatingController;
  portfolio: OpportunityPortfolioIntelligence;
  events: OperationalEvent[];
  resourceUsage: {
    actions: number;
    providerCalls: number;
    retries: number;
    concurrentOperations: number;
  };
  limits: typeof AUTONOMOUS_OPERATIONS_LIMITS;
  circuitBreakers: CircuitBreakerSnapshot;
  deduplication: { checked: number; duplicates: number };
  explanation: string[];
}

export interface AutonomousOperationsInput {
  ownerId: string;
  loop: AutonomousOperatingLoop;
  controller: PortfolioOperatingController;
  portfolio: OpportunityPortfolioIntelligence;
  plan: AutonomousActionPlan;
  systemHealth: SystemHealth;
  health: PortfolioHealth | null;
  providers: readonly ProviderActivation[];
  previousActions?: readonly PreviousAutonomousAction[];
  failures?: readonly AutonomousFailureObservation[];
  measurements?: readonly AutonomousMeasurementObservation[];
  learningSignals?: readonly AutonomousLearningSignal[];
  authorized?: boolean;
  approvalGranted?: boolean;
  executeAction?: AutonomousActionExecutor;
  circuitBreakers?: CircuitBreakerSnapshot;
  now?: Date;
}

function actionStage(action: AutonomousPlannedAction): AutonomousOperationsStage {
  switch (action.actionType) {
    case "RESEARCH_MORE": return "RESEARCH";
    case "VALIDATE": return "VALIDATE";
    case "RUN_EXPERIMENT": return "EXPERIMENT";
    case "MEASURE": return "MEASURE";
    case "LEARN": return "LEARN";
    case "HANDOFF": return "HANDOFF";
    case "EXECUTE": return "EXECUTE";
    case "RETRY":
    case "BACKOFF": return "RECOVER";
    case "REASSESS": return "REASSESS";
    default: return "ASSESS";
  }
}

function event(input: { event: string; message: string; severity?: OperationalEvent["severity"]; opportunityId?: string; dataClass?: OperationalEvent["dataClass"]; now: Date }): OperationalEvent {
  return createOperationalEvent({
    category: "SYSTEM",
    severity: input.severity ?? "INFO",
    event: input.event,
    safeMessage: input.message,
    opportunityId: input.opportunityId,
    dataClass: input.dataClass ?? "UNKNOWN",
    timestamp: input.now,
  });
}

function safeFailure(component: string, error: string, at: string): { component: string; category: FailureCategory; safeMessage: string } {
  const classification = classifyFailure(error);
  return { component, category: classification.category, safeMessage: classification.safeUserMessage };
}

/**
 * Run one bounded, explainable operations cycle. Real execution is only
 * delegated to the injected existing-boundary executor; when none is supplied,
 * actions remain planned/skipped rather than being reported as successful.
 */
export async function runAutonomousOperationsCycle(input: AutonomousOperationsInput): Promise<AutonomousOperationsCycle> {
  const now = input.now ?? new Date();
  const completedAt = new Date(now.getTime());
  const previous = input.previousActions ?? [];
  const previousKeys = new Set(previous.filter((item) => ["EXECUTED", "COMPLETED", "SUCCEEDED"].includes(item.state)).map((item) => item.idempotencyKey));
  const providerByName = new Map(input.providers.map((provider) => [provider.provider, provider]));
  let circuitBreakers = input.circuitBreakers ?? createCircuitBreakerSnapshot(now);
  const events: OperationalEvent[] = [
    event({ event: "AUTONOMOUS_CYCLE_STARTED", message: `Autonomous operations cycle started for owner-scoped portfolio ${input.loop.cycleId}.`, opportunityId: input.loop.selectedOpportunityId ?? undefined, now }),
    event({ event: "ACTION_PLANNED", message: `Planned ${input.plan.actions.length} bounded portfolio action(s).`, now }),
  ];
  const failures = (input.failures ?? []).slice(0, AUTONOMOUS_OPERATIONS_LIMITS.maxRetries * 4).map((failure) => safeFailure(failure.component, failure.error, failure.at ?? now.toISOString()));
  const recoveryActions = new Set<RecoveryAction>();
  for (const failure of failures) {
    recoveryActions.add(determineRecoveryPolicy({
      ...classifyFailure(failure.safeMessage),
      requiresApproval: false,
      capabilityAvailable: failure.category !== "AUTHENTICATION" && failure.category !== "CREDIT_LIMITED",
      idempotencyKnown: true,
    }));
  }

  const considered = input.plan.actions.slice(0, AUTONOMOUS_OPERATIONS_LIMITS.maxActionsPerCycle);
  const skippedByLimit = input.plan.actions.slice(AUTONOMOUS_OPERATIONS_LIMITS.maxActionsPerCycle);
  const executed: AutonomousActionResult[] = [];
  const skipped: AutonomousActionResult[] = [];
  const blockers: string[] = [];
  let providerCalls = 0;
  let retries = 0;
  let duplicateCount = 0;
  const perOpportunity = new Map<string, number>();

  for (const action of skippedByLimit) {
    const gate = evaluateAutonomyGate({
      actionType: action.actionType,
      capability: action.requiredCapability,
      providerStatus: action.provider ? (providerByName.get(action.provider)?.status === "HEALTHY" ? "HEALTHY" : "UNAVAILABLE") : null,
      providerName: action.provider,
      authenticated: true,
      ownerVerified: true,
      authorized: input.authorized !== false,
      approvalRequired: action.approvalRequirement === "REQUIRED",
      approvalGranted: action.approvalRequirement !== "REQUIRED",
      dataClass: action.dataClass,
      requiresRealData: action.requiresRealData,
      idempotencyKey: action.idempotencyKey,
      concurrencyAvailable: true,
      stopConditions: [],
      systemHealth: input.systemHealth.status,
    });
    skipped.push({ action, state: "SKIPPED", gate, observation: "Action omitted because the per-cycle action budget is exhausted.", circuitBreakerOpened: false });
  }

  for (const action of considered) {
    const count = perOpportunity.get(action.target.opportunityId) ?? 0;
    if (count >= AUTONOMOUS_OPERATIONS_LIMITS.maxOperationsPerOpportunity) {
      const gate = evaluateAutonomyGate({
        actionType: action.actionType, capability: action.requiredCapability, providerStatus: null, authenticated: true, ownerVerified: true, authorized: input.authorized !== false,
        approvalRequired: action.approvalRequirement === "REQUIRED", approvalGranted: action.approvalRequirement !== "REQUIRED", dataClass: action.dataClass,
        requiresRealData: action.requiresRealData, idempotencyKey: action.idempotencyKey, concurrencyAvailable: true, stopConditions: [], systemHealth: input.systemHealth.status,
      });
      skipped.push({ action, state: "SKIPPED", gate, observation: "Action deferred by the per-opportunity operation budget.", circuitBreakerOpened: false });
      continue;
    }
    const provider = action.provider ? providerByName.get(action.provider) : null;
    const circuitOpen = isCircuitOpen(circuitBreakers, provider?.provider ?? "internal", now);
    const gate = evaluateAutonomyGate({
      actionType: action.actionType,
      capability: action.requiredCapability,
      providerStatus: provider ? (provider.status === "HEALTHY" ? "HEALTHY" : "UNAVAILABLE") : null,
      providerName: provider?.provider ?? action.provider,
      authenticated: true,
      ownerVerified: true,
      authorized: input.authorized !== false,
      approvalRequired: action.approvalRequirement === "REQUIRED",
      approvalGranted: action.approvalRequirement === "REQUIRED" ? input.approvalGranted === true : true,
      dataClass: action.dataClass,
      requiresRealData: action.requiresRealData,
      idempotencyKey: action.idempotencyKey,
      existingEquivalentAction: previousKeys.has(action.idempotencyKey),
      concurrencyAvailable: executed.filter((item) => item.state === "EXECUTED").length < AUTONOMOUS_OPERATIONS_LIMITS.maxConcurrentOperations,
      stopConditions: circuitOpen ? [`Circuit breaker is open for ${provider?.provider ?? "internal"}.`] : [],
      systemHealth: input.systemHealth.status,
    });
    if (previousKeys.has(action.idempotencyKey)) {
      duplicateCount += 1;
      const result: AutonomousActionResult = { action, state: "DUPLICATE", gate, observation: "Equivalent action already completed; no repeat was attempted.", circuitBreakerOpened: false };
      executed.push(result);
      events.push(event({ event: "ACTION_SKIPPED", message: result.observation, opportunityId: action.target.opportunityId, now }));
      continue;
    }
    if (!gate.canExecute) {
      const state: AutonomousActionState = gate.state === "WAITING_FOR_APPROVAL" ? "WAITING_FOR_APPROVAL" : "BLOCKED";
      const result: AutonomousActionResult = { action, state, gate, observation: gate.reason, circuitBreakerOpened: false };
      skipped.push(result);
      blockers.push(...gate.blockers);
      events.push(event({ event: gate.state === "WAITING_FOR_APPROVAL" ? "ACTION_BLOCKED" : "ACTION_BLOCKED", message: result.observation, severity: "WARNING", opportunityId: action.target.opportunityId, now }));
      continue;
    }
    if (!input.executeAction) {
      const result: AutonomousActionResult = { action, state: "SKIPPED", gate, observation: "Action passed planning gates but no existing-boundary executor was supplied; no external action was attempted.", circuitBreakerOpened: false };
      skipped.push(result);
      events.push(event({ event: "ACTION_SKIPPED", message: result.observation, opportunityId: action.target.opportunityId, now }));
      continue;
    }
    if (action.requiredCapability && providerCalls >= AUTONOMOUS_OPERATIONS_LIMITS.maxProviderCalls) {
      const result: AutonomousActionResult = { action, state: "SKIPPED", gate, observation: "Provider call budget exhausted for this cycle.", circuitBreakerOpened: false };
      skipped.push(result);
      continue;
    }
    events.push(event({ event: "ACTION_STARTED", message: `Started planned ${action.actionType} action.`, opportunityId: action.target.opportunityId, now }));
    const execution = await input.executeAction(action);
    if (action.requiredCapability) providerCalls += 1;
    perOpportunity.set(action.target.opportunityId, count + 1);
    if (execution.status === "SUCCEEDED") {
      const component = provider?.provider ?? "internal";
      circuitBreakers = recordCircuitSuccess(circuitBreakers, component, now);
      const result: AutonomousActionResult = { action, state: "EXECUTED", gate, observation: execution.observation, circuitBreakerOpened: false };
      executed.push(result);
      events.push(event({ event: "ACTION_COMPLETED", message: execution.observation, opportunityId: action.target.opportunityId, dataClass: execution.dataClass === "AI_GENERATED" || execution.dataClass === "NOT_MEASURED" ? "UNKNOWN" : execution.dataClass, now }));
    } else {
      const failure = safeFailure(provider?.provider ?? action.actionType, execution.error ?? execution.status, now.toISOString());
      const recovery = determineRecoveryPolicy({ ...classifyFailure(execution.error ?? execution.status), requiresApproval: action.approvalRequirement === "REQUIRED", capabilityAvailable: action.requiredCapability !== "PUBLISH" && action.requiredCapability !== "SPEND_MONEY", idempotencyKnown: true });
      recoveryActions.add(recovery);
      if (execution.status === "TIMEOUT" || execution.status === "RATE_LIMITED" || execution.status === "FAILED" || execution.status === "UNAVAILABLE") retries += 1;
      const before = circuitBreakers.records[provider?.provider ?? "internal"]?.state;
      circuitBreakers = recordCircuitFailure(circuitBreakers, provider?.provider ?? "internal", failure.category, now);
      const opened = before !== "OPEN" && circuitBreakers.records[provider?.provider ?? "internal"]?.state === "OPEN";
      const result: AutonomousActionResult = { action, state: "BLOCKED", gate, observation: failure.safeMessage, failureCategory: failure.category, recoveryAction: recovery, circuitBreakerOpened: opened };
      skipped.push(result);
      failures.push(failure);
      blockers.push(`${failure.component}: ${failure.safeMessage}`);
      events.push(event({ event: opened ? "CIRCUIT_BREAKER_OPENED" : "RECOVERY_STARTED", message: result.observation, severity: "WARNING", opportunityId: action.target.opportunityId, now }));
      if (!opened && !["TIMEOUT", "RATE_LIMITED", "TRANSIENT", "PROVIDER_UNAVAILABLE"].includes(failure.category)) {
        events.push(event({ event: "RECOVERY_FAILED", message: `Recovery was not eligible for ${failure.category}; human review is required.`, severity: "WARNING", opportunityId: action.target.opportunityId, now }));
      }
    }
  }

  const hasWaiting = skipped.some((item) => item.state === "WAITING_FOR_APPROVAL");
  const hasBlocked = skipped.some((item) => item.state === "BLOCKED") || blockers.length > 0;
  const finalState: AutonomousOperationsCycle["finalState"] = hasWaiting ? "WAITING_FOR_APPROVAL" : hasBlocked ? "BLOCKED" : failures.length > 0 ? "RECOVERING" : skipped.length > 0 ? "CONTINUE" : "COMPLETE";
  const learningSignals = [...new Set(input.learningSignals ?? [])];
  if (learningSignals.length === 0) learningSignals.push("INSUFFICIENT_DATA");
  const nextRecommendedAction = hasWaiting
    ? "Obtain or revoke explicit approval before the next controlled cycle."
    : hasBlocked
      ? input.loop.nextAction
      : skipped.length > 0
        ? "Refresh the owner-scoped state and replan within the bounded budget."
        : "Continue observing the portfolio after the completed read-model cycle.";
  const cycle: AutonomousOperationsCycle = {
    cycleId: `operations-${input.loop.cycleId}`,
    ownerId: input.ownerId,
    startedAt: now.toISOString(),
    completedAt: completedAt.toISOString(),
    stages: ["OBSERVE", "ASSESS", "SELECT", ...[...new Set(considered.map(actionStage))], "REASSESS", finalState === "COMPLETE" ? "COMPLETE" : "REASSESS"],
    startState: input.loop.cycleStage,
    finalState,
    actionsConsidered: considered,
    actionsExecuted: executed,
    actionsSkipped: skipped,
    blockers: [...new Set(blockers)],
    failures,
    recoveryActions: [...recoveryActions].sort(),
    measurements: [...(input.measurements ?? [])].slice(0, AUTONOMOUS_OPERATIONS_LIMITS.maxActionsPerCycle * 5),
    learningSignals,
    nextRecommendedAction,
    health: input.health,
    controller: input.controller,
    portfolio: input.portfolio,
    events: [...events, event({ event: "AUTONOMOUS_CYCLE_COMPLETED", message: `Autonomous operations cycle finished with state ${finalState}.`, severity: finalState === "BLOCKED" ? "WARNING" : "INFO", now })],
    resourceUsage: { actions: executed.length + skipped.length, providerCalls, retries, concurrentOperations: executed.filter((item) => item.state === "EXECUTED").length },
    limits: AUTONOMOUS_OPERATIONS_LIMITS,
    circuitBreakers,
    deduplication: { checked: previous.length, duplicates: duplicateCount },
    explanation: [
      "The cycle composes existing portfolio intelligence, decision, health, provider, recovery, and learning contracts.",
      "Only an injected existing-boundary executor can perform a real action; absence of an executor is reported as skipped, never success.",
      "Provider calls, retries, concurrency, actions, and per-opportunity work are bounded.",
      "A successful cycle does not imply business success, profitability, or future income.",
    ],
  };
  return cycle;
}
