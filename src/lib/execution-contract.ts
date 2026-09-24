/**
 * Phase 9A — AgentExecution contract (machine-readable, provider-independent).
 *
 * One execution = one allowlisted AgentTask action run through one resolved
 * integration. The orchestrator (server/execution-orchestrator.ts) is the only
 * writer; everything in here is pure so the state machine, retry policy and
 * dry-run labeling can be tested without a database.
 *
 * Honesty rules (asserted by tests):
 * - An execution that did not actually execute is never SUCCEEDED.
 * - DRY_RUN is a clearly labeled simulation (mode DRY_RUN, dryRun=true,
 *   dataClass SAMPLE_DATA) — never REAL_DATA, never REAL_EXECUTION.
 * - Retries are bounded, capability-aware, and only for retry-safe failures.
 * - All failures are classified, sanitized, and persisted on the same row.
 */

/** Version of this execution contract; bumped on incompatible shape changes. */
export const EXECUTION_CONTRACT_VERSION = 1;

/** Full lifecycle of one AgentExecution (mirrors the Prisma enum). */
export type AgentExecutionStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "AUTH_FAILED"
  | "UNAVAILABLE"
  | "BLOCKED"
  | "CANCELLED";

export const AGENT_EXECUTION_STATUSES: readonly AgentExecutionStatus[] = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "TIMEOUT",
  "RATE_LIMITED",
  "AUTH_FAILED",
  "UNAVAILABLE",
  "BLOCKED",
  "CANCELLED",
];

/** How the execution ran. DRY_RUN never touches a real provider. */
export type ExecutionMode = "LIVE" | "DRY_RUN";

/** Recorded data class of an execution result (mirrors Phase 7 classes). */
export type ExecutionDataClass = "REAL_DATA" | "AI_GENERATED" | "AI_ESTIMATE" | "SAMPLE_DATA";

/** Approval states recorded on the execution row. */
export type ExecutionApprovalStatus =
  | "NOT_REQUIRED"
  | "WAITING_APPROVAL"
  | "APPROVED"
  | "REJECTED";

/**
 * Deterministic state machine. Invalid transitions must be rejected by the
 * repository — the table is the single source of truth.
 *
 * - QUEUED → RUNNING (start) or CANCELLED (cancelled before start).
 * - RUNNING → SUCCEEDED / FAILED / TIMEOUT / RATE_LIMITED / AUTH_FAILED /
 *   UNAVAILABLE / BLOCKED / CANCELLED (owner cancellation mid-run).
 * - FAILED / TIMEOUT / RATE_LIMITED → RUNNING (bounded, capability-aware
 *   retry — the only "back" edges in the machine).
 * - SUCCEEDED / CANCELLED / AUTH_FAILED / UNAVAILABLE / BLOCKED are terminal:
 *   auth needs human attention, unavailability is environmental, blocked means
 *   a gate refused, and no automatic path may leave those states.
 */
const TRANSITIONS: Record<AgentExecutionStatus, readonly AgentExecutionStatus[]> = {
  QUEUED: ["RUNNING", "CANCELLED"],
  RUNNING: ["SUCCEEDED", "FAILED", "TIMEOUT", "RATE_LIMITED", "AUTH_FAILED", "UNAVAILABLE", "BLOCKED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: ["RUNNING"],
  TIMEOUT: ["RUNNING"],
  RATE_LIMITED: ["RUNNING"],
  AUTH_FAILED: [],
  UNAVAILABLE: [],
  BLOCKED: [],
  CANCELLED: [],
};

export function canTransitionExecution(from: AgentExecutionStatus, to: AgentExecutionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Which outcome states may be retried (bounded by the orchestrator). */
const RETRYABLE_OUTCOMES: readonly AgentExecutionStatus[] = ["FAILED", "TIMEOUT", "RATE_LIMITED"];

export function isRetryableExecutionOutcome(status: AgentExecutionStatus): boolean {
  return RETRYABLE_OUTCOMES.includes(status);
}

/**
 * Retry-safe failure classes. Mirrors Phase 8's ErrorClass: SERVER/NETWORK/
 * RATE_LIMIT may retry; AUTH (credential problem), REQUEST (our input was
 * wrong — retrying cannot fix it) and UNKNOWN may not.
 */
export const RETRYABLE_ERROR_CLASSES = ["SERVER", "NETWORK", "RATE_LIMIT"] as const;

export type ExecutionErrorClass = "AUTH" | "RATE_LIMIT" | "TIMEOUT" | "SERVER" | "REQUEST" | "NETWORK" | "UNKNOWN";

export function isRetryableErrorClass(errorClass: ExecutionErrorClass): boolean {
  return (RETRYABLE_ERROR_CLASSES as readonly string[]).includes(errorClass);
}

/**
 * Capabilities whose actions must NEVER be automatically retried: an
 * irreversible or financial external action may have succeeded even when the
 * call timed out, so blind repetition risks double-publishing or double-
 * spending. Human review handles those instead.
 */
export const NO_AUTO_RETRY_CAPABILITIES: readonly string[] = [
  "PUBLISH",
  "SEND_MESSAGE",
  "CREATE_CAMPAIGN",
  "SPEND_MONEY",
  "UPLOAD",
];

export function capabilityAllowsAutoRetry(capability: string | null): boolean {
  return capability === null || !NO_AUTO_RETRY_CAPABILITIES.includes(capability);
}

/** Bounded retry bounds. maxAttempts includes the first attempt. */
export const EXECUTION_RETRY_BOUNDS = {
  maxAttempts: { min: 1, max: 5 },
} as const;

/** Default attempts for a task: the task's maxRetries, clamped here. */
export function clampMaxAttempts(requested: number): number {
  return Math.min(Math.max(Math.floor(requested) || 1, EXECUTION_RETRY_BOUNDS.maxAttempts.min), EXECUTION_RETRY_BOUNDS.maxAttempts.max);
}

/**
 * Deterministic idempotency key. The same task + action + integration (+ mode)
 * must resolve to one execution, so duplicate API requests cannot create
 * duplicate external work. Mode is included so a dry run never suppresses a
 * later real execution.
 */
export function buildExecutionIdempotencyKey(parts: {
  ownerId: string;
  taskId: string;
  integration: string;
  action: string;
  mode: ExecutionMode;
}): string {
  return [parts.ownerId, parts.taskId, parts.integration, parts.action, parts.mode].join(":").slice(0, 200);
}

/** Full result payload stored on the execution row (and returned to clients). */
export interface AgentExecutionResult {
  /** Human-readable one-line summary (sanitized, size-capped upstream). */
  summary: string;
  integration: string;
  action: string;
  capability: string | null;
  mode: ExecutionMode;
  attempts: number;
  /** Provider-reported output, already sanitized upstream; null when none. */
  output: unknown;
  externalId: string | null;
  usage: Record<string, number> | null;
  estimatedCost: number | null;
  /** Non-retryable classification of the final failure, when failed. */
  errorClass: ExecutionErrorClass | null;
}

/**
 * Label a dry-run result honestly: ALWAYS SAMPLE_DATA, mode DRY_RUN. Callers
 * must pass through whatever the simulated action produced — never relabel it
 * REAL_DATA.
 */
export function dryRunDataClass(): ExecutionDataClass {
  return "SAMPLE_DATA";
}

/** LIVE executions carry the adapter's own data class (never rewritten). */
export function liveDataClass(dataClass: ExecutionDataClass): ExecutionDataClass {
  return dataClass;
}

/** Validate a client-safe execution query (list filters). */
export function isAgentExecutionStatus(value: unknown): value is AgentExecutionStatus {
  return typeof value === "string" && (AGENT_EXECUTION_STATUSES as readonly string[]).includes(value);
}
