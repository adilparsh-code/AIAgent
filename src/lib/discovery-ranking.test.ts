import { describe, expect, it } from "vitest";
import { buildRankingBreakdown, compareCandidatesForRank } from "./discovery-ranking";
import type { OpportunityEvidenceBundle } from "./discovery-types";
import type { ValidationSignal } from "./research-types";

function signal(key: string, status: ValidationSignal["status"]): ValidationSignal {
  return {
    key,
    label: key,
    status,
    evidenceIds: status === "INSUFFICIENT" ? [] : [`${key}-1`],
    basis: status === "INSUFFICIENT" ? "No evidence collected. Missing data is not positive evidence." : "1 item",
  };
}

function bundle(overrides: Partial<OpportunityEvidenceBundle> = {}): OpportunityEvidenceBundle {
  const demand = overrides.demand ?? signal("demand", "INSUFFICIENT");
  return {
    demand,
    painPoint: signal("pain-point", "INSUFFICIENT"),
    trend: signal("trend", "INSUFFICIENT"),
    commercialIntent: signal("commercial-intent", "INSUFFICIENT"),
    competition: signal("competition", "INSUFFICIENT"),
    monetization: signal("monetization", "INSUFFICIENT"),
    evidenceQuality: 0,
    evidenceCoverage: 0,
    sourceDiversity: 0,
    contradictionCount: 0,
    providerStatuses: [],
    contradictions: [],
    conclusion: "INSUFFICIENT_EVIDENCE",
    conclusionBasis: "none",
    confidence: 0,
    ...overrides,
  };
}

describe("buildRankingBreakdown", () => {
  it("scores missing evidence as 0 and unmeasured, never as support", () => {
    const ranking = buildRankingBreakdown(bundle(), { suggestedOverallScore: null, factors: [] });
    expect(ranking.rankingScore).toBe(0);
    expect(ranking.calculatedScore).toBeNull();
    expect(ranking.aiEstimateScore).toBeNull();
    expect(ranking.factors.find((item) => item.key === "demand")?.provenance).toBe("unmeasured");
    expect(ranking.factors.find((item) => item.key === "ai-estimate")?.provenance).toBe("ai-estimate");
    expect(ranking.note).toContain("Missing data is not support");
  });

  it("keeps evidence-backed values separate from the calculated engine suggestion", () => {
    const ranking = buildRankingBreakdown(
      bundle({
        demand: signal("demand", "SUPPORTED"),
        commercialIntent: signal("commercial-intent", "MIXED"),
        monetization: signal("monetization", "MIXED"),
        evidenceCoverage: 4,
        sourceDiversity: 2,
        evidenceQuality: 0.8,
        confidence: 0.7,
        conclusion: "PROMISING",
      }),
      { suggestedOverallScore: 61.2, factors: [] },
    );
    expect(ranking.evidenceBackedScore).toBeGreaterThan(0);
    expect(ranking.calculatedScore).toBe(61.2);
    expect(ranking.aiEstimateScore).toBeNull();
    expect(ranking.factors.find((item) => item.key === "demand")?.provenance).toBe("evidence-backed");
    expect(ranking.factors.find((item) => item.key === "research-suggested-overall")?.provenance).toBe("calculated");
  });

  it("caps contradicted opportunities", () => {
    const ranking = buildRankingBreakdown(
      bundle({
        demand: signal("demand", "MIXED"),
        evidenceCoverage: 3,
        sourceDiversity: 1,
        contradictionCount: 4,
        confidence: 0.9,
        conclusion: "CONTRADICTED",
      }),
      { suggestedOverallScore: 80, factors: [] },
    );
    expect(ranking.rankingScore).toBeLessThanOrEqual(20);
  });
});

describe("compareCandidatesForRank", () => {
  it("places evidenced candidates above empty ones regardless of a leftover score", () => {
    const cmp = compareCandidatesForRank(
      { rankingScore: 90, evidenceCoverage: 0, contradictionCount: 0, confidence: 1 },
      { rankingScore: 10, evidenceCoverage: 4, contradictionCount: 0, confidence: 0.4 },
    );
    expect(cmp).toBeGreaterThan(0);
  });
});
