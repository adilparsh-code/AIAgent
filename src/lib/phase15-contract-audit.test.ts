import { describe, expect, it, vi } from "vitest";
import { classifyFailure } from "@/lib/failure-classification";
import { classifyHttpError, isRetryableError } from "@/lib/integrations/contract";
import { isRetryableErrorClass } from "@/lib/execution-contract";
import { calculateSystemHealth, makeHealthCheck } from "@/lib/system-health";
import { deriveProviderActivation } from "@/lib/integrations/provider-activation";
import { buildSafeLiveTestPlan } from "@/lib/integrations/live-test-plan";

describe("Phase 15 contract audit", () => {
  it("classifies billing/credit failures as non-retryable", () => {
    expect(classifyHttpError(402)).toBe("CREDIT");
    expect(isRetryableError("CREDIT")).toBe(false);
    expect(isRetryableErrorClass("CREDIT")).toBe(false);
    const classification = classifyFailure(new Error("HTTP 402: billing required"));
    expect(classification.category).toBe("CREDIT_LIMITED");
    expect(classification.retryable).toBe(false);
    expect(classification.operationalAction).toBe("HUMAN_REVIEW");
  });

  it("does not make configured-but-unchecked provider health healthy", () => {
    const activation = deriveProviderActivation({
      provider: "reddit",
      requiredEnvVars: [],
      capabilities: ["SEARCH", "READ_DATA"],
      configured: true,
      healthStatus: "CONFIGURED",
    });
    const health = calculateSystemHealth({
      checks: [makeHealthCheck({ component: "INTEGRATION_REGISTRY", status: "UNKNOWN", message: activation.safeReason })],
      providerStates: [{ provider: activation.provider, status: activation.status, configured: activation.configured, healthCheckRequired: activation.healthCheckRequired, safeReason: activation.safeReason }],
    });
    expect(activation.status).toBe("READY_FOR_HEALTH_CHECK");
    expect(health.providerStates[0].status).toBe("READY_FOR_HEALTH_CHECK");
    expect(health.healthyComponents).toEqual([]);
  });

  it("does not execute or fetch while generating a plan", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const activation = deriveProviderActivation({ provider: "brave-search", requiredEnvVars: ["BRAVE_SEARCH_API_KEY"], capabilities: ["SEARCH"], configured: true, healthStatus: "HEALTHY", healthCheckedAt: "2026-09-24T00:00:00.000Z" });
    const plan = buildSafeLiveTestPlan(activation);
    expect(plan.externalActionsPerformed).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
