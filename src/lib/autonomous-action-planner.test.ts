import { describe, expect, it } from "vitest";
import { planAutonomousActions } from "@/lib/autonomous-action-planner";
import type { PortfolioOperatingItem } from "@/lib/portfolio-operating-controller";
import type { ProviderActivation } from "@/lib/integrations/provider-activation";

const now = new Date("2026-09-24T18:00:00.000Z");
const base: PortfolioOperatingItem = { opportunityId: "opp-1", queue: "RESEARCH_QUEUE", stage: "RESEARCH", selected: true, requiredApproval: false, blocked: false, reasons: ["Research gap."], priorityScore: 10, recommendationReason: "Research gap.", dataClass: "AI_ESTIMATE" };
const healthy: ProviderActivation = { provider: "brave-search", status: "HEALTHY", capabilities: ["SEARCH"], configured: true, healthCheckRequired: false, liveTestRequired: true, approvalRequired: false, safeReason: "healthy", lastHealthCheckAt: now.toISOString(), requiredVariables: [], optionalVariables: [] };
const unavailable: ProviderActivation = { ...healthy, provider: "reddit", status: "UNAVAILABLE", safeReason: "unavailable" };

describe("Phase 20 action planner", () => {
  it("maps existing queues to explainable actions without new scoring", () => {
    const result = planAutonomousActions({ ownerId: "owner-1", items: [base], providers: [healthy], systemHealth: "HEALTHY", now });
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ actionType: "RESEARCH_MORE", provider: "brave-search", riskSafetyStatus: "SAFE" });
    expect(result.actions[0]?.reason).toBe("Research gap.");
  });

  it("marks provider-dependent actions blocked when the provider is unavailable", () => {
    const result = planAutonomousActions({ ownerId: "owner-1", items: [base], providers: [unavailable], systemHealth: "HEALTHY", now });
    expect(result.actions[0]?.riskSafetyStatus).toBe("BLOCKED");
    expect(result.actions[0]?.provider).toBeNull();
  });

  it("preserves approval-required states for human-controlled work", () => {
    const result = planAutonomousActions({ ownerId: "owner-1", items: [{ ...base, queue: "HANDOFF_QUEUE", stage: "HANDOFF", requiredApproval: true }], providers: [], systemHealth: "HEALTHY", now });
    expect(result.actions[0]?.actionType).toBe("WAIT_FOR_APPROVAL");
    expect(result.actions[0]?.approvalRequirement).toBe("REQUIRED");
  });

  it("caps actions and defers opportunities outside the selected bounded cycle", () => {
    const items = Array.from({ length: 12 }, (_, index) => ({ ...base, opportunityId: `opp-${index}`, selected: index < 10 }));
    const result = planAutonomousActions({ ownerId: "owner-1", items, providers: [healthy], systemHealth: "HEALTHY", now });
    expect(result.actions).toHaveLength(10);
    expect(result.deferredOpportunityIds).toEqual(["opp-10", "opp-11"]);
  });
});
