import { describe, expect, it } from "vitest";
import {
  buildMonetizationOptions,
  buildSuccessCriteria,
  defaultExperimentHypothesis,
  evaluateHandoffEligibility,
  isImplementationPermittedConclusion,
  resolveExperimentHypothesis,
} from "./handoff";
import type { Evidence, ResearchConclusion } from "./research-types";
import type { Opportunity } from "./types";

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-test",
    title: "Test opportunity",
    category: "SAAS",
    businessModel: "SAAS",
    targetAudience: "Indie teachers",
    problemSolved: "Manual worksheet creation",
    monetizationMethod: "Subscription; one-time purchase",
    estimatedStartupCost: 100,
    demandScore: 60,
    competitionScore: 40,
    commercialIntentScore: 55,
    automationScore: 50,
    differentiationScore: 45,
    monetizationStrengthScore: 50,
    halalScore: 80,
    halalStatus: "HALAL",
    overallScore: 62.5,
    confidence: 40,
    status: "VALIDATED",
    evidence: [],
    risks: ["Platform dependency"],
    nextAction: "Build landing page",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "ev-1",
    source: "brave",
    title: "Demand evidence",
    url: "https://example.com/a",
    snippet: "Snippet",
    collectedAt: new Date().toISOString(),
    relevanceScore: 0.8,
    qualityScore: 0.7,
    hash: "hash-1",
    supports: ["demand"],
    contradicts: [],
    dataClass: "REAL_LIVE_DATA",
    ...overrides,
  };
}

function makeSource(overrides: {
  opportunity?: Opportunity;
  conclusion?: ResearchConclusion | null;
  confidence?: number | null;
  evidence?: Evidence[];
} = {}) {
  return {
    opportunity: overrides.opportunity ?? makeOpportunity(),
    lastResearchConclusion:
      overrides.conclusion !== undefined ? overrides.conclusion : ("VALIDATED" as ResearchConclusion),
    lastResearchConfidence: overrides.confidence !== undefined ? overrides.confidence : 0.72,
    lastResearchEvidence: overrides.evidence ?? [makeEvidence(), makeEvidence({ id: "ev-2", hash: "hash-2" })],
  };
}

describe("isImplementationPermittedConclusion", () => {
  it("permits VALIDATED and REQUIRES_HUMAN_REVIEW", () => {
    expect(isImplementationPermittedConclusion("VALIDATED")).toBe(true);
    expect(isImplementationPermittedConclusion("REQUIRES_HUMAN_REVIEW")).toBe(true);
  });

  it("does not permit PROMISING, REJECTED, or missing conclusions", () => {
    expect(isImplementationPermittedConclusion("PROMISING")).toBe(false);
    expect(isImplementationPermittedConclusion("REJECTED")).toBe(false);
    expect(isImplementationPermittedConclusion(null)).toBe(false);
  });
});

describe("evaluateHandoffEligibility", () => {
  it("an eligible opportunity passes with no reasons", () => {
    const result = evaluateHandoffEligibility(makeSource());
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("rejects when there is no research run", () => {
    const result = evaluateHandoffEligibility(makeSource({ conclusion: null, confidence: null, evidence: [] }));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("NO_RESEARCH_RUN");
    expect(result.reasons).toContain("NO_EVIDENCE");
  });

  it("rejects conclusions that do not permit implementation", () => {
    const result = evaluateHandoffEligibility(makeSource({ conclusion: "PROMISING" }));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("VALIDATION_NOT_PERMITS_IMPLEMENTATION");
  });

  it("rejects REJECTED opportunities and NOT_ALLOWED halal status", () => {
    const result = evaluateHandoffEligibility(
      makeSource({ opportunity: makeOpportunity({ status: "REJECTED", halalStatus: "NOT_ALLOWED" }) }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("OPPORTUNITY_REJECTED");
    expect(result.reasons).toContain("OPPORTUNITY_HALAL_NOT_ALLOWED");
  });

  it("requires recorded risks", () => {
    const result = evaluateHandoffEligibility(makeSource({ opportunity: makeOpportunity({ risks: [] }) }));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("MISSING_RISKS");
  });

  it("requires confidence and score", () => {
    const result = evaluateHandoffEligibility(
      makeSource({ confidence: null, opportunity: makeOpportunity({ overallScore: NaN }) }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("NO_CONFIDENCE");
    expect(result.reasons).toContain("NO_SCORE");
  });
});

describe("resolveExperimentHypothesis", () => {
  it("uses the explicit override when provided", () => {
    const source = { ...makeSource(), experimentHypothesisOverride: "  Custom hypothesis  " };
    expect(resolveExperimentHypothesis(source)).toBe("Custom hypothesis");
  });

  it("falls back to the derived, opportunity-traceable hypothesis", () => {
    const hypothesis = resolveExperimentHypothesis(makeSource());
    expect(hypothesis).toContain("Test opportunity");
    expect(hypothesis).toContain("Indie teachers");
    expect(defaultExperimentHypothesis(makeOpportunity())).toBe(hypothesis);
  });
});

describe("buildSuccessCriteria", () => {
  it("derives criteria from evidence, conclusion, and next action only", () => {
    const criteria = buildSuccessCriteria(makeSource());
    expect(criteria.some((c) => c.includes("2 evidence item(s)"))).toBe(true);
    expect(criteria.some((c) => c.includes("VALIDATED"))).toBe(true);
    expect(criteria.some((c) => c.includes("Build landing page"))).toBe(true);
  });

  it("stays empty when nothing is recorded", () => {
    const source = makeSource({ conclusion: null, evidence: [] });
    const opp = makeOpportunity({ nextAction: "" });
    const criteria = buildSuccessCriteria({ ...source, opportunity: opp });
    expect(criteria).toEqual([]);
  });
});

describe("buildMonetizationOptions", () => {
  it("splits semicolon-separated methods", () => {
    expect(buildMonetizationOptions(makeOpportunity())).toEqual([
      { method: "Subscription" },
      { method: "one-time purchase" },
    ]);
  });

  it("returns an empty list when monetization is not recorded", () => {
    expect(buildMonetizationOptions(makeOpportunity({ monetizationMethod: "" }))).toEqual([]);
  });
});
