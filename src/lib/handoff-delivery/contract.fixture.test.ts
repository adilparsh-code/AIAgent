import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildHandoffDeliveryEnvelope, parseHandoffDeliveryEnvelope } from "./contract";
import type { OpportunityHandoffContract } from "../handoff";

/**
 * The golden fixture is the cross-repository contract test.
 *
 * The SAME file is committed byte-identically in the AI Income Lab repository
 * (`src/lib/integrations/__tests__/fixtures/aiagent-handoff-v1.json`), where
 * the receiver validates it. That is what keeps two independent services from
 * drifting: a change to the producer's output fails here, and a change to the
 * consumer's validator fails there.
 */
const FIXTURE_PATH = path.join(__dirname, "contract.fixture.json");
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, unknown>;

/** The persisted handoff contract that must produce the golden envelope. */
const sourceContract: OpportunityHandoffContract = {
  contractVersion: 1,
  handoffId: "handoff-golden-1",
  opportunityId: "opp-golden-1",
  title: "Shopify margin leak dashboard",
  category: "SAAS",
  targetAudience: "Small DTC store operators",
  problem: "Operators cannot see which channel actually contributes margin",
  validationConclusion: "VALIDATED",
  confidence: 0.82,
  score: 74,
  evidence: [
    {
      evidenceId: "ev-golden-1",
      source: "brave",
      url: "https://example.test/margin-leak",
      title: "Store owners report unknown ad spend waste",
      supports: ["pain frequency"],
    },
    {
      evidenceId: "ev-golden-2",
      source: "reddit",
      url: "https://example.test/threads/margins",
      title: "Operators ask for per-channel margin reporting",
      supports: ["pain frequency", "willingness to switch"],
    },
  ],
  monetizationOptions: [{ method: "monthly subscription" }],
  risks: ["Requires a Shopify app listing review"],
  recommendedExperiment: "MVP_BUILD",
  experimentHypothesis:
    "A margin dashboard for 3 stores produces two paid conversions in 14 days",
  successCriteria: [
    "Two of three pilot stores upgrade to the paid tier within 14 days",
    "Reported channel margin reconciles with store export for at least 95% of SKUs",
  ],
  budgetLimit: 250,
  timeLimitDays: 30,
  handoffStatus: "ACCEPTED",
};

describe("cross-repository golden contract fixture", () => {
  it("is emitted byte-identically by the producer", () => {
    const built = buildHandoffDeliveryEnvelope({
      contract: sourceContract,
      eligibleForImplementation: true,
      issuedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(JSON.parse(JSON.stringify(built))).toEqual(fixture);
  });

  it("is accepted by the receiver-side validator", () => {
    const result = parseHandoffDeliveryEnvelope(structuredClone(fixture));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.handoffId).toBe("handoff-golden-1");
      expect(result.envelope.idempotencyKey).toBe("aiagent-handoff:handoff-golden-1:v1");
      expect(result.envelope.evidence).toHaveLength(2);
    }
  });

  it("carries the deterministic key both sides derive independently", () => {
    // The receiver recomputes this from handoffId + contractVersion; if either
    // side changed the rule, the fixture would stop validating.
    const envelope = fixture as { handoffId: string; contractVersion: number; idempotencyKey: string };
    expect(envelope.idempotencyKey).toBe(
      `aiagent-handoff:${envelope.handoffId}:v${envelope.contractVersion}`,
    );
  });
});
