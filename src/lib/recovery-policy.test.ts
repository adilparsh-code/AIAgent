import { describe, expect, it } from "vitest";
import { classifyFailure, determineRecoveryPolicy } from "./failure-classification";
import { recommendRecoveryAction } from "./recovery-policy";

describe("recovery policy", () => {
  it("waits for approval before any retry", () => { const failure = classifyFailure("403 approval required"); expect(determineRecoveryPolicy({ ...failure, requiresApproval: true })).toBe("WAIT_FOR_APPROVAL"); });
  it("backs off rate limits", () => expect(determineRecoveryPolicy(classifyFailure("429 rate limit"))).toBe("BACKOFF"));
  it("does not retry transient failures without idempotency", () => expect(determineRecoveryPolicy({ ...classifyFailure("temporary failure"), idempotencyKnown: false })).toBe("HUMAN_REVIEW"));
  it("retries transient failures only with known idempotency", () => expect(determineRecoveryPolicy({ ...classifyFailure("temporary failure"), idempotencyKnown: true, capabilityAvailable: true })).toBe("RETRY"));
  it("requires human review for authentication and authorization", () => { expect(determineRecoveryPolicy(classifyFailure("401 unauthorized"))).toBe("HUMAN_REVIEW"); expect(determineRecoveryPolicy({ ...classifyFailure("403 forbidden"), requiresApproval: false })).toBe("HUMAN_REVIEW"); });
  it("uses refresh state for duplicates and integrity failures", () => { expect(determineRecoveryPolicy(classifyFailure("duplicate request"))).toBe("REFRESH_STATE"); expect(determineRecoveryPolicy(classifyFailure("foreign key constraint"))).toBe("REFRESH_STATE"); });
  it("does not perform recovery", () => { expect(typeof recommendRecoveryAction({ ...classifyFailure("timeout"), idempotencyKnown: true })).toBe("string"); });
});
