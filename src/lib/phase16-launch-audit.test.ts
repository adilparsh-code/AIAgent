import { describe, expect, it, vi } from "vitest";
import { classifyFailure, type FailureCategory } from "@/lib/failure-classification";
import { recommendRecoveryAction } from "@/lib/recovery-policy";
import { calculateLaunchReadiness, LAUNCH_GATE_IDS, makeLaunchGate } from "@/lib/launch-readiness";
import { deriveProviderActivation } from "@/lib/integrations/provider-activation";
import { buildSafeLiveTestPlan } from "@/lib/integrations/live-test-plan";
import { requireOwnership, ForbiddenError, type AuthenticatedUser } from "@/lib/server/authz";

const NOW = new Date("2026-09-24T15:00:00.000Z");

function passAllInternalGates() {
  return LAUNCH_GATE_IDS.map((id) => makeLaunchGate({
    id,
    status: id === "GATE_14_PROVIDER_ACTIVATION" || id === "GATE_15_LIVE_TEST" ? "PENDING" : "PASS",
  }));
}

describe("Phase 16 launch audit", () => {
  it("keeps all internal gates passing while provider and live gates remain pending", () => {
    const result = calculateLaunchReadiness({ gates: passAllInternalGates(), now: NOW });
    expect(result.readyComponents).toHaveLength(13);
    expect(result.gates.filter((gate) => gate.id === "GATE_14_PROVIDER_ACTIVATION" || gate.id === "GATE_15_LIVE_TEST").every((gate) => gate.status === "PENDING")).toBe(true);
  });

  it("does not make a configured provider healthy before a real test", () => {
    const result = deriveProviderActivation({ provider: "brave-search", requiredEnvVars: ["BRAVE_SEARCH_API_KEY"], capabilities: ["SEARCH"], configured: true, healthStatus: "CONFIGURED" });
    expect(result.status).toBe("READY_FOR_HEALTH_CHECK");
    expect(result.status).not.toBe("HEALTHY");
  });

  it("blocks a provider health failure without a fake healthy state", () => {
    const result = deriveProviderActivation({ provider: "sambanova", requiredEnvVars: ["SAMBANOVA_API_KEY"], capabilities: ["READ_DATA"], configured: true, healthStatus: "FAILED", healthCheckedAt: NOW.toISOString(), healthError: "HTTP 402 billing required" });
    expect(result.status).toBe("CREDIT_LIMITED");
    expect(result.safeReason).toContain("billing");
  });

  it("preserves owner isolation through the existing authorization boundary", () => {
    const owner: AuthenticatedUser = { id: "owner-a", email: "a@example.test", name: "A", role: "USER", status: "ACTIVE" };
    const other: AuthenticatedUser = { ...owner, id: "owner-b" };
    expect(requireOwnership({ ownerId: "owner-a" }, owner).ownerId).toBe("owner-a");
    expect(() => requireOwnership({ ownerId: "owner-a" }, other)).toThrow(ForbiddenError);
  });

  it("does not call external services while calculating readiness or planning", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const readiness = calculateLaunchReadiness({ gates: passAllInternalGates(), now: NOW });
    const plan = buildSafeLiveTestPlan(deriveProviderActivation({ provider: "brave-search", requiredEnvVars: ["BRAVE_SEARCH_API_KEY"], capabilities: ["SEARCH"], configured: true, healthStatus: "HEALTHY", healthCheckedAt: NOW.toISOString() }));
    expect(readiness.status).toBe("CONDITIONALLY_READY");
    expect(plan.externalActionsPerformed).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("does not permit automatic write-side execution", () => {
    const plan = buildSafeLiveTestPlan(deriveProviderActivation({ provider: "sambanova", requiredEnvVars: ["SAMBANOVA_API_KEY"], capabilities: ["CREATE_DRAFT"], configured: true, healthStatus: "HEALTHY", healthCheckedAt: NOW.toISOString() }), "PUBLISH");
    expect(plan.status).toBe("LIVE_WRITE_TEST_REQUIRES_APPROVAL");
    expect(plan.approvalRequired).toBe(true);
  });

  it.each([
    ["provider unavailable", "PROVIDER_UNAVAILABLE"],
    ["authentication failed", "AUTHENTICATION"],
    ["credit billing required", "CREDIT_LIMITED"],
    ["rate limit 429", "RATE_LIMITED"],
    ["request timed out", "TIMEOUT"],
    ["malformed response", "VALIDATION"],
    ["empty response", "VALIDATION"],
    ["database failure", "PROVIDER_UNAVAILABLE"],
    ["validation conflict", "DATA_INTEGRITY"],
    ["experiment conflict", "DUPLICATE"],
    ["execution failed", "UNKNOWN"],
    ["duplicate execution", "DUPLICATE"],
    ["approval missing", "AUTHORIZATION"],
  ] as Array<[string, FailureCategory]>)("classifies %s into a safe recovery path", (message, expected) => {
    const classification = classifyFailure(new Error(message));
    expect(classification.category).toBe(expected);
    expect(classification.safeUserMessage).not.toMatch(/secret|token|password|authorization header/i);
    expect(recommendRecoveryAction(classification)).toBeTruthy();
  });
});
