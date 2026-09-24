import { describe, expect, it } from "vitest";
import { auditRealDataProvenance } from "./real-data-integrity";
import type { Evidence, ResearchRun } from "../research-types";

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "ev-1",
    source: "brave",
    title: "A source title",
    url: "https://example.com/source",
    snippet: "A source observation",
    collectedAt: "2026-09-24T00:00:00.000Z",
    relevanceScore: 0.8,
    qualityScore: 0.8,
    hash: "hash-1",
    supports: ["demand"],
    contradicts: [],
    dataClass: "REAL_LIVE_DATA",
    ...overrides,
  };
}

function run(items: Evidence[]): ResearchRun {
  return {
    id: "research-1",
    opportunityId: "opp-1",
    status: "COMPLETED",
    startedAt: "2026-09-24T00:00:00.000Z",
    completedAt: "2026-09-24T00:00:01.000Z",
    queries: [],
    evidence: items,
    findings: [],
    validationSignals: [],
    confidence: 0.5,
    conclusion: "PROMISING",
    conclusionBasis: "test",
    providersAttempted: ["brave"],
    providersSucceeded: ["brave"],
    providerStatuses: [{ name: "brave", status: "SUCCEEDED", evidenceCount: items.length, error: null }],
    errors: [],
    scoreIntegration: { suggestedOverallScore: null, factors: [] },
  };
}

describe("REAL_DATA provenance", () => {
  it("retains a complete live observation", () => {
    const result = auditRealDataProvenance(run([evidence()]), { healthyProviders: ["brave"] });
    expect(result.realDataCount).toBe(1);
    expect(result.run.evidence[0]?.dataClass).toBe("REAL_LIVE_DATA");
  });

  it("downgrades live claims without provider health", () => {
    const result = auditRealDataProvenance(run([evidence()]), { healthyProviders: [] });
    expect(result.realDataCount).toBe(0);
    expect(result.run.evidence[0]?.dataClass).toBe("AI_ESTIMATE");
    expect(result.rejectedEvidenceIds).toEqual(["ev-1"]);
  });

  it("never upgrades sample or estimated data", () => {
    const result = auditRealDataProvenance(run([
      evidence({ id: "sample", dataClass: "SAMPLE_DATA" }),
      evidence({ id: "estimated", dataClass: "AI_ESTIMATE" }),
    ]), { healthyProviders: ["brave"] });
    expect(result.run.evidence.map((item) => item.dataClass)).toEqual(["SAMPLE_DATA", "AI_ESTIMATE"]);
    expect(result.realDataCount).toBe(0);
  });

  it("rejects missing source URL, timestamp, or attributable text", () => {
    const result = auditRealDataProvenance(run([
      evidence({ id: "url", url: "not-a-url" }),
      evidence({ id: "time", collectedAt: "not-a-date" }),
      evidence({ id: "text", snippet: "" }),
    ]), { healthyProviders: ["brave"] });
    expect(result.rejectedEvidenceIds).toEqual(["url", "time", "text"]);
    expect(result.run.evidence.every((item) => item.dataClass === "AI_ESTIMATE")).toBe(true);
  });
});
