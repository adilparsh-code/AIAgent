/**
 * Phase 15 — safe live activation/test plan generator.
 *
 * The plan is data only. It never calls a provider, persists an execution,
 * bridges a metric, or performs a write. Write-side capabilities stop at an
 * explicit approval boundary.
 */

import { capabilityRequiresApproval, type IntegrationCapability } from "./contract";
import { getProviderChecklistEntry } from "./provider-checklist";
import type { ProviderActivation } from "./provider-activation";

export const LIVE_TEST_PLAN_STEPS = [
  "CONFIGURE_PROVIDER_SECRET_SERVER_SIDE",
  "VERIFY_SECRET_NOT_EXPOSED",
  "RUN_REAL_HEALTH_CHECK",
  "PERSIST_INTEGRATION_HEALTH",
  "CHECK_CAPABILITY_PERMISSION",
  "RUN_MINIMAL_SAFE_READ_OR_SEARCH_TEST",
  "NORMALIZE_PROVIDER_RESPONSE",
  "PERSIST_INTEGRATION_EXECUTION",
  "BRIDGE_EXPERIMENT_METRIC_IF_MEASURABLE",
  "EMIT_OPERATIONAL_EVENT",
  "CLASSIFY_RESULT",
  "VERIFY_HEALTH_DASHBOARD",
  "VERIFY_NO_SECRET_LEAKAGE",
  "VERIFY_APPROVAL_GATES",
  "RUN_END_TO_END_TEST",
] as const;

export type LiveTestPlanStatus =
  | "BLOCKED_CONFIGURATION"
  | "HEALTH_CHECK_REQUIRED"
  | "WAITING_FOR_PROVIDER_REMEDIATION"
  | "LIVE_WRITE_TEST_REQUIRES_APPROVAL"
  | "READY_FOR_LIVE_VERIFICATION";

export interface LiveTestPlanStep {
  order: number;
  action: (typeof LIVE_TEST_PLAN_STEPS)[number];
  automaticExecutionAllowed: boolean;
  approvalRequired: boolean;
}

export interface SafeLiveTestPlan {
  provider: string;
  capability: IntegrationCapability;
  status: LiveTestPlanStatus;
  approvalRequired: boolean;
  steps: LiveTestPlanStep[];
  safeNextStep: string;
  externalActionsPerformed: false;
}

function stepsThrough(last: (typeof LIVE_TEST_PLAN_STEPS)[number], approvalRequired = false): LiveTestPlanStep[] {
  const end = LIVE_TEST_PLAN_STEPS.indexOf(last);
  return LIVE_TEST_PLAN_STEPS.slice(0, end + 1).map((action, index) => ({
    order: index + 1,
    action,
    automaticExecutionAllowed: false,
    approvalRequired,
  }));
}

export function buildSafeLiveTestPlan(
  activation: ProviderActivation,
  capability?: IntegrationCapability,
): SafeLiveTestPlan {
  const checklist = getProviderChecklistEntry(activation.provider);
  const selectedCapability = capability ?? checklist?.capabilities[0] ?? "READ_DATA";
  const approvalRequired = capabilityRequiresApproval(selectedCapability);

  if (approvalRequired) {
    return {
      provider: activation.provider,
      capability: selectedCapability,
      status: "LIVE_WRITE_TEST_REQUIRES_APPROVAL",
      approvalRequired: true,
      steps: stepsThrough("CHECK_CAPABILITY_PERMISSION", true),
      safeNextStep: "Do not execute the write-side test; obtain explicit approval through the existing execution gate first.",
      externalActionsPerformed: false,
    };
  }

  if (!activation.configured) {
    return {
      provider: activation.provider,
      capability: selectedCapability,
      status: "BLOCKED_CONFIGURATION",
      approvalRequired: false,
      steps: stepsThrough("VERIFY_SECRET_NOT_EXPOSED"),
      safeNextStep: "Configure the provider server-side, then restart the activation flow at the health-check step.",
      externalActionsPerformed: false,
    };
  }

  if (activation.status !== "HEALTHY") {
    const remediationStatus = activation.status === "READY_FOR_HEALTH_CHECK" || activation.status === "CONFIGURED"
      ? "HEALTH_CHECK_REQUIRED"
      : "WAITING_FOR_PROVIDER_REMEDIATION";
    return {
      provider: activation.provider,
      capability: selectedCapability,
      status: remediationStatus,
      approvalRequired: false,
      steps: stepsThrough("CHECK_CAPABILITY_PERMISSION"),
      safeNextStep: remediationStatus === "HEALTH_CHECK_REQUIRED"
        ? "Run the real provider health check before any live test."
        : "Resolve the provider health issue before any live test; do not retry credit or authentication failures automatically.",
      externalActionsPerformed: false,
    };
  }

  return {
    provider: activation.provider,
    capability: selectedCapability,
    status: "READY_FOR_LIVE_VERIFICATION",
    approvalRequired: false,
    steps: LIVE_TEST_PLAN_STEPS.map((action, index) => ({
      order: index + 1,
      action,
      automaticExecutionAllowed: false,
      approvalRequired: false,
    })),
    safeNextStep: "Run the minimum safe read/search test manually through the existing, authenticated execution flow after reviewing the plan.",
    externalActionsPerformed: false,
  };
}
