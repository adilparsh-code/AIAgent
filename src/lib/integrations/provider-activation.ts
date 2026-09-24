/**
 * Phase 15 — deterministic provider activation state.
 *
 * Configuration presence and provider health are intentionally separate:
 * an environment variable can only move a provider to READY_FOR_HEALTH_CHECK.
 * HEALTHY requires a persisted real health-check result. This module is pure;
 * it never reads process.env, calls a provider, persists data, or returns a
 * secret value.
 */

import { capabilityRequiresApproval, type IntegrationCapability } from "./contract";
import { sanitizeOperationalMessage } from "../operational-events";

export const PROVIDER_ACTIVATION_STATUSES = [
  "NOT_CONFIGURED",
  "CONFIGURED",
  "READY_FOR_HEALTH_CHECK",
  "HEALTHY",
  "DEGRADED",
  "AUTH_FAILED",
  "CREDIT_LIMITED",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "DISABLED",
] as const;

export type ProviderActivationStatus = (typeof PROVIDER_ACTIVATION_STATUSES)[number];

export interface ProviderActivationInput {
  provider: string;
  requiredEnvVars: readonly string[];
  optionalEnvVars?: readonly string[];
  capabilities: readonly IntegrationCapability[];
  configured: boolean;
  healthStatus?: string | null;
  healthCheckedAt?: string | null;
  healthError?: string | null;
  healthLatencyMs?: number | null;
  healthDataClass?: string | null;
  isScaffold?: boolean;
}

export interface ProviderActivation {
  provider: string;
  status: ProviderActivationStatus;
  capabilities: IntegrationCapability[];
  requiredVariables: string[];
  optionalVariables: string[];
  configured: boolean;
  healthCheckRequired: boolean;
  liveTestRequired: boolean;
  approvalRequired: boolean;
  safeReason: string;
  lastHealthCheckAt: string | null;
  lastHealthLatencyMs?: number | null;
  lastHealthDataClass?: string;
}

function isCreditFailure(value: string | null | undefined): boolean {
  return Boolean(value && /(?:credit|billing|subscription|payment required|http 402|\b402\b)/i.test(value));
}

function isRateLimitFailure(value: string | null | undefined): boolean {
  return Boolean(value && /(?:rate.?limit|too many requests|http 429|\b429\b)/i.test(value));
}

function activationStatus(input: ProviderActivationInput): ProviderActivationStatus {
  if (input.isScaffold) return "DISABLED";
  if (!input.configured) return "NOT_CONFIGURED";

  const healthStatus = input.healthStatus?.toUpperCase();
  if (healthStatus === "DISABLED") return "DISABLED";
  if (healthStatus === "HEALTHY" && input.healthCheckedAt) return "HEALTHY";
  if (healthStatus === "AUTH_FAILED") return "AUTH_FAILED";
  if (healthStatus === "DEGRADED") {
    return isRateLimitFailure(input.healthError) ? "RATE_LIMITED" : "DEGRADED";
  }
  if (isCreditFailure(input.healthError) || healthStatus === "CREDIT_LIMITED") return "CREDIT_LIMITED";
  if (isRateLimitFailure(input.healthError) || healthStatus === "RATE_LIMITED") return "RATE_LIMITED";
  if (healthStatus === "UNAVAILABLE" || healthStatus === "FAILED") return "UNAVAILABLE";
  if (healthStatus === "HEALTHY") return "READY_FOR_HEALTH_CHECK";
  return "READY_FOR_HEALTH_CHECK";
}

function safeReason(input: ProviderActivationInput, status: ProviderActivationStatus): string {
  if (input.healthError && status !== "HEALTHY" && status !== "READY_FOR_HEALTH_CHECK") {
    return sanitizeOperationalMessage(input.healthError);
  }
  switch (status) {
    case "NOT_CONFIGURED":
      return "Credential not configured; no provider call was made.";
    case "CONFIGURED":
    case "READY_FOR_HEALTH_CHECK":
      return "Configured — live health check required.";
    case "HEALTHY":
      return "A real provider health check succeeded.";
    case "DEGRADED":
      return "The provider health check succeeded with degraded results.";
    case "AUTH_FAILED":
      return "The provider rejected the configured credentials; execution is unavailable.";
    case "CREDIT_LIMITED":
      return "Provider credit/billing issue; execution is unavailable until resolved.";
    case "RATE_LIMITED":
      return "Provider rate limit observed; back off before any retry.";
    case "UNAVAILABLE":
      return "Provider is configured but unavailable; no execution should be attempted.";
    case "DISABLED":
      return input.isScaffold
        ? "Integration is a scaffold; no real provider adapter is implemented."
        : "Provider is disabled by configuration.";
  }
}

export function deriveProviderActivation(input: ProviderActivationInput): ProviderActivation {
  const status = activationStatus(input);
  const capabilities = [...new Set(input.capabilities)].sort();
  const requiredVariables = [...new Set(input.requiredEnvVars)].sort();
  const optionalVariables = [...new Set(input.optionalEnvVars ?? [])].sort();
  return {
    provider: input.provider,
    status,
    capabilities,
    requiredVariables,
    optionalVariables,
    configured: input.configured,
    healthCheckRequired: status !== "HEALTHY" && status !== "DISABLED",
    liveTestRequired: status === "HEALTHY",
    approvalRequired: capabilities.some(capabilityRequiresApproval),
    safeReason: safeReason(input, status),
    lastHealthCheckAt: input.healthCheckedAt ?? null,
    lastHealthLatencyMs: Number.isFinite(input.healthLatencyMs) && Number(input.healthLatencyMs) >= 0
      ? Math.round(Number(input.healthLatencyMs))
      : null,
    lastHealthDataClass: input.healthDataClass ?? "UNKNOWN",
  };
}

export function deriveProviderActivations(inputs: readonly ProviderActivationInput[]): ProviderActivation[] {
  return inputs
    .map(deriveProviderActivation)
    .sort((a, b) => a.provider.localeCompare(b.provider));
}
