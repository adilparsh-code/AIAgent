import { describe, expect, it } from "vitest";
import { buildLiveResearchRunId, planLiveResearchCycle } from "./live-research-cycle";
import type { ProviderActivation } from "./provider-activation";

function activation(provider: string, overrides: Partial<ProviderActivation> = {}): ProviderActivation {
  return {
    provider,
    status: "READY_FOR_HEALTH_CHECK",
    capabilities: ["SEARCH"],
    requiredVariables: [],
    optionalVariables: [],
    configured: true,
    healthCheckRequired: true,
    liveTestRequired: true,
    approvalRequired: false,
    safeReason: "Configured — live health check required.",
    lastHealthCheckAt: null,
    ...overrides,
  };
}

describe("Phase 17 live research planning", () => {
  it("plans only configured providers and leaves health verification to the controller", () => {
    const plan = planLiveResearchCycle([
      activation("brave-search"),
      activation("reddit", { configured: false, status: "NOT_CONFIGURED" }),
      activation("google-trends", { status: "HEALTHY", lastHealthCheckAt: "2026-09-24T00:00:00.000Z" }),
    ]);
    expect(plan.activationProviders).toEqual(["brave-search", "google-trends"]);
    expect(plan.skipped.some((item) => item.provider === "reddit")).toBe(true);
  });

  it("supports a bounded provider selection", () => {
    const plan = planLiveResearchCycle([
      activation("brave-search"),
      activation("reddit"),
      activation("google-trends"),
    ], ["brave-search"]);
    expect(plan.activationProviders).toEqual(["brave-search"]);
    expect(plan.skipped).toHaveLength(2);
  });

  it("builds a stable run id for duplicate request suppression", () => {
    const first = buildLiveResearchRunId("owner", "opportunity", "request");
    expect(buildLiveResearchRunId("owner", "opportunity", "request")).toBe(first);
    expect(buildLiveResearchRunId("owner", "opportunity", "other")).not.toBe(first);
  });
});
