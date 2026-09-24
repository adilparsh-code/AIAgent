/** Phase 14 — deterministic failure classification and non-executing recovery policy. */

export const FAILURE_CATEGORIES = [
  "TRANSIENT",
  "CONFIGURATION",
  "AUTHENTICATION",
  "AUTHORIZATION",
  "VALIDATION",
  "DATA_INTEGRITY",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "TIMEOUT",
  "DUPLICATE",
  "UNKNOWN",
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export const RECOVERY_ACTIONS = [
  "RETRY",
  "BACKOFF",
  "WAIT_FOR_APPROVAL",
  "REFRESH_STATE",
  "RESEARCH_AGAIN",
  "REVALIDATE",
  "RECORD_MORE_DATA",
  "DISABLE_COMPONENT",
  "HUMAN_REVIEW",
  "STOP",
] as const;
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

export interface FailureClassification {
  category: FailureCategory;
  retryable: boolean;
  safeUserMessage: string;
  operationalAction: RecoveryAction;
}

const RULES: Array<{ category: FailureCategory; pattern: RegExp; retryable: boolean; message: string; action: RecoveryAction }> = [
  { category: "DUPLICATE", pattern: /unique|duplicate|already (?:exists|processed|succeeded)/i, retryable: false, message: "The request was already processed or conflicts with an existing record.", action: "REFRESH_STATE" },
  { category: "AUTHENTICATION", pattern: /auth(?:entication)?|unauthori[sz]ed|invalid (?:api )?key|401/i, retryable: false, message: "Authentication failed. Verify the configured internal credential or session.", action: "HUMAN_REVIEW" },
  { category: "AUTHORIZATION", pattern: /authori[sz]ation|forbidden|permission|capability|approval|403/i, retryable: false, message: "The operation is not permitted until the existing approval or capability gate passes.", action: "WAIT_FOR_APPROVAL" },
  { category: "RATE_LIMITED", pattern: /rate.?limit|429|too many requests/i, retryable: true, message: "The operation was rate limited. Retry only after the safe backoff boundary.", action: "BACKOFF" },
  { category: "TIMEOUT", pattern: /timeout|timed out|aborted|deadline|ETIMEDOUT/i, retryable: true, message: "The operation timed out. Retry only when idempotency and safety gates permit it.", action: "BACKOFF" },
  { category: "PROVIDER_UNAVAILABLE", pattern: /unavailable|connection refused|network|fetch failed|5\d\d/i, retryable: true, message: "A dependency is unavailable. No provider health is assumed from configuration alone.", action: "RETRY" },
  { category: "CONFIGURATION", pattern: /config(?:uration)?|missing env|not configured|no credentials|invalid configuration/i, retryable: false, message: "The component is not configured. No external action should be attempted.", action: "DISABLE_COMPONENT" },
  { category: "VALIDATION", pattern: /validation|invalid input|bad request|400|failed contract/i, retryable: false, message: "The input or persisted state failed validation. Correct the data before retrying.", action: "REVALIDATE" },
  { category: "DATA_INTEGRITY", pattern: /constraint|integrity|foreign key|transaction|invariant/i, retryable: false, message: "A data-integrity rule prevented the operation. Review persisted state.", action: "HUMAN_REVIEW" },
  { category: "TRANSIENT", pattern: /temporary|transient|connection reset|try again/i, retryable: true, message: "A temporary failure occurred. Retry within the existing bounded retry policy.", action: "RETRY" },
];

export function classifyFailure(error: unknown): FailureClassification {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const rule = RULES.find((candidate) => candidate.pattern.test(message));
  if (rule) {
    return { category: rule.category, retryable: rule.retryable, safeUserMessage: rule.message, operationalAction: rule.action };
  }
  return {
    category: "UNKNOWN",
    retryable: false,
    safeUserMessage: "The failure could not be classified safely. Human review is required.",
    operationalAction: "HUMAN_REVIEW",
  };
}

export interface RecoveryPolicyInput extends FailureClassification {
  requiresApproval?: boolean;
  capabilityAvailable?: boolean;
  idempotencyKnown?: boolean;
  hasResearch?: boolean;
  hasValidation?: boolean;
  hasExperimentData?: boolean;
}

/** Recommend a recovery decision only; never execute it. */
export function determineRecoveryPolicy(input: RecoveryPolicyInput): RecoveryAction {
  if (input.requiresApproval) return "WAIT_FOR_APPROVAL";
  if (input.category === "AUTHORIZATION" || input.category === "AUTHENTICATION") return "HUMAN_REVIEW";
  if (input.category === "DATA_INTEGRITY" || input.category === "DUPLICATE") return "REFRESH_STATE";
  if (input.category === "VALIDATION") return input.hasValidation ? "REVALIDATE" : "RESEARCH_AGAIN";
  if (input.category === "CONFIGURATION" || input.category === "PROVIDER_UNAVAILABLE") return "DISABLE_COMPONENT";
  if (input.category === "RATE_LIMITED" || input.category === "TIMEOUT") return "BACKOFF";
  if (input.category === "TRANSIENT" && input.idempotencyKnown && input.capabilityAvailable !== false) return "RETRY";
  if (input.category === "TRANSIENT") return "HUMAN_REVIEW";
  return input.retryable ? "RETRY" : "HUMAN_REVIEW";
}
