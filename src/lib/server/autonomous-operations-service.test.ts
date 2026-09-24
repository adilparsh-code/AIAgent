import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPortfolioOperatingCycle: vi.fn(),
  getSystemHealth: vi.fn(),
  getOperationalStatus: vi.fn(),
  getProviderActivations: vi.fn(),
  listExecutionsForOwner: vi.fn(),
}));

vi.mock("@/lib/server/autonomous-operating-loop-service", () => ({ getPortfolioOperatingCycle: mocks.getPortfolioOperatingCycle }));
vi.mock("@/lib/server/system-health-service", () => ({ getSystemHealth: mocks.getSystemHealth, getOperationalStatus: mocks.getOperationalStatus }));
vi.mock("@/lib/integrations/activation-service", () => ({ getProviderActivations: mocks.getProviderActivations }));
vi.mock("@/lib/server/execution-repository", () => ({ listExecutionsForOwner: mocks.listExecutionsForOwner }));

import { getAutonomousOperationsCycle } from "@/lib/server/autonomous-operations-service";

const now = new Date("2026-09-24T18:00:00.000Z");
const item = { opportunityId: "opp-1", queue: "RESEARCH_QUEUE", stage: "RESEARCH", selected: true, requiredApproval: false, blocked: false, reasons: ["Research gap."], priorityScore: 1, recommendationReason: "Research gap.", dataClass: "UNKNOWN" };

describe("Phase 20 autonomous operations service", () => {
  it("composes only the requested owner and does not execute provider actions", async () => {
    mocks.getPortfolioOperatingCycle.mockResolvedValue({
      loop: { cycleId: "loop-1", generatedAt: now.toISOString(), selectedOpportunityId: "opp-1", nextAction: "Research more.", blockers: [], cycleStage: "RESEARCH", explanation: [] },
      controller: { cycleId: "portfolio-1", items: [item], selectedOpportunityIds: ["opp-1"], limits: {}, observed: {} },
      portfolio: { totalOpportunities: 1, experimentCoverageSummary: { withSufficientRealData: 0 } },
    });
    mocks.getSystemHealth.mockResolvedValue({ status: "HEALTHY", checks: [], criticalFailures: [], warnings: [], degradedComponents: [], healthyComponents: [], providerStates: [], generatedAt: now.toISOString() });
    mocks.getOperationalStatus.mockResolvedValue({ activeResearchRuns: 0, failedResearchRuns: 0, blockedOpportunities: 0, validationGaps: 0, experimentsRequiringRealData: 0, pendingHandoffs: 0, waitingApprovals: 0, failedExecutions: 0, humanReviewItems: 0, retryableFailures: 0 });
    mocks.getProviderActivations.mockResolvedValue([]);
    mocks.listExecutionsForOwner.mockResolvedValue([]);

    const result = await getAutonomousOperationsCycle("owner-a", now);
    expect(mocks.getPortfolioOperatingCycle).toHaveBeenCalledWith("owner-a", now);
    expect(mocks.getSystemHealth).toHaveBeenCalledWith("owner-a", now);
    expect(mocks.listExecutionsForOwner).toHaveBeenCalledWith("owner-a", 100);
    expect(result.ownerId).toBe("owner-a");
    expect(result.actionsExecuted).toHaveLength(0);
    expect(result.actionsSkipped.every((action) => action.state === "BLOCKED" || action.state === "SKIPPED")).toBe(true);
  });
});
