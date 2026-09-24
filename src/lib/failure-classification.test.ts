import { describe, expect, it } from "vitest";
import { classifyFailure } from "./failure-classification";

describe("failure classification", () => {
  it.each([
    ["timeout", "TIMEOUT", true], ["rate limit 429", "RATE_LIMITED", true], ["provider unavailable", "PROVIDER_UNAVAILABLE", true], ["temporary failure", "TRANSIENT", true],
    ["invalid input", "VALIDATION", false], ["foreign key constraint", "DATA_INTEGRITY", false], ["duplicate request", "DUPLICATE", false], ["401 unauthorized", "AUTHENTICATION", false], ["403 approval capability", "AUTHORIZATION", false], ["not configured", "CONFIGURATION", false],
  ] as const)("classifies %s", (message, category, retryable) => { const result = classifyFailure(new Error(message)); expect(result.category).toBe(category); expect(result.retryable).toBe(retryable); expect(result.safeUserMessage).toBeTruthy(); });
  it("fails closed for unknown errors", () => { const result = classifyFailure(new Error("opaque provider detail")); expect(result.category).toBe("UNKNOWN"); expect(result.retryable).toBe(false); expect(result.operationalAction).toBe("HUMAN_REVIEW"); });
});
