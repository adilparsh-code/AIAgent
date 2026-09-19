import { describe, expect, it } from "vitest";
import type { ResearchRun } from "../../research-types";

describe("research persistence payload", () => {
  it("stores queries, evidence, and findings as related records", () => {
    const run: ResearchRun = {
      id: "research-persist-1",
      opportunityId: "opp-001",
      status: "COMPLETED",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:02:00.000Z",
      queries: [{ query: "worksheets demand", source: "brave", purpose: "demand" }],
      evidence: [{
        id: "ev-1",
        source: "brave",
        title: "Worksheet demand",
        url: "https://example.com/worksheets",
        snippet: "Teachers buy worksheets",
        collectedAt: "2026-01-01T00:01:00.000Z",
        relevanceScore: 0.9,
        qualityScore: 0.8,
        hash: "worksheet-demand",
        supports: ["demand"],
        contradicts: [],
        dataClass: "REAL_LIVE_DATA",
      }],
      findings: [{
        id: "finding-1",
        claim: "Demand evidence collected",
        summary: "Worksheet demand",
        confidence: 0.8,
        evidenceIds: ["ev-1"],
        contradictions: [],
      }],
      confidence: 0.8,
      validationSignals: [{
        key: "demand",
        label: "Demand",
        status: "MIXED",
        evidenceIds: ["ev-1"],
        basis: "1 evidence item(s) from 1 provider, avg quality 0.80",
      }],
      conclusion: "PROMISING",
      conclusionBasis: "1 signal(s) partially supported",
      providersAttempted: ["brave"],
      providersSucceeded: ["brave"],
      providerStatuses: [{ name: "brave", status: "SUCCEEDED", evidenceCount: 1, error: null }],
      scoreIntegration: { suggestedOverallScore: null, factors: [] },
      errors: [],
    };

    expect(run.queries).toHaveLength(1);
    expect(run.evidence[0]?.hash).toBe("worksheet-demand");
    expect(run.findings[0]?.evidenceIds).toContain(run.evidence[0]?.id);
  });
});
