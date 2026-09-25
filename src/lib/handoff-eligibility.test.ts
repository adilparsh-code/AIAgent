/**
 * HIGH-2 regression suite: there is exactly ONE handoff eligibility policy.
 *
 * The bug this locks down: discovery advertised `PROMISING` candidates as
 * handoff-ready while the canonical handoff API rejected them. These tests
 * assert that the canonical gate and the discovery projection agree for every
 * `ResearchConclusion` and for every confidence/evidence/contradiction state,
 * so a second policy list can never be reintroduced.
 */
import { describe, expect, it } from "vitest";
import {
  HANDOFF_IMPLEMENTATION_PERMITTED_CONCLUSIONS,
  evaluateHandoffEligibility,
  evaluateHandoffGate,
  evaluateResearchHandoffReadiness,
  isImplementationPermittedConclusion,
} from "./handoff";
import { deriveHandoffStatus } from "./opportunity-brief";
import type { OpportunityEvidenceBundle } from "./discovery-types";
import type { Evidence, ResearchConclusion } from "./research-types";
import type { Opportunity } from "./types";

const ALL_CONCLUSIONS: ResearchConclusion[] = [
  "VALIDATED",
  "PROMISING",
  "REQUIRES_HUMAN_REVIEW",
  "INSUFFICIENT_EVIDENCE",
  "CONTRADICTED",
  "REJECTED",
];

/** The conclusions both paths must agree are implementation-permitted. */
const PERMITTED: ResearchConclusion[] = ["VALIDATED", "REQUIRES_HUMAN_REVIEW"];
const NOT_PERMITTED = ALL_CONCLUSIONS.filter((c) => !PERMITTED.includes(c));

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-policy",
    title: "Policy opportunity",
    category: "SAAS",
    businessModel: "SAAS",
    targetAudience: "Teachers",
    problemSolved: "Manual work",
    monetizationMethod: "Subscription",
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
  } as Opportunity;
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "ev-policy-1",
    source: "brave",
    title: "Demand evidence",
    url: "https://example.com/a",
    snippet: "Snippet",
    collectedAt: new Date().toISOString(),
    relevanceScore: 0.8,
    qualityScore: 0.7,
    hash: "hash-policy-1",
    supports: ["demand"],
    contradicts: [],
    dataClass: "REAL_LIVE_DATA",
    ...overrides,
  } as Evidence;
}

function source(overrides: {
  conclusion?: ResearchConclusion | null;
  confidence?: number | null;
  evidence?: Evidence[];
  opportunity?: Opportunity;
} = {}) {
  return {
    opportunity: overrides.opportunity ?? makeOpportunity(),
    lastResearchConclusion: overrides.conclusion !== undefined ? overrides.conclusion : ("VALIDATED" as ResearchConclusion),
    lastResearchConfidence: overrides.confidence !== undefined ? overrides.confidence : 0.72,
    lastResearchEvidence: overrides.evidence ?? [makeEvidence()],
  };
}

type HandoffSource = ReturnType<typeof source>;

/** Minimal bundle matching the discovery readiness projection. */
function bundle(overrides: {
  conclusion?: ResearchConclusion;
  evidenceCoverage?: number;
  contradictionCount?: number;
  confidence?: number;
} = {}): OpportunityEvidenceBundle {
  const signal = {
    key: "demand" as const,
    label: "Demand",
    status: "SUPPORTED" as const,
    evidenceIds: ["ev-bundle"],
    basis: "3 items",
  };
  return {
    demand: signal,
    painPoint: signal,
    trend: signal,
    commercialIntent: signal,
    competition: signal,
    monetization: signal,
    evidenceQuality: 0.8,
    evidenceCoverage: overrides.evidenceCoverage ?? 0.9,
    sourceDiversity: 2,
    contradictionCount: overrides.contradictionCount ?? 0,
    providerStatuses: [],
    contradictions: [],
    conclusion: overrides.conclusion ?? "VALIDATED",
    conclusionBasis: "test",
    confidence: overrides.confidence ?? 0.72,
  } as unknown as OpportunityEvidenceBundle;
}

describe("single authoritative handoff policy", () => {
  it("declares exactly one list of implementation-permitted conclusions", () => {
    expect([...HANDOFF_IMPLEMENTATION_PERMITTED_CONCLUSIONS].sort()).toEqual([...PERMITTED].sort());
    // The list must stay a set of real conclusions, and must never grow a
    // second declaration elsewhere in the codebase.
    expect(new Set(HANDOFF_IMPLEMENTATION_PERMITTED_CONCLUSIONS).size).toBe(
      HANDOFF_IMPLEMENTATION_PERMITTED_CONCLUSIONS.length,
    );
  });

  it("accepts every permitted conclusion and rejects every other conclusion", () => {
    for (const conclusion of PERMITTED) {
      expect(isImplementationPermittedConclusion(conclusion)).toBe(true);
    }
    for (const conclusion of NOT_PERMITTED) {
      expect(isImplementationPermittedConclusion(conclusion)).toBe(false);
    }
    expect(isImplementationPermittedConclusion(null)).toBe(false);
  });
});

describe("decision table: every ResearchConclusion across both handoff paths", () => {
  for (const conclusion of ALL_CONCLUSIONS) {
    it(`${conclusion}: canonical gate and discovery projection agree`, () => {
      const canonical = evaluateHandoffEligibility(source({ conclusion }));
      const discovery = evaluateResearchHandoffReadiness({
        conclusion,
        confidence: 0.72,
        evidenceCoverage: 0.9,
        contradictionCount: 0,
      });

      expect(canonical.eligible).toBe(PERMITTED.includes(conclusion));
      expect(discovery.eligible).toBe(PERMITTED.includes(conclusion));
      expect(deriveHandoffStatus(conclusion, bundle({ conclusion }))).toBe(
        PERMITTED.includes(conclusion) ? "READY" : "NOT_READY",
      );

      if (!PERMITTED.includes(conclusion)) {
        expect(canonical.reasons).toContain("VALIDATION_NOT_PERMITS_IMPLEMENTATION");
        expect(discovery.reasons).toContain("VALIDATION_NOT_PERMITS_IMPLEMENTATION");
      }
    });
  }

  it("PROMISING is never handoff-ready on either path (the HIGH-2 regression)", () => {
    expect(evaluateHandoffEligibility(source({ conclusion: "PROMISING" })).eligible).toBe(false);
    expect(deriveHandoffStatus("PROMISING", bundle({ conclusion: "PROMISING" }))).toBe("NOT_READY");
  });
});

describe("decision table: required confidence and evidence state", () => {
  it("requires evidence on both paths", () => {
    const canonical = evaluateHandoffEligibility(source({ evidence: [] }));
    expect(canonical.eligible).toBe(false);
    expect(canonical.reasons).toContain("NO_EVIDENCE");

    const discovery = evaluateResearchHandoffReadiness({
      conclusion: "VALIDATED",
      confidence: 0.72,
      evidenceCoverage: 0,
      contradictionCount: 0,
    });
    expect(discovery.eligible).toBe(false);
    expect(discovery.reasons).toContain("NO_EVIDENCE");
    expect(deriveHandoffStatus("VALIDATED", bundle({ evidenceCoverage: 0 }))).toBe("NOT_READY");
  });

  it("requires a finite confidence value on both paths", () => {
    // Built explicitly (not through `source()`) so a missing `lastResearchConfidence`
    // is genuinely absent rather than defaulted by the test helper.
    for (const confidence of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      const canonical = evaluateHandoffEligibility({
        opportunity: makeOpportunity(),
        lastResearchConclusion: "VALIDATED",
        lastResearchConfidence: confidence as HandoffSource["lastResearchConfidence"],
        lastResearchEvidence: [makeEvidence()],
      });
      expect(canonical.reasons).toContain("NO_CONFIDENCE");

      const discovery = evaluateResearchHandoffReadiness({
        conclusion: "VALIDATED",
        confidence: confidence as number,
        evidenceCoverage: 0.9,
        contradictionCount: 0,
      });
      expect(discovery.reasons).toContain("NO_CONFIDENCE");
    }
  });

  it("requires a recorded score and risks on the canonical path", () => {
    expect(
      evaluateHandoffEligibility(source({ opportunity: makeOpportunity({ overallScore: Number.NaN }) })).reasons,
    ).toContain("NO_SCORE");
    expect(
      evaluateHandoffEligibility(source({ opportunity: makeOpportunity({ risks: [] }) })).reasons,
    ).toContain("MISSING_RISKS");
  });

  it("blocks discovery readiness when evidence contradicts the conclusion", () => {
    const decision = evaluateResearchHandoffReadiness({
      conclusion: "REQUIRES_HUMAN_REVIEW",
      confidence: 0.72,
      evidenceCoverage: 0.9,
      contradictionCount: 2,
    });
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain("CONTRADICTIONS_PRESENT");
    expect(deriveHandoffStatus("REQUIRES_HUMAN_REVIEW", bundle({ contradictionCount: 2 }))).toBe("NOT_READY");
  });

  it("keeps the canonical human-review path open when a human accepted a contradicting run", () => {
    // The canonical path deliberately does not block on contradictions: that is
    // exactly the REQUIRES_HUMAN_REVIEW case a human already reviewed.
    const decision = evaluateHandoffEligibility(source({ conclusion: "REQUIRES_HUMAN_REVIEW" }));
    expect(decision.eligible).toBe(true);
    expect(decision.reasons).not.toContain("CONTRADICTIONS_PRESENT");
  });

  it("reports every failing reason at once rather than short-circuiting", () => {
    const decision = evaluateHandoffGate({
      conclusion: null,
      opportunityRejected: true,
      halalNotAllowed: true,
      hasEvidence: false,
      hasConfidence: false,
      hasScore: false,
      hasRisks: false,
      hasHypothesis: false,
    });
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        "OPPORTUNITY_REJECTED",
        "OPPORTUNITY_HALAL_NOT_ALLOWED",
        "NO_RESEARCH_RUN",
        "NO_EVIDENCE",
        "NO_CONFIDENCE",
        "NO_SCORE",
        "MISSING_EXPERIMENT_HYPOTHESIS",
        "MISSING_RISKS",
      ]),
    );
  });
});
