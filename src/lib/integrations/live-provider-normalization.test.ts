import { describe, expect, it } from "vitest";
import { normalizeLiveProviderResult } from "./live-provider-normalization";

describe("Phase 17 live provider normalization", () => {
  it("normalizes a successful persisted read as REAL_DATA", () => {
    const result = normalizeLiveProviderResult({
      provider: "brave-search",
      operation: "SEARCH_WEB",
      requestId: "req-1",
      executionId: "exec-1",
      status: "SUCCEEDED",
      dataClass: "REAL_DATA",
      latencyMs: 42.8,
      output: { results: [{ title: "one" }, { title: "two" }] },
    });
    expect(result).toMatchObject({ status: "SUCCESS", success: true, resultCount: 2, dataClass: "REAL_DATA" });
  });

  it.each([
    ["AUTH_FAILED", "AUTH_FAILED"],
    ["CREDIT", "CREDIT_LIMITED"],
    ["RATE_LIMITED", "RATE_LIMITED"],
    ["TIMEOUT", "TIMEOUT"],
    ["UNAVAILABLE", "UNAVAILABLE"],
  ])("maps %s to %s", (input, expected) => {
    const result = normalizeLiveProviderResult({ provider: "p", operation: "SEARCH", requestId: "r", status: input, error: input });
    expect(result.status).toBe(expected);
    expect(result.success).toBe(false);
  });

  it("distinguishes malformed and empty responses", () => {
    expect(normalizeLiveProviderResult({ provider: "p", operation: "SEARCH", requestId: "r", error: "malformed provider response" }).status).toBe("MALFORMED_RESPONSE");
    expect(normalizeLiveProviderResult({ provider: "p", operation: "SEARCH", requestId: "r", success: true, output: [] }).status).toBe("EMPTY_RESPONSE");
  });

  it("redacts secrets and never returns raw output", () => {
    const result = normalizeLiveProviderResult({
      provider: "p",
      operation: "SEARCH",
      requestId: "r",
      error: "Authorization: Bearer super-secret-token",
      output: { apiKey: "do-not-return" },
    });
    expect(result.sanitizedError).not.toContain("super-secret-token");
    expect(JSON.stringify(result)).not.toContain("do-not-return");
  });
});
