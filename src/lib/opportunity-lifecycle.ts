/**
 * Opportunity lifecycle states (pure, deterministic).
 *
 * A deterministic lifecycle derived from the SAME persisted inputs as the
 * decision engine — never a second conflicting state system. The existing
 * `Opportunity.status` field (Prisma `OpportunityStatus`) is the system of
 * record and is NEVER written by this module; the lifecycle here is an
 * advisory read-model rendered next to the decision.
 *
 * Forward path:
 *
 *   DISCOVERED → RESEARCHING → EVIDENCE_READY → VALIDATION_REQUIRED
 *     → VALIDATING → EXPERIMENTING → LEARNING → HANDOFF_READY
 *     → EXECUTION_READY → EXECUTING → MEASURING → LEARNED
 *
 * Failure/alternate states:
 *
 *   BLOCKED · HUMAN_REVIEW · RESEARCH_CONFLICT · VALIDATION_CONFLICT
 *     · EXPERIMENT_INSUFFICIENT
 */
import type { OpportunityReadiness, OpportunityReadinessState } from "@/lib/opportunity-readiness";
import type { OpportunityDecisionState } from "@/lib/opportunity-decision";

export const OPPORTUNITY_LIFECYCLE_STATES = [
  "DISCOVERED",
  "RESEARCHING",
  "EVIDENCE_READY",
  "VALIDATION_REQUIRED",
  "VALIDATING",
  "EXPERIMENTING",
  "LEARNING",
  "HANDOFF_READY",
  "EXECUTION_READY",
  "EXECUTING",
  "MEASURING",
  "LEARNED",
  // Failure / alternate states
  "BLOCKED",
  "HUMAN_REVIEW",
  "RESEARCH_CONFLICT",
  "VALIDATION_CONFLICT",
  "EXPERIMENT_INSUFFICIENT",
] as const;

export type OpportunityLifecycleState = (typeof OPPORTUNITY_LIFECYCLE_STATES)[number];

export interface LifecycleExecutionInput {
  hasRunningAgentTask: boolean;
  hasCompletedExecution: boolean;
}

/**
 * Derive the lifecycle state from persisted inputs. Deterministic: the same
 * inputs always produce the same state. Prefers the most specific state.
 */
export function deriveOpportunityLifecycle(options: {
  decision: OpportunityDecisionState;
  readinessState: OpportunityReadinessState;
  researchFreshnessKind: OpportunityReadiness["researchFreshness"]["kind"];
  experimentCount: number;
  realMetricPeriods: number;
  execution: LifecycleExecutionInput;
}): OpportunityLifecycleState {
  const { decision, readinessState, researchFreshnessKind, experimentCount, realMetricPeriods, execution } = options;

  // Terminal/alternate states first.
  if (decision === "BLOCKED") return "BLOCKED";
  if (decision === "HUMAN_REVIEW") return "HUMAN_REVIEW";
  if (decision === "REVIEW_CONFLICT") {
    // Validation-layer conflicts are the common case; research-layer conflicts
    // are the alternate when validation is not the source.
    return readinessState === "EVIDENCE_INSUFFICIENT" ? "RESEARCH_CONFLICT" : "VALIDATION_CONFLICT";
  }
  if (decision === "IMPROVE_EXPERIMENT") return "EXPERIMENT_INSUFFICIENT";

  // Freshness-dependent states.
  if (researchFreshnessKind === "NO_RESEARCH") return "DISCOVERED";
  if (researchFreshnessKind === "STALE_RESEARCH") return "VALIDATION_REQUIRED";

  // Forward path by decision.
  switch (decision) {
    case "RESEARCH_MORE":
      return readinessState === "EVIDENCE_INSUFFICIENT" ? "EVIDENCE_READY" : "RESEARCHING";
    case "VALIDATE":
      return readinessState === "EVIDENCE_INSUFFICIENT" ? "RESEARCHING" : "VALIDATION_REQUIRED";
    case "RUN_EXPERIMENT":
      return experimentCount > 0 ? "EXPERIMENTING" : "VALIDATING";
    case "HANDOFF_READY":
      return "HANDOFF_READY";
    case "EXECUTION_READY":
      if (execution.hasRunningAgentTask) return "EXECUTING";
      return execution.hasCompletedExecution ? "MEASURING" : "EXECUTION_READY";
    default:
      return "DISCOVERED";
  }
}
