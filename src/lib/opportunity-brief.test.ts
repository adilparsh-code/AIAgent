import { describe, expect, it } from "vitest";
import {
  buildIncomeLabHandoff,
  buildOpportunityBrief,
  deriveHandoffStatus,
  markHandoffPrepared,
  recommendedExperiment,
} from "./opportunity-brief";
import { buildOpportunityEvidenceBundle, buildMonetizationSignal } from "./opportunity-validation";
import { buildRankingBreakdown } from "./discovery-ranking";
import type { DiscoveryCandidateSeed } from "./discovery-types";
import type { ResearchRun, Evidence, ValidationSignal } from "./research-types";

const seed: DiscoveryCandidateSeed = {
  title: "Teacher worksheet pack",
  category: "education",
  problemHypothesis: "Hypothesis only.",
  targetAudience: "Teachers",
  researchTitle: "Teacher worksheet pack",
  normalizedKey: "teacher worksheet pack",
  opportunityCategory: "EDUCATIONAL_RESOURCES",
  businessModel: "EDUCATIONAL",
};

function runWith(evidence: Evidence[], conclusion: ResearchRun["conclusion"] = "INSUFFICIENT_EVIDENCE"): ResearchRun {
  return {
    id: "research-1",
    opportunityId: "opp-1",
    status: "COMPLETED",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    queries: [],
    evidence,
    findings: [],
    validationSignals: [],
    confidence: evidence.length ? 0.7 : 0,
    conclusion,
    conclusionBasis: "test",
    providersAttempted: ["brave"],
    providersSucceeded: evidence.length ? ["brave"] : [],
    providerStatuses: [
      { name: "brave", status: evidence.length ? "SUCCEEDED" : "EMPTY", evidenceCount: evidence.length, error: null },
    ],
    errors: [],
    scoreIntegration: { suggestedOverallScore: null, factors: [] },
  };
}

describe("opportunity brief / handoff", () => {
  it("never marks insufficient evidence as handoff-ready", () => {
    const research = runWith([]);
    const bundle = buildOpportunityEvidenceBundle(research);
    expect(deriveHandoffStatus(bundle.conclusion, bundle)).toBe("NOT_READY");
    expect(recommendedExperiment(bundle.conclusion, bundle)).toContain("Do not implement");
  });

  it("does not treat missing monetization as an option list", () => {
    const mixed: ValidationSignal = {
      key: "commercial-intent",
      label: "Commercial Intent",
      status: "INSUFFICIENT",
      evidenceIds: [],
      basis: "none",
    };
    expect(buildMonetizationSignal([mixed]).status).toBe("INSUFFICIENT");
  });

  it("builds a structured brief with evidence URLs and a contract-only handoff", () => {
    const research = runWith(
      [
        {
          id: "ev-1",
          source: "brave",
          title: "Demand",
          url: "https://example.com/demand",
          snippet: "Teachers buy worksheets",
          collectedAt: "2026-01-01T00:00:00.000Z",
          relevanceScore: 0.8,
          qualityScore: 0.8,
          hash: "h1",
          supports: ["demand"],
          contradicts: [],
          dataClass: "REAL_LIVE_DATA",
        },
      ],
      "PROMISING",
    );
    research.validationSignals = [
      { key: "demand", label: "Demand", status: "MIXED", evidenceIds: ["ev-1"], basis: "1 item" },
      { key: "pain-point", label: "Pain Point", status: "INSUFFICIENT", evidenceIds: [], basis: "none" },
      { key: "commercial-intent", label: "Commercial Intent", status: "INSUFFICIENT", evidenceIds: [], basis: "none" },
      { key: "trend", label: "Trend", status: "INSUFFICIENT", evidenceIds: [], basis: "none" },
      { key: "competition", label: "Competition", status: "INSUFFICIENT", evidenceIds: [], basis: "none" },
    ];
    const bundle = buildOpportunityEvidenceBundle(research);
    const ranking = buildRankingBreakdown(bundle, research.scoreIntegration);
    const brief = buildOpportunityBrief({
      candidateId: "cand-1",
      opportunityId: "opp-1",
      seed,
      run: research,
      bundle,
      ranking,
      handoffStatus: "NOT_READY",
      errors: [],
    });
    expect(brief.evidenceUrls).toEqual(["https://example.com/demand"]);
    expect(brief.demandEvidence.urls).toEqual(["https://example.com/demand"]);
    expect(brief.aiIncomeLabHandoffStatus).toBe("NOT_READY");

    const handoff = buildIncomeLabHandoff({
      candidateId: "cand-1",
      discoveryRunId: "disc-1",
      opportunityId: "opp-1",
      seed,
      bundle,
      ranking,
      brief,
      handoffStatus: "READY",
    });
    expect(handoff).toEqual(
      expect.objectContaining({
        opportunityId: "opp-1",
        candidateId: "cand-1",
        discoveryRunId: "disc-1",
        title: seed.title,
        handoffStatus: "READY",
      }),
    );
    expect(markHandoffPrepared(handoff).handoffStatus).toBe("PREPARED");
    expect(markHandoffPrepared({ ...handoff, handoffStatus: "NOT_READY" }).handoffStatus).toBe("NOT_READY");
  });
});
