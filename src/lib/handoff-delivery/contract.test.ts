import { describe, expect, it } from "vitest";
import {
  HANDOFF_DELIVERY_CONTRACT_ID,
  HANDOFF_DELIVERY_CONTRACT_VERSION,
  HANDOFF_DELIVERY_SOURCE_SYSTEM,
  HANDOFF_DELIVERY_TARGET_SYSTEM,
  buildHandoffDeliveryEnvelope,
  handoffDeliveryKey,
  parseHandoffDeliveryEnvelope,
  type HandoffDeliveryEnvelopeV1,
} from "./contract";
import type { OpportunityHandoffContract } from "../handoff";

function contract(overrides: Partial<OpportunityHandoffContract> = {}): OpportunityHandoffContract {
  return {
    contractVersion: 1,
    handoffId: "handoff-1",
    opportunityId: "opp-1",
    title: "Niche analytics dashboard",
    category: "SaaS",
    targetAudience: "Small e-commerce operators",
    problem: "Operators cannot see channel ROI",
    validationConclusion: "VALIDATED",
    confidence: 0.82,
    score: 74,
    evidence: [
      { evidenceId: "ev-1", source: "brave", url: "https://example.test/a", title: "A", supports: ["demand"] },
    ],
    monetizationOptions: [{ method: "subscription" }],
    risks: ["Low willingness to pay"],
    recommendedExperiment: "MVP_BUILD",
    experimentHypothesis: "A minimal dashboard produces trial signups",
    successCriteria: ["MVP tested against recorded evidence"],
    budgetLimit: 250,
    timeLimitDays: 30,
    handoffStatus: "ACCEPTED",
    ...overrides,
  };
}

function envelope(overrides: Partial<HandoffDeliveryEnvelopeV1> = {}): HandoffDeliveryEnvelopeV1 {
  return buildHandoffDeliveryEnvelope({ contract: contract(), eligibleForImplementation: true, ...overrides });
}

describe("handoff delivery contract — shared wire format", () => {
  it("stamps the agreed contract id, version and addressing", () => {
    const built = envelope();
    expect(built.contractId).toBe(HANDOFF_DELIVERY_CONTRACT_ID);
    expect(built.contractVersion).toBe(HANDOFF_DELIVERY_CONTRACT_VERSION);
    expect(built.sourceSystem).toBe(HANDOFF_DELIVERY_SOURCE_SYSTEM);
    expect(built.targetSystem).toBe(HANDOFF_DELIVERY_TARGET_SYSTEM);
    expect(built.sourceOpportunityId).toBe("opp-1");
  });

  it("carries the handoff id, the validation state and the downstream opportunity data", () => {
    const built = envelope();
    expect(built.handoffId).toBe("handoff-1");
    expect(built.validation).toEqual({
      conclusion: "VALIDATED",
      confidence: 0.82,
      score: 74,
      eligibleForImplementation: true,
      handoffStatus: "ACCEPTED",
    });
    expect(built.opportunity.title).toBe("Niche analytics dashboard");
    expect(built.opportunity.monetizationMethods).toEqual(["subscription"]);
    expect(built.opportunity.risks).toEqual(["Low willingness to pay"]);
    expect(built.experiment).toEqual({
      recommendedType: "MVP_BUILD",
      hypothesis: "A minimal dashboard produces trial signups",
      successCriteria: ["MVP tested against recorded evidence"],
      budgetLimit: 250,
      timeLimitDays: 30,
    });
    expect(built.evidence[0]?.evidenceId).toBe("ev-1");
  });

  it("keeps unknown values null rather than inventing them", () => {
    const built = buildHandoffDeliveryEnvelope({
      contract: contract({ validationConclusion: null, confidence: null, score: null }),
      eligibleForImplementation: true,
    });
    expect(built.validation.conclusion).toBeNull();
    expect(built.validation.confidence).toBeNull();
    expect(built.validation.score).toBeNull();
  });
});

describe("handoff delivery contract — idempotency / duplicate-delivery protection", () => {
  it("derives a deterministic key from the handoff id and contract version", () => {
    expect(handoffDeliveryKey("handoff-1")).toBe("aiagent-handoff:handoff-1:v1");
    expect(handoffDeliveryKey("handoff-1")).toBe(handoffDeliveryKey("handoff-1"));
  });

  it("gives a different key to a different handoff", () => {
    expect(handoffDeliveryKey("handoff-1")).not.toBe(handoffDeliveryKey("handoff-2"));
  });

  it("produces byte-identical payloads for repeated builds of the same handoff", () => {
    const first = buildHandoffDeliveryEnvelope({
      contract: contract(),
      eligibleForImplementation: true,
      issuedAt: "2026-01-01T00:00:00.000Z",
    });
    const retry = buildHandoffDeliveryEnvelope({
      contract: contract(),
      eligibleForImplementation: true,
      issuedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(JSON.stringify(retry)).toBe(JSON.stringify(first));
  });
});

describe("handoff delivery contract — receiver-side validation", () => {
  it("accepts a producer-built envelope", () => {
    const result = parseHandoffDeliveryEnvelope(JSON.parse(JSON.stringify(envelope())));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope.idempotencyKey).toBe("aiagent-handoff:handoff-1:v1");
  });

  it("round-trips through JSON exactly", () => {
    const built = envelope();
    const parsed = parseHandoffDeliveryEnvelope(structuredClone(built));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.envelope).toEqual(built);
  });

  it("refuses an unknown contract id", () => {
    const result = parseHandoffDeliveryEnvelope({ ...envelope(), contractId: "something.else" });
    expect(result).toMatchObject({ ok: false, reason: "UNSUPPORTED_CONTRACT_ID" });
  });

  it("refuses an unsupported contract version rather than guessing", () => {
    const result = parseHandoffDeliveryEnvelope({ ...envelope(), contractVersion: 99 });
    expect(result).toMatchObject({ ok: false, reason: "UNSUPPORTED_CONTRACT_VERSION" });
  });

  it("refuses a forged idempotency key", () => {
    const result = parseHandoffDeliveryEnvelope({ ...envelope(), idempotencyKey: "aiagent-handoff:other:v1" });
    expect(result).toMatchObject({ ok: false, reason: "IDEMPOTENCY_KEY_MISMATCH" });
  });

  it("refuses a delivery addressed to a different source or target system", () => {
    expect(parseHandoffDeliveryEnvelope({ ...envelope(), sourceSystem: "SOMETHING_ELSE" })).toMatchObject({
      ok: false,
      reason: "WRONG_SOURCE_SYSTEM",
    });
    expect(parseHandoffDeliveryEnvelope({ ...envelope(), targetSystem: "SOMETHING_ELSE" })).toMatchObject({
      ok: false,
      reason: "WRONG_TARGET_SYSTEM",
    });
  });

  it("refuses a handoff AIAgent's own gate marked as not implementation-eligible", () => {
    const built = buildHandoffDeliveryEnvelope({ contract: contract(), eligibleForImplementation: false });
    const result = parseHandoffDeliveryEnvelope(built);
    expect(result).toMatchObject({ ok: false, reason: "NOT_IMPLEMENTATION_ELIGIBLE", status: 422 });
  });

  it("refuses a missing required field", () => {
    const { handoffId: _omitted, ...withoutId } = envelope();
    expect(parseHandoffDeliveryEnvelope(withoutId)).toMatchObject({ ok: false, reason: "MISSING_FIELD" });
  });

  it("refuses a non-object payload", () => {
    expect(parseHandoffDeliveryEnvelope("nope")).toMatchObject({ ok: false, reason: "INVALID_TYPE" });
    expect(parseHandoffDeliveryEnvelope(null)).toMatchObject({ ok: false, reason: "INVALID_TYPE" });
  });

  it("refuses an unknown enum value instead of coercing it", () => {
    const built = envelope();
    const tampered = JSON.parse(JSON.stringify(built));
    tampered.experiment.recommendedType = "AUTO_EXECUTE";
    expect(parseHandoffDeliveryEnvelope(tampered)).toMatchObject({
      ok: false,
      reason: "INVALID_ENUM_VALUE",
      field: "experiment.recommendedType",
    });
  });

  it("refuses a non-finite number where a number is required", () => {
    const tampered = JSON.parse(JSON.stringify(envelope()));
    tampered.experiment.budgetLimit = "lots";
    expect(parseHandoffDeliveryEnvelope(tampered)).toMatchObject({ ok: false, reason: "INVALID_TYPE" });
  });

  it("refuses an over-long string and an over-long list", () => {
    const longTitle = JSON.parse(JSON.stringify(envelope()));
    longTitle.opportunity.title = "x".repeat(5_000);
    expect(parseHandoffDeliveryEnvelope(longTitle)).toMatchObject({ ok: false, reason: "FIELD_TOO_LONG" });

    const manyRisks = JSON.parse(JSON.stringify(envelope()));
    manyRisks.opportunity.risks = Array.from({ length: 200 }, (_, i) => `risk ${i}`);
    expect(parseHandoffDeliveryEnvelope(manyRisks)).toMatchObject({ ok: false, reason: "FIELD_TOO_LONG" });
  });

  it("refuses an unparseable timestamp", () => {
    expect(parseHandoffDeliveryEnvelope({ ...envelope(), issuedAt: "not-a-date" })).toMatchObject({
      ok: false,
      reason: "INVALID_TYPE",
      field: "issuedAt",
    });
  });
});
