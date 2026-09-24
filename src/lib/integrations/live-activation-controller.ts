/**
 * Phase 17 — controlled live-provider activation controller.
 *
 * This controller is deterministic around safety gates and dependency-injected
 * so it can be exhaustively tested without network or database access. The
 * server adapter wires it to the existing IntegrationRegistry,
 * IntegrationHealth persistence, AgentTask execution orchestrator, and
 * IntegrationExecution audit path. It does not introduce a second execution
 * system.
 */

import { capabilityRequiresApproval, type IntegrationCapability } from "./contract";
import { classifyFailure, determineRecoveryPolicy, type RecoveryAction } from "../failure-classification";
import { createOperationalEvent, type OperationalEvent } from "../operational-events";
import { deriveProviderActivation, type ProviderActivation } from "./provider-activation";
import { resolveTestAction, sanitizeRequestId, type TestActionDescriptor } from "./test-execution";
import { normalizeLiveProviderResult, type NormalizedLiveProviderResult } from "./live-provider-normalization";

export const LIVE_ACTIVATION_STATES = [
  "NOT_CONFIGURED",
  "READY_FOR_HEALTH_CHECK",
  "HEALTH_CHECK_REQUIRED",
  "HEALTHY",
  "LIVE_TEST_READY",
  "LIVE_TEST_RUNNING",
  "LIVE_TEST_SUCCEEDED",
  "AUTH_FAILED",
  "CREDIT_LIMITED",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "DEGRADED",
  "BLOCKED",
  "HUMAN_REVIEW",
] as const;

export type LiveActivationState = (typeof LIVE_ACTIVATION_STATES)[number];

export interface LiveActivationResult {
  provider: string;
  state: LiveActivationState;
  activation: ProviderActivation;
  normalized: NormalizedLiveProviderResult | null;
  recoveryAction: RecoveryAction | null;
  safeMessage: string;
  events: OperationalEvent[];
}

export interface ControllerHealthResult {
  status: string;
  checkedAt: string;
  latencyMs?: number | null;
  error?: string | null;
  dataClass?: string | null;
}

export interface ControllerExecutionResult {
  status: string;
  executionId: string | null;
  action: string;
  capability: IntegrationCapability;
  durationMs: number | null;
  error?: string | null;
  dataClass?: string | null;
  output?: unknown;
  resultCount?: number | null;
}

export interface LiveActivationDependencies {
  getActivation(provider: string): Promise<ProviderActivation>;
  checkHealth(provider: string): Promise<ControllerHealthResult>;
  executeLiveTest(input: {
    provider: string;
    ownerId: string;
    requestId: string;
    action: TestActionDescriptor;
  }): Promise<ControllerExecutionResult>;
  emit(event: OperationalEvent): void | Promise<void>;
  now?(): Date;
}

function event(
  deps: LiveActivationDependencies,
  input: {
    provider: string;
    name: string;
    severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
    message: string;
    dataClass?: OperationalEvent["dataClass"];
    executionId?: string | null;
  },
): OperationalEvent {
  return createOperationalEvent({
    category: "INTEGRATION",
    severity: input.severity,
    event: input.name,
    safeMessage: input.message,
    timestamp: deps.now?.() ?? new Date(),
    executionId: input.executionId ?? undefined,
    dataClass: input.dataClass ?? "UNKNOWN",
  });
}

function stateForHealth(activation: ProviderActivation, health: ControllerHealthResult): {
  state: LiveActivationState;
  recoveryAction: RecoveryAction | null;
  message: string;
} {
  const classification = classifyFailure(health.error ?? health.status);
  const recoveryAction = determineRecoveryPolicy(classification);
  if (health.status === "HEALTHY") {
    return { state: "HEALTHY", recoveryAction: null, message: "Real provider health check succeeded; a safe live test is available." };
  }
  if (health.status === "DEGRADED") return { state: "DEGRADED", recoveryAction, message: "Provider health is degraded; do not assume full capability." };
  if (classification.category === "AUTHENTICATION" || health.status === "AUTH_FAILED") {
    return { state: "AUTH_FAILED", recoveryAction, message: "Provider authentication failed; execution is blocked until configuration is corrected." };
  }
  if (classification.category === "CREDIT_LIMITED") {
    return { state: "CREDIT_LIMITED", recoveryAction, message: "Provider credit or billing is unavailable; no retry or spend is allowed." };
  }
  if (classification.category === "RATE_LIMITED") {
    return { state: "RATE_LIMITED", recoveryAction, message: "Provider rate limit observed; wait for the existing backoff boundary." };
  }
  if (classification.category === "CONFIGURATION") {
    return { state: "NOT_CONFIGURED", recoveryAction, message: activation.safeReason };
  }
  return { state: "UNAVAILABLE", recoveryAction, message: "Provider health check failed; no live test was started." };
}

function blockedResult(
  provider: string,
  activation: ProviderActivation,
  state: LiveActivationState,
  message: string,
  events: OperationalEvent[],
): LiveActivationResult {
  return { provider, state, activation, normalized: null, recoveryAction: null, safeMessage: message, events };
}

/** Run a real health check only when configuration is actually present. */
export async function activateProvider(
  deps: LiveActivationDependencies,
  input: { provider: string; ownerId: string },
): Promise<LiveActivationResult> {
  const activation = await deps.getActivation(input.provider);
  const events: OperationalEvent[] = [];
  if (activation.status === "DISABLED") {
    return blockedResult(input.provider, activation, "BLOCKED", "Provider is disabled; no health check was started.", events);
  }
  if (!activation.configured || activation.status === "NOT_CONFIGURED") {
    const emitted = event(deps, {
      provider: input.provider,
      name: "PROVIDER_HEALTH_CHECK_SKIPPED",
      severity: "WARNING",
      message: activation.safeReason,
    });
    events.push(emitted);
    await deps.emit(emitted);
    return blockedResult(input.provider, activation, "NOT_CONFIGURED", activation.safeReason, events);
  }

  const started = event(deps, {
    provider: input.provider,
    name: "PROVIDER_HEALTH_CHECK_STARTED",
    severity: "INFO",
    message: `Starting a real health check for ${input.provider}.`,
  });
  events.push(started);
  await deps.emit(started);

  let health: ControllerHealthResult;
  try {
    health = await deps.checkHealth(input.provider);
  } catch (error) {
    const classification = classifyFailure(error);
    const failed = event(deps, {
      provider: input.provider,
      name: "PROVIDER_HEALTH_CHECK_FAILED",
      severity: "ERROR",
      message: classification.safeUserMessage,
    });
    events.push(failed);
    await deps.emit(failed);
    const refreshed = deriveProviderActivation({
      provider: input.provider,
      requiredEnvVars: activation.requiredVariables,
      optionalEnvVars: activation.optionalVariables,
      capabilities: activation.capabilities,
      configured: true,
      healthStatus: "FAILED",
      healthError: classification.safeUserMessage,
    });
    return {
      provider: input.provider,
      state: classification.category === "AUTHENTICATION" ? "AUTH_FAILED" : "UNAVAILABLE",
      activation: refreshed,
      normalized: null,
      recoveryAction: determineRecoveryPolicy(classification),
      safeMessage: classification.safeUserMessage,
      events,
    };
  }

  const outcome = stateForHealth(activation, health);
  const refreshed = deriveProviderActivation({
    provider: input.provider,
    requiredEnvVars: activation.requiredVariables,
    optionalEnvVars: activation.optionalVariables,
    capabilities: activation.capabilities,
    configured: true,
    healthStatus: health.status,
    healthCheckedAt: health.checkedAt,
    healthError: health.error,
    healthLatencyMs: health.latencyMs ?? null,
    healthDataClass: health.dataClass ?? "UNKNOWN",
  });
  const completed = event(deps, {
    provider: input.provider,
    name: outcome.state === "HEALTHY" ? "PROVIDER_HEALTH_CHECK_SUCCEEDED" : "PROVIDER_HEALTH_CHECK_FAILED",
    severity: outcome.state === "HEALTHY" ? "INFO" : "WARNING",
    message: outcome.message,
    dataClass: "UNKNOWN",
  });
  events.push(completed);
  await deps.emit(completed);
  return {
    provider: input.provider,
    state: outcome.state,
    activation: refreshed,
    normalized: null,
    recoveryAction: outcome.recoveryAction,
    safeMessage: outcome.message,
    events,
  };
}

/** Start one allowlisted, zero-financial-impact live test after real health. */
export async function runLiveProviderTest(
  deps: LiveActivationDependencies,
  input: { provider: string; ownerId: string; requestId: string; action?: string },
): Promise<LiveActivationResult> {
  const requestId = sanitizeRequestId(input.requestId);
  if (!requestId) {
    const activation = await deps.getActivation(input.provider);
    return blockedResult(input.provider, activation, "BLOCKED", "A valid requestId is required for safe idempotent activation.", []);
  }

  const activation = await deps.getActivation(input.provider);
  const events: OperationalEvent[] = [];
  if (activation.status !== "HEALTHY") {
    const state: LiveActivationState = activation.status === "NOT_CONFIGURED"
      ? "NOT_CONFIGURED"
      : activation.status === "AUTH_FAILED"
        ? "AUTH_FAILED"
        : activation.status === "CREDIT_LIMITED"
          ? "CREDIT_LIMITED"
          : activation.status === "RATE_LIMITED"
            ? "RATE_LIMITED"
            : "HEALTH_CHECK_REQUIRED";
    const skipped = event(deps, {
      provider: input.provider,
      name: "PROVIDER_LIVE_TEST_BLOCKED",
      severity: "WARNING",
      message: activation.safeReason,
    });
    events.push(skipped);
    await deps.emit(skipped);
    return blockedResult(input.provider, activation, state, activation.safeReason, events);
  }

  const requestedAction = input.action?.trim();
  const dangerous = activation.capabilities.some(capabilityRequiresApproval);
  const descriptor = resolveTestAction(input.provider, requestedAction);
  if (!descriptor) {
    const message = dangerous && requestedAction
      ? "LIVE_WRITE_TEST_REQUIRES_APPROVAL"
      : "No allowlisted safe read/search/draft test is available for this provider.";
    const blocked = event(deps, {
      provider: input.provider,
      name: "PROVIDER_LIVE_TEST_BLOCKED",
      severity: "WARNING",
      message,
    });
    events.push(blocked);
    await deps.emit(blocked);
    return blockedResult(input.provider, activation, "BLOCKED", message, events);
  }

  const started = event(deps, {
    provider: input.provider,
    name: "PROVIDER_LIVE_TEST_STARTED",
    severity: "INFO",
    message: `Starting one allowlisted ${descriptor.capability} test for ${input.provider}.`,
  });
  events.push(started);
  await deps.emit(started);

  let execution: ControllerExecutionResult;
  try {
    execution = await deps.executeLiveTest({
      provider: input.provider,
      ownerId: input.ownerId,
      requestId,
      action: descriptor,
    });
  } catch (error) {
    const classification = classifyFailure(error);
    const failed = event(deps, {
      provider: input.provider,
      name: "PROVIDER_LIVE_TEST_FAILED",
      severity: "ERROR",
      message: classification.safeUserMessage,
    });
    events.push(failed);
    await deps.emit(failed);
    return {
      provider: input.provider,
      state: classification.category === "AUTHENTICATION" ? "AUTH_FAILED" : classification.category === "CREDIT_LIMITED" ? "CREDIT_LIMITED" : classification.category === "RATE_LIMITED" ? "RATE_LIMITED" : "UNAVAILABLE",
      activation,
      normalized: null,
      recoveryAction: determineRecoveryPolicy(classification),
      safeMessage: classification.safeUserMessage,
      events,
    };
  }

  const normalized = normalizeLiveProviderResult({
    provider: input.provider,
    operation: descriptor.action,
    requestId,
    executionId: execution.executionId,
    status: execution.status,
    latencyMs: execution.durationMs,
    error: execution.error,
    dataClass: execution.dataClass,
    output: execution.output,
    resultCount: execution.resultCount,
  });
  const completed = event(deps, {
    provider: input.provider,
    name: normalized.success ? "PROVIDER_LIVE_TEST_SUCCEEDED" : "PROVIDER_LIVE_TEST_FAILED",
    severity: normalized.success ? "INFO" : "WARNING",
    message: normalized.success
      ? `Safe ${descriptor.capability} live test completed for ${input.provider}.`
      : normalized.sanitizedError ?? "Safe live test failed.",
    dataClass: normalized.dataClass,
    executionId: execution.executionId,
  });
  events.push(completed);
  await deps.emit(completed);

  const classification = normalized.success ? null : classifyFailure(normalized.sanitizedError);
  return {
    provider: input.provider,
    state: normalized.success ? "LIVE_TEST_SUCCEEDED" : normalized.status === "AUTH_FAILED" ? "AUTH_FAILED" : normalized.status === "CREDIT_LIMITED" ? "CREDIT_LIMITED" : normalized.status === "RATE_LIMITED" ? "RATE_LIMITED" : normalized.status === "TIMEOUT" ? "UNAVAILABLE" : "DEGRADED",
    activation,
    normalized,
    recoveryAction: classification ? determineRecoveryPolicy(classification) : null,
    safeMessage: normalized.success ? "Safe live test completed; inspect the bounded normalized result." : normalized.sanitizedError ?? "Safe live test failed.",
    events,
  };
}
