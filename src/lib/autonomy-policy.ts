/**
 * Phase 20 — deterministic autonomy policy.
 *
 * This module decides whether an already planned action may be handed to an
 * existing execution boundary. It never calls a provider, persists state, or
 * grants approval. Missing facts fail closed.
 */
import { capabilityRequiresApproval, type IntegrationCapability, type IntegrationStatus } from "@/lib/integrations/contract";
import type { ProviderActivationStatus } from "@/lib/integrations/provider-activation";

export const AUTONOMY_LEVELS = ["ADVISORY", "CONTROLLED", "APPROVAL_REQUIRED", "BLOCKED"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const AUTONOMY_GATE_STATES = ["READY", "WAITING_FOR_APPROVAL", "BLOCKED", "HUMAN_REVIEW"] as const;
export type AutonomyGateState = (typeof AUTONOMY_GATE_STATES)[number];

export type AutonomyDataClass =
  | "REAL_DATA"
  | "AI_GENERATED"
  | "AI_ESTIMATE"
  | "SAMPLE_DATA"
  | "ESTIMATED_DATA"
  | "NOT_MEASURED"
  | "UNKNOWN";

export interface AutonomyGateInput {
  actionType: string;
  capability: IntegrationCapability | null;
  providerStatus: IntegrationStatus | ProviderActivationStatus | null;
  providerName?: string | null;
  authenticated: boolean;
  ownerVerified: boolean;
  authorized: boolean;
  approvalRequired: boolean;
  approvalGranted: boolean;
  approvalRevoked?: boolean;
  dataClass: AutonomyDataClass;
  requiresRealData?: boolean;
  idempotencyKey: string | null;
  existingEquivalentAction?: boolean;
  concurrencyAvailable: boolean;
  stopConditions: string[];
  systemHealth: "HEALTHY" | "DEGRADED" | "BLOCKED" | "UNKNOWN";
}

export interface AutonomyGateResult {
  state: AutonomyGateState;
  level: AutonomyLevel;
  canExecute: boolean;
  approvalRequired: boolean;
  blockers: string[];
  missing: string[];
  reason: string;
}

function providerIsReady(status: IntegrationStatus | ProviderActivationStatus | null): boolean {
  return status === "HEALTHY";
}

/**
 * Evaluate gates in stable order. The caller must still use the existing
 * task/orchestrator approval and capability checks before any real write.
 */
export function evaluateAutonomyGate(input: AutonomyGateInput): AutonomyGateResult {
  const blockers: string[] = [];
  const missing: string[] = [];
  const addBlocker = (message: string) => blockers.push(message);
  const addMissing = (message: string) => missing.push(message);

  if (!input.authenticated) addBlocker("Authentication is required.");
  if (!input.ownerVerified) addBlocker("Owner scope could not be verified.");
  if (!input.authorized) addBlocker("The owner is not authorized for this action.");
  if (input.systemHealth === "BLOCKED") addBlocker("System health is BLOCKED.");
  if (!input.concurrencyAvailable) addBlocker("The bounded concurrency limit is exhausted.");
  if (input.stopConditions.length > 0) addBlocker("A stop condition prevents execution.");
  if (!input.idempotencyKey) addBlocker("A deterministic idempotency key is required.");
  if (input.existingEquivalentAction) addMissing("An equivalent action was already observed; do not repeat it.");
  if (input.approvalRevoked) addBlocker("Human approval was revoked.");

  const capabilityNeedsApproval = input.capability ? capabilityRequiresApproval(input.capability) : false;
  if (input.approvalRequired !== capabilityNeedsApproval && input.capability) {
    addBlocker("Approval requirement does not match the existing capability policy.");
  }
  if (capabilityNeedsApproval && !input.approvalGranted) {
    addMissing("Explicit human approval is required for this capability.");
  }
  if (input.approvalRequired && !input.approvalGranted) {
    addMissing("Explicit human approval has not been granted.");
  }

  if (input.capability) {
    if (!providerIsReady(input.providerStatus)) {
      addBlocker(
        input.providerName
          ? `Provider ${input.providerName} is ${input.providerStatus ?? "UNAVAILABLE"}; configuration is not health.`
          : "A verified provider health check is required before this action.",
      );
    }
  }
  if (input.requiresRealData && input.dataClass !== "REAL_DATA") {
    addBlocker("This action requires source-backed REAL_DATA.");
  }
  if (input.dataClass === "SAMPLE_DATA" || input.dataClass === "ESTIMATED_DATA" || input.dataClass === "AI_ESTIMATE" || input.dataClass === "UNKNOWN" || input.dataClass === "NOT_MEASURED") {
    if (input.requiresRealData) addMissing("The current data class cannot be treated as REAL_DATA.");
  }

  const hasApprovalWait = (input.approvalRequired || capabilityNeedsApproval) && !input.approvalGranted;
  const state: AutonomyGateState = blockers.length > 0
    ? "BLOCKED"
    : hasApprovalWait
      ? "WAITING_FOR_APPROVAL"
      : missing.length > 0
        ? "HUMAN_REVIEW"
        : "READY";
  const level: AutonomyLevel = state === "BLOCKED"
    ? "BLOCKED"
    : state === "WAITING_FOR_APPROVAL"
      ? "APPROVAL_REQUIRED"
      : missing.length > 0
        ? "ADVISORY"
        : "CONTROLLED";

  return {
    state,
    level,
    canExecute: state === "READY" && !input.existingEquivalentAction,
    approvalRequired: input.approvalRequired || capabilityNeedsApproval,
    blockers: [...new Set(blockers)],
    missing: [...new Set(missing)],
    reason: blockers[0] ?? missing[0] ?? (state === "READY" ? "All autonomy gates passed." : "Human review is required."),
  };
}
