import "server-only";
import { createAutonomousOperatingLoop, type OperatingLoopExecutionGates, type AutonomousOperatingLoop } from "@/lib/autonomous-operating-loop";
import { calculatePortfolioIntelligence, type OpportunityPortfolioIntelligence } from "@/lib/opportunity-portfolio";
import { loadOpportunityDecisions } from "@/lib/server/opportunity-decision-loader";
import { createPortfolioOperatingController, type PortfolioOperatingController } from "@/lib/portfolio-operating-controller";
import { assessExecutionReadiness, type ExecutionReadinessResult } from "@/lib/execution-readiness";
import { buildExecutionPlan, type ExecutionPlan } from "@/lib/execution-plan";
import { getProviderActivations } from "@/lib/integrations/activation-service";
import { buildIdempotencyKey, type IntegrationCapability, type IntegrationStatus } from "@/lib/integrations/contract";

export { DECISION_LOAD_BOUNDS } from "@/lib/server/opportunity-decision-loader";

type DecisionEntry = Awaited<ReturnType<typeof loadOpportunityDecisions>>["entries"][number];

function buildPortfolio(ownerId: string, entries: DecisionEntry[], truncated: boolean, now?: Date) {
  return calculatePortfolioIntelligence({
    opportunities: entries.map((entry) => entry.portfolioInput),
    truncated,
    now,
  });
}

function buildGates(entries: DecisionEntry[]): Map<string, OperatingLoopExecutionGates> {
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
  return gates;
}

export interface PortfolioOperatingCycle {
  loop: AutonomousOperatingLoop;
  controller: PortfolioOperatingController;
  portfolio: OpportunityPortfolioIntelligence;
}

/** Compose existing owner-scoped read-models into one bounded advisory cycle. */
export async function getPortfolioOperatingCycle(ownerId: string, now?: Date): Promise<PortfolioOperatingCycle> {
  const { entries, truncated } = await loadOpportunityDecisions(ownerId, { now });
  const portfolio = buildPortfolio(ownerId, entries, truncated, now);
  const decisions = new Map(entries.map((entry) => [entry.opportunityId, entry.decision]));
  const loop = createAutonomousOperatingLoop({ portfolio, decisions, gates: buildGates(entries), now });
  const controller = createPortfolioOperatingController({ portfolio, rows: entries.map((entry) => entry.portfolioInput), decisions });
  return { loop, controller, portfolio };
}

/** Backwards-compatible single-loop accessor. */
export async function getAutonomousOperatingLoop(ownerId: string, now?: Date): Promise<AutonomousOperatingLoop> {
  return (await getPortfolioOperatingCycle(ownerId, now)).loop;
}

function providerSnapshot(providerName?: string) {
  return getProviderActivations().then((states) => {
    const state = providerName ? states.find((item) => item.provider === providerName) : undefined;
    return state ? { name: state.provider, status: state.status as IntegrationStatus, healthCheckedAt: state.lastHealthCheckAt, configured: state.configured } : null;
  });
}

/** Owner-scoped readiness facts. No provider is called by this function. */
export async function getOpportunityExecutionReadiness(
  opportunityId: string,
  ownerId: string,
  now?: Date,
): Promise<ExecutionReadinessResult | null> {
  const { entries } = await loadOpportunityDecisions(ownerId, { opportunityIds: [opportunityId], now });
  const entry = entries.find((item) => item.opportunityId === opportunityId);
  if (!entry) return null;
  const provider = await providerSnapshot();
  const result = assessExecutionReadiness({
    authenticated: true,
    ownerId,
    opportunityId,
    opportunityOwned: true,
    decision: entry.decision,
    handoffStatus: entry.portfolioInput.handoffStatus,
    validationCompleted: entry.decision.validationGaps.length === 0,
    experimentState: entry.portfolioInput.experimentCount > 0 ? "RECORDED" : null,
    learningSignalAvailable: entry.portfolioInput.hasLearningSignal,
    provider,
    capability: null,
    capabilityAuthorized: false,
    approvalRequired: false,
    approvalGranted: false,
    measurementAvailable: false,
    measurementDataClass: "NOT_MEASURED",
    stopConditions: [],
    stopped: false,
    idempotencyKey: buildIdempotencyKey({ ownerId, taskId: `readiness:${opportunityId}`, adapterName: "unknown", action: "readiness" }),
    existingExecution: false,
    dataClass: entry.decision.dataClass,
    now,
  });
  return result;
}

/** Return a side-effect-free plan only when explicit execution facts are supplied by a future caller. */
export async function getOpportunityExecutionPlan(
  opportunityId: string,
  ownerId: string,
  now?: Date,
): Promise<{ readiness: ExecutionReadinessResult; plan: ExecutionPlan | null } | null> {
  const readiness = await getOpportunityExecutionReadiness(opportunityId, ownerId, now);
  if (!readiness) return null;
  return { readiness, plan: null };
}

export function buildOwnerExecutionPlan(input: {
  ownerId: string;
  opportunityId: string;
  objective: string;
  steps: string[];
  provider: string;
  capability: IntegrationCapability;
  metrics: string[];
  sourceRequirement: string;
  availability: "AVAILABLE" | "NOT_MEASURED";
  dataClass: "REAL_DATA" | "NOT_MEASURED" | "SAMPLE_DATA" | "ESTIMATED_DATA" | "AI_GENERATED" | "AI_ESTIMATE" | "UNKNOWN";
  now?: Date;
}) {
  return buildExecutionPlan({
    ownerId: input.ownerId,
    opportunityId: input.opportunityId,
    objective: input.objective,
    steps: input.steps,
    provider: input.provider,
    capability: input.capability,
    measurementPlan: { metrics: input.metrics, sourceRequirement: input.sourceRequirement, availability: input.availability, dataClass: input.dataClass },
    successMetric: input.metrics[0] ?? "NOT_MEASURED",
    stopConditions: [],
    rollbackCondition: "Stop and request human review if a safety, authorization, or data-integrity condition appears.",
    dataClass: input.dataClass,
    now: input.now,
  });
}
