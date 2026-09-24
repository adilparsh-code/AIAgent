import { describe, expect, it } from "vitest";
import { activateProvider, runLiveProviderTest, type LiveActivationDependencies } from "./live-activation-controller";
import type { ProviderActivation } from "./provider-activation";

function activation(overrides: Partial<ProviderActivation> = {}): ProviderActivation {
  return {
    provider: "brave-search",
    status: "READY_FOR_HEALTH_CHECK",
    capabilities: ["SEARCH", "READ_DATA"],
    requiredVariables: ["BRAVE_SEARCH_API_KEY"],
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

function deps(overrides: Partial<LiveActivationDependencies> = {}): LiveActivationDependencies {
  return {
    getActivation: async () => activation(),
    checkHealth: async () => ({ status: "HEALTHY", checkedAt: "2026-09-24T00:00:00.000Z" }),
    executeLiveTest: async () => ({
      status: "SUCCEEDED",
      executionId: "exec-1",
      action: "SEARCH_WEB",
      capability: "SEARCH",
      durationMs: 12,
      dataClass: "REAL_DATA",
      output: { results: [{ title: "A real result" }] },
      resultCount: 1,
    }),
    emit: () => undefined,
    now: () => new Date("2026-09-24T00:00:00.000Z"),
    ...overrides,
  };
}

describe("Phase 17 live activation controller", () => {
  it("does not call a provider when configuration is absent", async () => {
    let checks = 0;
    const result = await activateProvider(deps({
      getActivation: async () => activation({ configured: false, status: "NOT_CONFIGURED", safeReason: "Credential not configured." }),
      checkHealth: async () => { checks += 1; return { status: "HEALTHY", checkedAt: new Date().toISOString() }; },
    }), { provider: "brave-search", ownerId: "owner-1" });
    expect(result.state).toBe("NOT_CONFIGURED");
    expect(checks).toBe(0);
    expect(result.events[0]?.event).toBe("PROVIDER_HEALTH_CHECK_SKIPPED");
  });

  it("only reaches HEALTHY after a real health check", async () => {
    const result = await activateProvider(deps(), { provider: "brave-search", ownerId: "owner-1" });
    expect(result.state).toBe("HEALTHY");
    expect(result.events.map((event) => event.event)).toEqual([
      "PROVIDER_HEALTH_CHECK_STARTED",
      "PROVIDER_HEALTH_CHECK_SUCCEEDED",
    ]);
  });

  it.each([
    ["AUTH_FAILED", "AUTHENTICATION", "AUTH_FAILED"],
    ["CREDIT", "CREDIT_LIMITED", "CREDIT_LIMITED"],
    ["RATE", "RATE_LIMITED", "RATE_LIMITED"],
  ])("classifies %s health failures", async (status, error, expected) => {
    const result = await activateProvider(deps({
      checkHealth: async () => ({ status: "FAILED", checkedAt: new Date().toISOString(), error }),
    }), { provider: "brave-search", ownerId: "owner-1" });
    expect(result.state).toBe(expected);
    expect(result.safeMessage).not.toContain("api_key");
  });

  it("blocks an approval-class write test explicitly", async () => {
    let executions = 0;
    const result = await runLiveProviderTest(deps({
      getActivation: async () => activation({ status: "HEALTHY", lastHealthCheckAt: "2026-09-24T00:00:00.000Z", capabilities: ["PUBLISH", "SEARCH"], approvalRequired: true }),
      executeLiveTest: async () => { executions += 1; throw new Error("must not execute"); },
    }), { provider: "brave-search", ownerId: "owner-1", requestId: "request-1", action: "PUBLISH" });
    expect(result.safeMessage).toBe("LIVE_WRITE_TEST_REQUIRES_APPROVAL");
    expect(result.state).toBe("BLOCKED");
    expect(executions).toBe(0);
  });

  it("runs one safe test and returns a sanitized normalized result", async () => {
    const result = await runLiveProviderTest(deps({
      getActivation: async () => activation({ status: "HEALTHY", lastHealthCheckAt: "2026-09-24T00:00:00.000Z" }),
    }), { provider: "brave-search", ownerId: "owner-1", requestId: "request-1" });
    expect(result.state).toBe("LIVE_TEST_SUCCEEDED");
    expect(result.normalized?.dataClass).toBe("REAL_DATA");
    expect(result.normalized?.resultCount).toBe(1);
    expect(result.events.at(-1)?.event).toBe("PROVIDER_LIVE_TEST_SUCCEEDED");
  });
});
