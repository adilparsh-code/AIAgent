/** Phase 20 — deterministic autonomous action planner. */
import { buildIdempotencyKey, capabilityRequiresApproval, type IntegrationCapability } from "@/lib/integrations/contract";
import type { ProviderActivation } from "@/lib/integrations/provider-activation";
import type { PortfolioOperatingItem } from "@/lib/portfolio-operating-controller";
import type { SystemHealthStatus } from "@/lib/system-health";
import type { AutonomyDataClass } from "@/lib/autonomy-policy";

export const AUTONOMOUS_ACTION_TYPES = [
  "RESEARCH_MORE",
  "VALIDATE",
  "RUN_EXPERIMENT",
  "MEASURE",
  "LEARN",
  "HANDOFF",
  "WAIT_FOR_APPROVAL",
  "EXECUTE",
  "RECORD_MORE_DATA",
  "REASSESS",
  "RETRY",
  "BACKOFF",
  "REFRESH_STATE",
  "HUMAN_REVIEW",
  "STOP",
] as const;
export type AutonomousActionType = (typeof AUTONOMOUS_ACTION_TYPES)[number];

export type ActionSafetyStatus = "SAFE" | "APPROVAL_REQUIRED" | "BLOCKED";

export interface AutonomousPlannedAction {
  actionType: AutonomousActionType;
  target: { opportunityId: string; queue: string; stage: string };
  reason: string;
  prerequisites: string[];
  riskSafetyStatus: ActionSafetyStatus;
  requiredCapability: IntegrationCapability | null;
  approvalRequirement: "NOT_REQUIRED" | "REQUIRED";
  expectedObservation: string;
  idempotencyKey: string;
  dataClass: AutonomyDataClass;
  provider: string | null;
  requiresRealData: boolean;
}

export interface AutonomousActionPlan {
  generatedAt: string;
  actions: AutonomousPlannedAction[];
  consideredOpportunityIds: string[];
  deferredOpportunityIds: string[];
  limits: { maxActions: number; maxProviderCalls: number; maxRetries: number };
  dataClass: "REAL_DATA" | "AI_ESTIMATE" | "SAMPLE_DATA" | "UNKNOWN";
}

const MAX_ACTIONS = 10;
const MAX_PROVIDER_CALLS = 4;
const MAX_RETRIES = 3;

function providerFor(
  providers: readonly ProviderActivation[],
  capability: IntegrationCapability | null,
): ProviderActivation | null {
  if (!capability) return null;
  return [...providers]
    .filter((provider) => provider.status === "HEALTHY" && provider.capabilities.includes(capability))
    .sort((a, b) => a.provider.localeCompare(b.provider))[0] ?? null;
}

function actionFor(item: PortfolioOperatingItem): { type: AutonomousActionType; capability: IntegrationCapability | null; reason: string; expected: string; requiresRealData: boolean } {
  if (item.queue === "BLOCKED_QUEUE" || item.blocked) {
    return { type: "HUMAN_REVIEW", capability: null, reason: "The persisted opportunity state is blocked or requires conflict resolution.", expected: "A human decision explaining the blocker.", requiresRealData: false };
  }
  if (item.requiredApproval) {
    return { type: "WAIT_FOR_APPROVAL", capability: null, reason: "The existing task or opportunity state requires explicit human approval.", expected: "A recorded approval or a safe blocked state.", requiresRealData: false };
  }
  switch (item.queue) {
    case "RESEARCH_QUEUE": return { type: "RESEARCH_MORE", capability: "SEARCH", reason: item.recommendationReason ?? item.reasons[0] ?? "Research is the next existing portfolio recommendation.", expected: "A source-backed research result or an explicit provider blocker.", requiresRealData: false };
    case "VALIDATION_QUEUE": return { type: "VALIDATE", capability: null, reason: item.recommendationReason ?? item.reasons[0] ?? "Validation is the next existing portfolio recommendation.", expected: "A deterministic validation result with evidence references.", requiresRealData: false };
    case "EXPERIMENT_QUEUE": return { type: "RUN_EXPERIMENT", capability: null, reason: item.recommendationReason ?? item.reasons[0] ?? "Experiment design is the next existing portfolio recommendation.", expected: "A bounded experiment design without a business-success claim.", requiresRealData: false };
    case "LEARNING_QUEUE": return { type: "LEARN", capability: null, reason: item.recommendationReason ?? item.reasons[0] ?? "Learning is the next existing portfolio recommendation.", expected: "A learning signal derived only from recorded observations.", requiresRealData: true };
    case "HANDOFF_QUEUE": return { type: "HANDOFF", capability: null, reason: item.recommendationReason ?? item.reasons[0] ?? "Handoff is the next existing portfolio recommendation.", expected: "An owner-scoped handoff contract or a safe eligibility block.", requiresRealData: false };
    case "EXECUTION_QUEUE": return { type: "EXECUTE", capability: "READ_DATA", reason: item.recommendationReason ?? item.reasons[0] ?? "Execution is the next existing portfolio recommendation.", expected: "An existing execution result; completion never implies business success.", requiresRealData: true };
    case "MONITOR_QUEUE": return { type: "REASSESS", capability: null, reason: item.recommendationReason ?? item.reasons[0] ?? "The opportunity is in the bounded monitoring queue.", expected: "A refreshed decision and learning state with unknown data kept unknown.", requiresRealData: false };
    case "HUMAN_REVIEW_QUEUE": return { type: "HUMAN_REVIEW", capability: null, reason: item.recommendationReason ?? item.reasons[0] ?? "The portfolio requires human review.", expected: "A human-reviewed decision.", requiresRealData: false };
  }
}

function dataClassOf(item: PortfolioOperatingItem): AutonomyDataClass {
  return item.dataClass === "REAL_DATA" || item.dataClass === "AI_ESTIMATE" || item.dataClass === "SAMPLE_DATA" ? item.dataClass : "UNKNOWN";
}

/** Build a bounded plan from the existing portfolio controller; never ranks opportunities. */
export function planAutonomousActions(input: {
  ownerId: string;
  items: readonly PortfolioOperatingItem[];
  providers: readonly ProviderActivation[];
  systemHealth: SystemHealthStatus;
  selectedOpportunityIds?: readonly string[];
  now?: Date;
}): AutonomousActionPlan {
  const now = input.now ?? new Date();
  const selected = new Set(input.selectedOpportunityIds ?? input.items.filter((item) => item.selected).map((item) => item.opportunityId));
  const considered = input.items.filter((item) => selected.has(item.opportunityId)).slice(0, MAX_ACTIONS);
  const actions = considered.map((item) => {
    const spec = actionFor(item);
    const provider = providerFor(input.providers, spec.capability);
    const approvalRequired = item.requiredApproval || (spec.capability ? capabilityRequiresApproval(spec.capability) : false);
    const providerBlock = spec.capability && !provider;
    const riskSafetyStatus: ActionSafetyStatus = item.blocked || providerBlock || input.systemHealth === "BLOCKED"
      ? "BLOCKED"
      : approvalRequired
        ? "APPROVAL_REQUIRED"
        : "SAFE";
    return {
      actionType: spec.type,
      target: { opportunityId: item.opportunityId, queue: item.queue, stage: item.stage },
      reason: spec.reason,
      prerequisites: item.reasons.slice(0, 6),
      riskSafetyStatus,
      requiredCapability: spec.capability,
      approvalRequirement: approvalRequired ? "REQUIRED" : "NOT_REQUIRED",
      expectedObservation: spec.expected,
      idempotencyKey: buildIdempotencyKey({
        ownerId: input.ownerId,
        taskId: `operations:${item.opportunityId}`,
        adapterName: provider?.provider ?? "internal",
        action: spec.type,
        entityId: `${item.queue}:${item.stage}`,
      }),
      dataClass: dataClassOf(item),
      provider: provider?.provider ?? null,
      requiresRealData: spec.requiresRealData,
    } satisfies AutonomousPlannedAction;
  });
  const deferred = input.items.filter((item) => !selected.has(item.opportunityId)).map((item) => item.opportunityId);
  return {
    generatedAt: now.toISOString(),
    actions,
    consideredOpportunityIds: considered.map((item) => item.opportunityId),
    deferredOpportunityIds: deferred,
    limits: { maxActions: MAX_ACTIONS, maxProviderCalls: MAX_PROVIDER_CALLS, maxRetries: MAX_RETRIES },
    dataClass: actions.some((action) => action.dataClass === "REAL_DATA") ? "REAL_DATA" : actions.some((action) => action.dataClass === "SAMPLE_DATA") ? "SAMPLE_DATA" : actions.some((action) => action.dataClass === "AI_ESTIMATE") ? "AI_ESTIMATE" : "UNKNOWN",
  };
}
