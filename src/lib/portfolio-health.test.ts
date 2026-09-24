import { describe, expect, it } from "vitest";
import { calculatePortfolioHealth } from "@/lib/portfolio-health";
import type { ProviderActivation } from "@/lib/integrations/provider-activation";
import type { SystemHealth } from "@/lib/system-health";
import type { OperationalStatus } from "@/lib/server/system-health-service";

const now = new Date("2026-09-24T18:00:00.000Z");
const providers: ProviderActivation[] = [
  { provider: "brave-search", status: "HEALTHY", capabilities: ["SEARCH"], configured: true, healthCheckRequired: false, liveTestRequired: true, approvalRequired: false, safeReason: "A real health check succeeded.", lastHealthCheckAt: now.toISOString(), requiredVariables: [], optionalVariables: [] },
  { provider: "reddit", status: "UNAVAILABLE", capabilities: ["SEARCH"], configured: true, healthCheckRequired: true, liveTestRequired: false, approvalRequired: false, safeReason: "Provider unavailable; no execution should be attempted.", lastHealthCheckAt: null, requiredVariables: [], optionalVariables: [] },
];
const status = { activeResearchRuns: 0, failedResearchRuns: 0, blockedOpportunities: 0, validationGaps: 0, experimentsRequiringRealData: 0, pendingHandoffs: 0, waitingApprovals: 0, failedExecutions: 0, retryableFailures: 0, humanReviewItems: 0, bounds: {} as never, generatedAt: now.toISOString() } as OperationalStatus;
const system = { status: "HEALTHY", checks: [], criticalFailures: [], warnings: [], degradedComponents: [], healthyComponents: [], providerStates: [], generatedAt: now.toISOString() } as SystemHealth;

function health(systemStatus = system, cycle = null) {
  return calculatePortfolioHealth({ systemHealth: systemStatus, operationalStatus: status, providers, cycle, now });
}

describe("Phase 20 portfolio health", () => {
  it("identifies provider failures instead of hiding them", () => {
    const result = health();
    expect(result.status).toBe("BLOCKED");
    expect(result.blockingComponent).toBe("INTEGRATION_REGISTRY");
    expect(result.blockers.some((item) => item.includes("reddit"))).toBe(true);
  });

  it("reports unknown when no cycle is available", () => {
    const noProviders = calculatePortfolioHealth({ systemHealth: { ...system, status: "UNKNOWN" }, operationalStatus: status, providers: [], cycle: null, now });
    expect(noProviders.status).toBe("UNKNOWN");
    expect(noProviders.lastCycle).toBeNull();
  });

  it("does not claim business success from a healthy system", () => {
    const result = calculatePortfolioHealth({ systemHealth: system, operationalStatus: status, providers: [], cycle: null, now });
    expect(result.status).toBe("UNKNOWN");
    expect(result.dataClass).toBe("REAL_DATA");
    expect(result.nextRecommendedAction).toContain("Observe");
  });
});
