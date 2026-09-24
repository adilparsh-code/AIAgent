import { describe, expect, it } from "vitest";
import { deriveProviderActivation, deriveProviderActivations } from "./provider-activation";

const base = {
  provider: "brave-search",
  requiredEnvVars: ["BRAVE_SEARCH_API_KEY"],
  optionalEnvVars: ["RESEARCH_PROVIDER_ENV"],
  capabilities: ["SEARCH", "READ_DATA"] as const,
  configured: true,
};

describe("provider activation", () => {
  it("does not call configured state healthy without a persisted health check", () => {
    const result = deriveProviderActivation({ ...base, healthStatus: "CONFIGURED" });
    expect(result.status).toBe("READY_FOR_HEALTH_CHECK");
    expect(result.healthCheckRequired).toBe(true);
    expect(result.liveTestRequired).toBe(false);
  });

  it("keeps missing credentials not configured", () => {
    const result = deriveProviderActivation({ ...base, configured: false, healthStatus: "HEALTHY" });
    expect(result.status).toBe("NOT_CONFIGURED");
    expect(result.safeReason).toContain("not configured");
  });

  it("requires a health timestamp before healthy", () => {
    expect(deriveProviderActivation({ ...base, healthStatus: "HEALTHY" }).status).toBe("READY_FOR_HEALTH_CHECK");
    expect(deriveProviderActivation({ ...base, healthStatus: "HEALTHY", healthCheckedAt: "2026-09-24T00:00:00.000Z" }).status).toBe("HEALTHY");
  });

  it.each([
    ["AUTH_FAILED", "AUTH_FAILED"],
    ["DEGRADED", "DEGRADED"],
    ["UNAVAILABLE", "UNAVAILABLE"],
  ] as const)("maps a real health result to %s", (healthStatus, expected) => {
    expect(deriveProviderActivation({ ...base, healthStatus, healthCheckedAt: "2026-09-24T00:00:00.000Z" }).status).toBe(expected);
  });

  it("classifies billing and rate failures without retrying or fabricating health", () => {
    const credit = deriveProviderActivation({ ...base, healthStatus: "FAILED", healthError: "HTTP 402: billing required", healthCheckedAt: "2026-09-24T00:00:00.000Z" });
    const rate = deriveProviderActivation({ ...base, healthStatus: "DEGRADED", healthError: "HTTP 429: rate limited", healthCheckedAt: "2026-09-24T00:00:00.000Z" });
    expect(credit.status).toBe("CREDIT_LIMITED");
    expect(rate.status).toBe("RATE_LIMITED");
    expect(credit.safeReason).not.toContain("sk-");
  });

  it("marks scaffolds disabled", () => {
    expect(deriveProviderActivation({ ...base, provider: "pinterest", isScaffold: true, healthStatus: "CONFIGURED" }).status).toBe("DISABLED");
  });

  it("sorts results deterministically and redacts health errors", () => {
    const results = deriveProviderActivations([
      { ...base, provider: "z-provider" },
      { ...base, provider: "a-provider", healthError: "Authorization: Bearer secret-token-value" },
    ]);
    expect(results.map((item) => item.provider)).toEqual(["a-provider", "z-provider"]);
    expect(results[0].safeReason).not.toContain("secret-token-value");
  });
});
