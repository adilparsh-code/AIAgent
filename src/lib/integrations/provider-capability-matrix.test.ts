import { describe, expect, it } from "vitest";
import { DANGEROUS_PROVIDER_CAPABILITIES, getDangerousCapabilityPolicy, getProviderCapabilityMatrix } from "./provider-capability-matrix";

describe("provider capability matrix", () => {
  it("maps current provider capabilities to the existing permission contract", () => {
    const row = getProviderCapabilityMatrix().find((item) => item.provider === "sambanova" && item.capability === "CREATE_DRAFT");
    expect(row).toMatchObject({ permission: "CREATE_DRAFT", approvalRequired: false, liveVerificationRequired: true, automaticExecutionAllowed: true });
  });

  it.each(["PUBLISH", "SEND_MESSAGE", "CREATE_CAMPAIGN", "SPEND_MONEY"] as const)("keeps %s permanently approval-gated", (capability) => {
    const policy = getDangerousCapabilityPolicy(capability);
    expect(policy.approvalRequired).toBe(true);
    expect(policy.automaticExecutionAllowed).toBe(false);
    expect(policy.liveVerificationRequired).toBe(true);
  });

  it("contains exactly the declared dangerous capabilities", () => {
    expect(DANGEROUS_PROVIDER_CAPABILITIES).toEqual(["PUBLISH", "SEND_MESSAGE", "CREATE_CAMPAIGN", "SPEND_MONEY"]);
  });
});
