import { describe, expect, it } from "vitest";
import {
  adaptHandoffEnvelopeForIncomeLab,
  type IncomeLabAdaptedEnvelope,
} from "./income-lab-adapter";
import {
  buildHandoffDeliveryEnvelope,
  HANDOFF_DELIVERY_CONTRACT_ID,
  handoffDeliveryKey,
} from "./contract";
import type { OpportunityHandoffContract } from "../handoff";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function contract(): OpportunityHandoffContract {
  return {
    contractVersion: 1,
    handoffId: "handoff-1",
    opportunityId: "opp-1",
    title: "Shopify margin leak dashboard",
    category: "SAAS",
    targetAudience: "Small DTC store operators",
    problem: "Operators cannot see which channel actually contributes margin",
    validationConclusion: "VALIDATED",
    confidence: 0.82,
    score: 74,
    evidence: [
      {
        evidenceId: "ev-1",
        source: "brave",
        url: "https://example.test/margin-leak",
        title: "Store owners report unknown ad spend waste",
        supports: ["pain frequency"],
      },
    ],
    monetizationOptions: [{ method: "monthly subscription" }, { method: "usage-based" }],
    risks: ["Requires a Shopify app listing review"],
    recommendedExperiment: "MVP_BUILD",
    experimentHypothesis: "A margin dashboard for 3 stores produces two paid conversions in 14 days",
    successCriteria: ["Two of three pilot stores upgrade within 14 days"],
    budgetLimit: 250,
    timeLimitDays: 30,
    handoffStatus: "ACCEPTED",
  };
}

function nestedEnvelope() {
  return buildHandoffDeliveryEnvelope({ contract: contract(), eligibleForImplementation: true });
}

const ALL_RECEIVER_FIELDS = [
  "contractVersion",
  "contractId",
  "idempotencyKey",
  "correlationId",
  "eventType",
  "title",
  "description",
  "category",
  "businessModel",
  "monetizationMethod",
  "assertedEligibility",
  "payload",
] as const;

// ---------------------------------------------------------------------------
// 1. Successful nested-v1 → flat-1.0 mapping
// ---------------------------------------------------------------------------

describe("income-lab adapter — successful mapping", () => {
  it("maps the nested v1 envelope onto the exact flat 1.0 receiver contract", () => {
    const result = adaptHandoffEnvelopeForIncomeLab({
      envelope: nestedEnvelope(),
      businessModel: "SAAS",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const flat: IncomeLabAdaptedEnvelope = result.envelope;
    expect(flat.contractVersion).toBe("1.0");
    expect(flat.contractId).toBe(HANDOFF_DELIVERY_CONTRACT_ID);
    expect(flat.eventType).toBe("OPPORTUNITY_PROPOSED");
    expect(flat.title).toBe("Shopify margin leak dashboard");
    expect(flat.description).toBe(
      "Operators cannot see which channel actually contributes margin",
    );
    expect(flat.category).toBe("SAAS");
    expect(flat.businessModel).toBe("SAAS");
    expect(flat.monetizationMethod).toBe("monthly subscription; usage-based");
    expect(flat.assertedEligibility).toBe("ALLOWED");
  });

  it("emits exactly the receiver's allow-listed top-level fields and no others", () => {
    const result = adaptHandoffEnvelopeForIncomeLab({
      envelope: nestedEnvelope(),
      businessModel: "SAAS",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.envelope).sort()).toEqual([...ALL_RECEIVER_FIELDS].sort());
  });

  it("preserves handoff identity: idempotency key passes through unchanged", () => {
    const nested = nestedEnvelope();
    const result = adaptHandoffEnvelopeForIncomeLab({ envelope: nested, businessModel: "SAAS" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.envelope.idempotencyKey).toBe(nested.idempotencyKey);
    expect(result.envelope.idempotencyKey).toBe(handoffDeliveryKey("handoff-1", 1));
    expect(result.envelope.idempotencyKey).toBe("aiagent-handoff:handoff-1:v1");
  });

  it("is deterministic: two adaptations of the same input are byte-identical", () => {
    const nested = nestedEnvelope();
    const a = adaptHandoffEnvelopeForIncomeLab({ envelope: nested, businessModel: "SAAS" });
    const b = adaptHandoffEnvelopeForIncomeLab({ envelope: nested, businessModel: "SAAS" });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    expect(JSON.stringify(a.envelope)).toBe(JSON.stringify(b.envelope));
  });

  it("carries bounded provenance in the payload without leaking forbidden keys", () => {
    const result = adaptHandoffEnvelopeForIncomeLab({
      envelope: nestedEnvelope(),
      businessModel: "SAAS",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const payload = result.envelope.payload;
    expect(payload.producer).toMatchObject({
      handoffId: "handoff-1",
      sourceOpportunityId: "opp-1",
      sourceSystem: "AIAGENT",
      targetSystem: "AI_INCOME_LAB",
    });
    expect(payload.validation).toMatchObject({
      conclusion: "VALIDATED",
      confidence: 0.82,
      score: 74,
      eligibleForImplementation: true,
      handoffStatus: "ACCEPTED",
    });
    expect(payload.opportunity).toMatchObject({
      targetAudience: "Small DTC store operators",
      risks: "Requires a Shopify app listing review",
    });
    expect(payload.experiment).toMatchObject({
      recommendedType: "MVP_BUILD",
      budgetLimit: 250,
      timeLimitDays: 30,
    });
    expect(typeof payload.evidenceRefs).toBe("string");
    expect(payload.evidenceRefs).toContain("ev-1|brave|https://example.test/margin-leak");

    // The receiver rejects instruction-smuggling keys anywhere in the payload.
    const forbidden = ["instructions", "command", "jobtype", "sql", "token", "secret"];
    const serialized = JSON.stringify(payload).toLowerCase();
    for (const key of forbidden) {
      expect(serialized).not.toContain(`"${key}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Refusals — nothing invented, nothing sent
// ---------------------------------------------------------------------------

describe("income-lab adapter — refusals", () => {
  it("refuses with MISSING_BUSINESS_MODEL when the persisted business model is absent", () => {
    const result = adaptHandoffEnvelopeForIncomeLab({
      envelope: nestedEnvelope(),
      businessModel: null,
    });
    expect(result).toMatchObject({ ok: false, reason: "MISSING_BUSINESS_MODEL" });
  });

  it("refuses when the persisted business model is blank or whitespace", () => {
    for (const businessModel of ["", "   "]) {
      const result = adaptHandoffEnvelopeForIncomeLab({
        envelope: nestedEnvelope(),
        businessModel,
      });
      expect(result).toMatchObject({ ok: false, reason: "MISSING_BUSINESS_MODEL" });
    }
  });

  it("refuses with MISSING_PROBLEM when the problem/description source is empty", () => {
    const nested = nestedEnvelope();
    nested.opportunity.problem = "";
    const result = adaptHandoffEnvelopeForIncomeLab({ envelope: nested, businessModel: "SAAS" });
    expect(result).toMatchObject({ ok: false, reason: "MISSING_PROBLEM", field: "opportunity.problem" });
  });

  it("refuses with MISSING_MONETIZATION_METHOD when monetizationMethods is empty", () => {
    const nested = nestedEnvelope();
    nested.opportunity.monetizationMethods = [];
    const result = adaptHandoffEnvelopeForIncomeLab({ envelope: nested, businessModel: "SAAS" });
    expect(result).toMatchObject({
      ok: false,
      reason: "MISSING_MONETIZATION_METHOD",
      field: "opportunity.monetizationMethods",
    });
  });

  it("refuses with MISSING_TITLE when the opportunity has no title", () => {
    const nested = nestedEnvelope();
    nested.opportunity.title = "  ";
    const result = adaptHandoffEnvelopeForIncomeLab({ envelope: nested, businessModel: "SAAS" });
    expect(result).toMatchObject({ ok: false, reason: "MISSING_TITLE" });
  });

  it("refuses with UNSUPPORTED_CONTRACT_VERSION for an unsupported producer version", () => {
    const nested = nestedEnvelope() as unknown as Record<string, unknown>;
    nested.contractVersion = 2;
    const result = adaptHandoffEnvelopeForIncomeLab({
      envelope: nested as never,
      businessModel: "SAAS",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "UNSUPPORTED_CONTRACT_VERSION",
      field: "contractVersion",
    });
  });

  it("refuses with UNSUPPORTED_CONTRACT_ID for a foreign contract id", () => {
    const nested = nestedEnvelope() as unknown as Record<string, unknown>;
    nested.contractId = "someone.elses.contract";
    const result = adaptHandoffEnvelopeForIncomeLab({
      envelope: nested as never,
      businessModel: "SAAS",
    });
    expect(result).toMatchObject({ ok: false, reason: "UNSUPPORTED_CONTRACT_ID" });
  });

  it("refuses MALFORMED_ENVELOPE for null, non-object and missing-opportunity inputs", () => {
    expect(
      adaptHandoffEnvelopeForIncomeLab({ envelope: null as never, businessModel: "SAAS" }),
    ).toMatchObject({ ok: false, reason: "MALFORMED_ENVELOPE" });
    expect(
      adaptHandoffEnvelopeForIncomeLab({ envelope: "nope" as never, businessModel: "SAAS" }),
    ).toMatchObject({ ok: false, reason: "MALFORMED_ENVELOPE" });
    expect(
      adaptHandoffEnvelopeForIncomeLab({
        envelope: { contractId: HANDOFF_DELIVERY_CONTRACT_ID, contractVersion: 1 } as never,
        businessModel: "SAAS",
      }),
    ).toMatchObject({ ok: false, reason: "MALFORMED_ENVELOPE", field: "opportunity" });
  });

  it("refuses with PAYLOAD_TOO_LARGE when the provenance payload exceeds the receiver's 16 KB bound", () => {
    const nested = nestedEnvelope();
    // sourceOpportunityId is copied raw into the provenance block, so an
    // unboundable id is the deterministic way to exceed the byte budget.
    nested.sourceOpportunityId = "o".repeat(20_000);
    const result = adaptHandoffEnvelopeForIncomeLab({ envelope: nested, businessModel: "SAAS" });
    expect(result).toMatchObject({ ok: false, reason: "PAYLOAD_TOO_LARGE", field: "payload" });
  });

  it("never silently clips the provenance payload to fit the byte bound", () => {
    const nested = nestedEnvelope();
    nested.sourceOpportunityId = "o".repeat(20_000);
    const result = adaptHandoffEnvelopeForIncomeLab({ envelope: nested, businessModel: "SAAS" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result)).not.toContain("o".repeat(100));
  });

  it("never returns a fabricated value for a refused field", () => {
    const result = adaptHandoffEnvelopeForIncomeLab({ envelope: nestedEnvelope(), businessModel: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result).not.toHaveProperty("envelope");
  });
});

// ---------------------------------------------------------------------------
// 3. Bounds — adapted values always satisfy the receiver's limits
// ---------------------------------------------------------------------------

describe("income-lab adapter — receiver bounds", () => {
  it("truncates oversized title/description/category to the receiver's caps", () => {
    const nested = nestedEnvelope();
    nested.opportunity.title = "T".repeat(10_000);
    nested.opportunity.problem = "P".repeat(10_000);
    nested.opportunity.category = "C".repeat(10_000);

    const result = adaptHandoffEnvelopeForIncomeLab({ envelope: nested, businessModel: "B".repeat(500) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.envelope.title.length).toBe(300);
    expect(result.envelope.description.length).toBe(2_000);
    expect(result.envelope.category.length).toBe(200);
    expect(result.envelope.businessModel.length).toBe(200);
  });

  it("keeps the serialized payload under the receiver's 16 KB bound", () => {
    const nested = nestedEnvelope();
    nested.opportunity.risks = Array.from({ length: 20 }, (_, i) => `risk-${i}`);
    nested.evidence = Array.from({ length: 25 }, (_, i) => ({
      evidenceId: `ev-${i}`,
      source: "brave",
      url: `https://example.test/${i}`,
      title: `Evidence item ${i}`,
      supports: ["demand"],
    }));

    const result = adaptHandoffEnvelopeForIncomeLab({ envelope: nested, businessModel: "SAAS" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(JSON.stringify(result.envelope.payload).length).toBeLessThanOrEqual(16 * 1024);
  });

  it("derives a bounded correlationId and keeps it within the receiver's cap", () => {
    const nested = nestedEnvelope();
    nested.handoffId = "h".repeat(120);
    const result = adaptHandoffEnvelopeForIncomeLab({ envelope: nested, businessModel: "SAAS" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // "aiagent-handoff:" (16) + 120 id chars = 136 ≤ 200.
    expect(result.envelope.correlationId).toBe(`aiagent-handoff:${"h".repeat(120)}`);
    expect(result.envelope.correlationId.length).toBeLessThanOrEqual(200);
  });

  it("refuses rather than truncates an over-long handoffId or idempotency key", () => {
    const longId = nestedEnvelope();
    longId.handoffId = "h".repeat(200);
    expect(
      adaptHandoffEnvelopeForIncomeLab({ envelope: longId, businessModel: "SAAS" }),
    ).toMatchObject({ ok: false, reason: "MALFORMED_ENVELOPE", field: "handoffId" });

    const longKey = nestedEnvelope();
    longKey.idempotencyKey = "k".repeat(300);
    expect(
      adaptHandoffEnvelopeForIncomeLab({ envelope: longKey, businessModel: "SAAS" }),
    ).toMatchObject({ ok: false, reason: "MALFORMED_ENVELOPE", field: "idempotencyKey" });
  });

  it("refuses with MISSING_CATEGORY when the category is blank", () => {
    const nested = nestedEnvelope();
    nested.opportunity.category = " ";
    const result = adaptHandoffEnvelopeForIncomeLab({ envelope: nested, businessModel: "SAAS" });
    expect(result).toMatchObject({ ok: false, reason: "MISSING_CATEGORY", field: "opportunity.category" });
  });

  it("maps category through unchanged when present", () => {
    const result = adaptHandoffEnvelopeForIncomeLab({ envelope: nestedEnvelope(), businessModel: "SAAS" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.category).toBe("SAAS");
  });
});

// ---------------------------------------------------------------------------
// 4. Idempotency, correlationId, eventType mapping
// ---------------------------------------------------------------------------

describe("income-lab adapter — idempotency, correlation, event type", () => {
  it("derives correlationId deterministically from the handoff id", () => {
    const result = adaptHandoffEnvelopeForIncomeLab({ envelope: nestedEnvelope(), businessModel: "SAAS" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.correlationId).toBe("aiagent-handoff:handoff-1");
  });

  it("maps eventType to exactly OPPORTUNITY_PROPOSED", () => {
    const result = adaptHandoffEnvelopeForIncomeLab({ envelope: nestedEnvelope(), businessModel: "SAAS" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.eventType).toBe("OPPORTUNITY_PROPOSED");
  });

  it("preserves idempotency across different data with the same handoff id", () => {
    const a = nestedEnvelope();
    const b = nestedEnvelope();
    b.opportunity.title = "A different title entirely";
    const ra = adaptHandoffEnvelopeForIncomeLab({ envelope: a, businessModel: "SAAS" });
    const rb = adaptHandoffEnvelopeForIncomeLab({ envelope: b, businessModel: "SAAS" });
    expect(ra.ok && rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) return;
    expect(ra.envelope.idempotencyKey).toBe(rb.envelope.idempotencyKey);
  });
});

// ---------------------------------------------------------------------------
// 5. Eligibility stays audit-only
// ---------------------------------------------------------------------------

describe("income-lab adapter — eligibility is audit-only", () => {
  it("maps an eligible producer verdict to ALLOWED", () => {
    const result = adaptHandoffEnvelopeForIncomeLab({ envelope: nestedEnvelope(), businessModel: "SAAS" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.assertedEligibility).toBe("ALLOWED");
  });

  it("maps a non-eligible producer verdict to REVIEW_REQUIRED — never to a stronger claim", () => {
    const nested = buildHandoffDeliveryEnvelope({ contract: contract(), eligibleForImplementation: false });
    const result = adaptHandoffEnvelopeForIncomeLab({ envelope: nested, businessModel: "SAAS" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.assertedEligibility).toBe("REVIEW_REQUIRED");
    // The full verdict is still preserved in the bounded provenance payload.
    expect(result.envelope.payload.validation).toMatchObject({ eligibleForImplementation: false });
  });
});
