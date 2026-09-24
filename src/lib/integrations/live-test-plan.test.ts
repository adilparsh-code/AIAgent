import { describe, expect, it } from "vitest";
import { deriveProviderActivation } from "./provider-activation";
import { buildSafeLiveTestPlan, LIVE_TEST_PLAN_STEPS } from "./live-test-plan";

const activation = (status: Parameters<typeof deriveProviderActivation>[0]["healthStatus"], configured = true) => deriveProviderActivation({
  provider: "brave-search",
  requiredEnvVars: ["BRAVE_SEARCH_API_KEY"],
  capabilities: ["SEARCH", "READ_DATA"],
  configured,
  healthStatus: status,
  healthCheckedAt: status === "HEALTHY" ? "2026-09-24T00:00:00.000Z" : null,
});

describe("safe live test plan", () => {
  it("blocks configuration before any provider action", () => {
    const plan = buildSafeLiveTestPlan(activation("CONFIGURED", false));
    expect(plan.status).toBe("BLOCKED_CONFIGURATION");
    expect(plan.steps.map((step) => step.action)).toContain("VERIFY_SECRET_NOT_EXPOSED");
    expect(plan.steps.map((step) => step.action)).not.toContain("RUN_MINIMAL_SAFE_READ_OR_SEARCH_TEST");
    expect(plan.externalActionsPerformed).toBe(false);
  });

  it("requires a real health check before a safe test", () => {
    const plan = buildSafeLiveTestPlan(activation("CONFIGURED"));
    expect(plan.status).toBe("HEALTH_CHECK_REQUIRED");
    expect(plan.steps.map((step) => step.action)).toContain("RUN_REAL_HEALTH_CHECK");
    expect(plan.steps.map((step) => step.action)).not.toContain("RUN_MINIMAL_SAFE_READ_OR_SEARCH_TEST");
  });

  it("returns the full safe sequence for a healthy read/search provider", () => {
    const plan = buildSafeLiveTestPlan(activation("HEALTHY"));
    expect(plan.status).toBe("READY_FOR_LIVE_VERIFICATION");
    expect(plan.steps.map((step) => step.action)).toEqual([...LIVE_TEST_PLAN_STEPS]);
    expect(plan.steps.every((step) => step.automaticExecutionAllowed === false)).toBe(true);
  });

  it("stops write-side capabilities at approval", () => {
    const plan = buildSafeLiveTestPlan(activation("HEALTHY"), "PUBLISH");
    expect(plan.status).toBe("LIVE_WRITE_TEST_REQUIRES_APPROVAL");
    expect(plan.approvalRequired).toBe(true);
    expect(plan.steps.map((step) => step.action)).toEqual(["CONFIGURE_PROVIDER_SECRET_SERVER_SIDE", "VERIFY_SECRET_NOT_EXPOSED", "RUN_REAL_HEALTH_CHECK", "PERSIST_INTEGRATION_HEALTH", "CHECK_CAPABILITY_PERMISSION"]);
    expect(plan.externalActionsPerformed).toBe(false);
  });
});
