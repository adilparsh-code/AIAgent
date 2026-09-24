/**
 * Phase 9A — execution contract unit tests (pure, no database): deterministic
 * state machine, retry policy, idempotency key stability, and DRY_RUN honesty
 * labeling.
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_EXECUTION_STATUSES,
  EXECUTION_CONTRACT_VERSION,
  buildExecutionIdempotencyKey,
  canTransitionExecution,
  capabilityAllowsAutoRetry,
  clampMaxAttempts,
  dryRunDataClass,
  isAgentExecutionStatus,
  isRetryableErrorClass,
  isRetryableExecutionOutcome,
  liveDataClass,
} from "./execution-contract";

describe("Phase 9A execution contract", () => {
  it("exposes the full status set", () => {
    expect(AGENT_EXECUTION_STATUSES).toEqual([
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
    ]);
    expect(EXECUTION_CONTRACT_VERSION).toBe(1);
  });

  it("allows the documented happy-path transitions", () => {
    expect(canTransitionExecution("QUEUED", "RUNNING")).toBe(true);
    expect(canTransitionExecution("RUNNING", "SUCCEEDED")).toBe(true);
    expect(canTransitionExecution("RUNNING", "FAILED")).toBe(true);
    expect(canTransitionExecution("RUNNING", "TIMEOUT")).toBe(true);
    expect(canTransitionExecution("RUNNING", "RATE_LIMITED")).toBe(true);
    expect(canTransitionExecution("RUNNING", "AUTH_FAILED")).toBe(true);
    expect(canTransitionExecution("RUNNING", "UNAVAILABLE")).toBe(true);
    expect(canTransitionExecution("RUNNING", "BLOCKED")).toBe(true);
    expect(canTransitionExecution("RUNNING", "CANCELLED")).toBe(true);
    expect(canTransitionExecution("QUEUED", "CANCELLED")).toBe(true);
  });

  it("allows only bounded retry re-entry: FAILED/TIMEOUT/RATE_LIMITED → RUNNING", () => {
    expect(canTransitionExecution("FAILED", "RUNNING")).toBe(true);
    expect(canTransitionExecution("TIMEOUT", "RUNNING")).toBe(true);
    expect(canTransitionExecution("RATE_LIMITED", "RUNNING")).toBe(true);
    expect(isRetryableExecutionOutcome("FAILED")).toBe(true);
    expect(isRetryableExecutionOutcome("TIMEOUT")).toBe(true);
    expect(isRetryableExecutionOutcome("RATE_LIMITED")).toBe(true);
    expect(isRetryableExecutionOutcome("SUCCEEDED")).toBe(false);
    expect(isRetryableExecutionOutcome("AUTH_FAILED")).toBe(false);
    expect(isRetryableExecutionOutcome("UNAVAILABLE")).toBe(false);
    expect(isRetryableExecutionOutcome("BLOCKED")).toBe(false);
    expect(isRetryableExecutionOutcome("CANCELLED")).toBe(false);
  });

  it("rejects every illegal transition", () => {
    expect(canTransitionExecution("QUEUED", "SUCCEEDED")).toBe(false);
    expect(canTransitionExecution("QUEUED", "FAILED")).toBe(false);
    expect(canTransitionExecution("SUCCEEDED", "RUNNING")).toBe(false);
    expect(canTransitionExecution("SUCCEEDED", "FAILED")).toBe(false);
    expect(canTransitionExecution("CANCELLED", "RUNNING")).toBe(false);
    expect(canTransitionExecution("CANCELLED", "QUEUED")).toBe(false);
    expect(canTransitionExecution("AUTH_FAILED", "RUNNING")).toBe(false);
    expect(canTransitionExecution("UNAVAILABLE", "RUNNING")).toBe(false);
    expect(canTransitionExecution("BLOCKED", "RUNNING")).toBe(false);
    expect(canTransitionExecution("BLOCKED", "SUCCEEDED")).toBe(false);
    expect(canTransitionExecution("RUNNING", "QUEUED")).toBe(false);
    expect(canTransitionExecution("FAILED", "SUCCEEDED")).toBe(false);
  });

  it("marks exactly SERVER/NETWORK/RATE_LIMIT error classes retryable", () => {
    expect(isRetryableErrorClass("SERVER")).toBe(true);
    expect(isRetryableErrorClass("NETWORK")).toBe(true);
    expect(isRetryableErrorClass("RATE_LIMIT")).toBe(true);
    expect(isRetryableErrorClass("AUTH")).toBe(false);
    expect(isRetryableErrorClass("REQUEST")).toBe(false);
    expect(isRetryableErrorClass("TIMEOUT")).toBe(false);
    expect(isRetryableErrorClass("UNKNOWN")).toBe(false);
  });

  it("forbids automatic retries for approval-class capabilities", () => {
    expect(capabilityAllowsAutoRetry("PUBLISH")).toBe(false);
    expect(capabilityAllowsAutoRetry("SEND_MESSAGE")).toBe(false);
    expect(capabilityAllowsAutoRetry("CREATE_CAMPAIGN")).toBe(false);
    expect(capabilityAllowsAutoRetry("SPEND_MONEY")).toBe(false);
    expect(capabilityAllowsAutoRetry("UPLOAD")).toBe(false);
    expect(capabilityAllowsAutoRetry("SEARCH")).toBe(true);
    expect(capabilityAllowsAutoRetry("READ_DATA")).toBe(true);
    expect(capabilityAllowsAutoRetry("CREATE_DRAFT")).toBe(true);
    expect(capabilityAllowsAutoRetry(null)).toBe(true);
  });

  it("clamps max attempts to a bounded range", () => {
    expect(clampMaxAttempts(1)).toBe(1);
    expect(clampMaxAttempts(2)).toBe(2);
    expect(clampMaxAttempts(5)).toBe(5);
    expect(clampMaxAttempts(0)).toBe(1);
    expect(clampMaxAttempts(-3)).toBe(1);
    expect(clampMaxAttempts(50)).toBe(5);
    expect(clampMaxAttempts(2.9)).toBe(2);
    expect(clampMaxAttempts(Number.NaN)).toBe(1);
  });

  it("builds stable, deterministic idempotency keys", () => {
    const base = { ownerId: "u1", taskId: "t1", integration: "sambanova", action: "GENERATE_TEXT", mode: "LIVE" as const };
    const key = buildExecutionIdempotencyKey(base);
    expect(key).toBe("u1:t1:sambanova:GENERATE_TEXT:LIVE");
    expect(buildExecutionIdempotencyKey(base)).toBe(key);
    // Mode is part of the key: a dry run never suppresses a real execution.
    expect(buildExecutionIdempotencyKey({ ...base, mode: "DRY_RUN" })).not.toBe(key);
    // Different action/integration → different key.
    expect(buildExecutionIdempotencyKey({ ...base, action: "SEARCH_WEB" })).not.toBe(key);
    expect(buildExecutionIdempotencyKey({ ...base, integration: "brave-search" })).not.toBe(key);
    // Long inputs are capped, deterministically.
    const long = buildExecutionIdempotencyKey({ ...base, ownerId: "o".repeat(500) });
    expect(long.length).toBeLessThanOrEqual(200);
    expect(buildExecutionIdempotencyKey({ ...base, ownerId: "o".repeat(500) })).toBe(long);
  });

  it("labels dry runs SAMPLE_DATA and never rewrites live data classes", () => {
    expect(dryRunDataClass()).toBe("SAMPLE_DATA");
    expect(dryRunDataClass()).not.toBe("REAL_DATA");
    expect(liveDataClass("REAL_DATA")).toBe("REAL_DATA");
    expect(liveDataClass("AI_GENERATED")).toBe("AI_GENERATED");
  });

  it("validates status values for query filters", () => {
    expect(isAgentExecutionStatus("RUNNING")).toBe(true);
    expect(isAgentExecutionStatus("SUCCEEDED")).toBe(true);
    expect(isAgentExecutionStatus("running")).toBe(false);
    expect(isAgentExecutionStatus("whatever")).toBe(false);
    expect(isAgentExecutionStatus(42)).toBe(false);
  });
});
