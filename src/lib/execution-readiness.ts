/**
 * Phase 19 — execution readiness gate (pure and fail-closed).
 *
 * This is deliberately an assessment, not an executor. It accepts facts from
 * the existing decision, handoff, provider, permission, approval, measurement,
 * and execution contracts and returns an explainable state. A caller must
 * still use the existing execution orchestrator for any real action.
 */
import { capabilityRequiresApproval, type IntegrationCapability, type IntegrationStatus } from "@/lib/integrations/contract";
import type { OpportunityDecision } from "@/lib/opportunity-decision";

export const EXECUTION_READINESS_STATES = ["NOT_READY", "READY", "BLOCKED", "HUMAN_REVIEW"] as const;
export type ExecutionReadinessState = (typeof EXECUTION_READINESS_STATES)[number];
export type ExecutionReadinessDataClass = "REAL_DATA" | "AI_GENERATED" | "AI_ESTIMATE" | "SAMPLE_DATA" | "ESTIMATED_DATA" | "NOT_MEASURED" | "UNKNOWN";

export interface ExecutionReadinessInput {
  authenticated: boolean;
  ownerId: string | null;
  opportunityId: string | null;
  opportunityOwned: boolean;
  decision: OpportunityDecision | null;
  handoffStatus: string | null;
  validationCompleted: boolean;
  experimentState: string | null;
  learningSignalAvailable: boolean;
  provider: { name: string; status: IntegrationStatus; healthCheckedAt: string | null; configured: boolean } | null;
  capability: IntegrationCapability | null;
  capabilityAuthorized: boolean;
  approvalRequired: boolean;
  approvalGranted: boolean;
  measurementAvailable: boolean;
  measurementDataClass: ExecutionReadinessDataClass;
  stopConditions: string[];
  stopped: boolean;
  idempotencyKey: string | null;
  existingExecution: boolean;
  dataClass: ExecutionReadinessDataClass;
  now?: Date;
}

export interface ExecutionReadinessResult {
  state: ExecutionReadinessState;
  ready: boolean;
  reason: string;
  reasons: string[];
  blockers: string[];
  missing: string[];
  requiredApproval: boolean;
  approvalStatus: "NOT_REQUIRED" | "WAITING_APPROVAL" | "APPROVED";
  dataClass: ExecutionReadinessDataClass;
  nextAction: string;
  idempotencyKey: string | null;
  evaluatedAt: string;
}

/** Evaluate every gate in a stable order; missing facts fail closed. */
export function assessExecutionReadiness(input: ExecutionReadinessInput): ExecutionReadinessResult {
  const reasons: string[] = [];
  const blockers: string[] = [];
  const missing: string[] = [];
  const add = (condition: boolean, reason: string, gap = reason, hard = false) => {
    if (!condition) {
      reasons.push(reason);
      (hard ? blockers : missing).push(gap);
    }
  };

  add(input.authenticated, "Authenticated owner context is required.", "Authentication");
  add(Boolean(input.ownerId), "Owner context is required.", "Owner context", true);
  add(input.opportunityOwned, "Opportunity ownership is not verified.", "Opportunity ownership", true);
  add(Boolean(input.opportunityId), "Opportunity is required.", "Opportunity", true);
  add(Boolean(input.decision), "Current opportunity decision is unavailable.", "Current decision", true);
  add(input.decision?.decision === "EXECUTION_READY", "Current decision is not EXECUTION_READY.", "Decision EXECUTION_READY", true);
  add(input.validationCompleted, "Required opportunity validation is incomplete.", "Completed validation");
  add(["ACCEPTED", "COMPLETED"].includes(input.handoffStatus ?? ""), "Handoff is not ACCEPTED or COMPLETED.", "Accepted handoff", true);
  add(Boolean(input.experimentState), "Experiment state is unavailable.", "Experiment state");
  add(input.learningSignalAvailable, "No persisted learning signal is available for reassessment.", "Learning signal");
  add(Boolean(input.provider), "Execution provider is not identified.", "Provider");
  add(input.provider?.status === "HEALTHY", "Provider has not passed a real health check.", "Verified provider health", true);
  add(Boolean(input.provider?.healthCheckedAt), "Provider health has not been checked.", "Provider health check", true);
  add(Boolean(input.capability), "Execution capability is not identified.", "Capability", true);
  add(input.capabilityAuthorized, "Capability is not authorized for this owner.", "Capability authorization", true);
  add(input.approvalRequired === capabilityRequiresApproval(input.capability as IntegrationCapability), "Approval requirement does not match the selected capability.", "Approval requirement", true);
  if (input.approvalRequired) {
    add(input.approvalGranted, "Explicit human approval is required; execution is WAIT_FOR_APPROVAL.", "Explicit approval");
  }
  add(input.measurementAvailable, "No source-backed measurement plan/source is available.", "Measurement source");
  add(input.measurementDataClass === "REAL_DATA", "Measurement is not source-backed REAL_DATA.", "REAL_DATA measurement");
  add(
    ["REAL_DATA", "AI_GENERATED", "NOT_MEASURED", "UNKNOWN"].includes(input.dataClass),
    "Execution data class is invalid for a controlled plan.",
    "Valid data class",
    true,
  );
  add(input.stopConditions.length > 0, "At least one stop condition is required.", "Stop conditions", true);
  add(!input.stopped, "Execution is stopped by a safety condition.", "Stopped execution", true);
  add(Boolean(input.idempotencyKey), "Deterministic idempotency key is required.", "Idempotency key", true);
  add(!input.existingExecution, "An execution already exists for this plan; do not create a duplicate.", "No duplicate execution", true);

  const hard = blockers.length > 0;
  const requiredApproval = input.approvalRequired;
  const waitingApproval = requiredApproval && !input.approvalGranted;
  const state: ExecutionReadinessState = hard
    ? "BLOCKED"
    : waitingApproval || input.decision?.decision === "HUMAN_REVIEW" || input.decision?.decision === "REVIEW_CONFLICT"
      ? "HUMAN_REVIEW"
      : reasons.length === 0
        ? "READY"
        : "NOT_READY";
  const nextAction = state === "READY"
    ? "Pass the approved plan to the existing owner-scoped execution orchestrator; do not infer business success."
    : waitingApproval
      ? "WAIT_FOR_APPROVAL — no external action may run."
      : state === "BLOCKED"
        ? "Resolve the blocked safety or authorization gate before any execution."
        : missing[0] ?? "Resolve the missing execution prerequisite.";

  return {
    state,
    ready: state === "READY",
    reason: reasons[0] ?? "All execution readiness gates passed.",
    reasons,
    blockers,
    missing,
    requiredApproval,
    approvalStatus: requiredApproval ? (input.approvalGranted ? "APPROVED" : "WAITING_APPROVAL") : "NOT_REQUIRED",
    dataClass: input.measurementDataClass === "REAL_DATA" ? "REAL_DATA" : input.measurementDataClass,
    nextAction,
    idempotencyKey: input.idempotencyKey,
    evaluatedAt: (input.now ?? new Date()).toISOString(),
  };
}
