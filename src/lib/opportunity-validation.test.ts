import { describe, expect, it } from "vitest";
import { buildMonetizationSignal, buildOpportunityEvidenceBundle, providerHealthSummary } from "./opportunity-validation";
import type { ResearchRun, ValidationSignal } from "./research-types";

function emptyRun(overrides: Partial<ResearchRun> = {}): ResearchRun {
  return {
    id: "r1",
    opportunityId: "o1",
    status: "COMPLETED",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    queries: [],
    evidence: [],
    findings: [],
    validationSignals: [],
    confidence: 0,
    conclusion: "INSUFFICIENT_EVIDENCE",
    conclusionBasis: "none",
    providersAttempted: ["brave"],
    providersSucceeded: [],
    providerStatuses: [{ name: "brave", status: "CONFIG_ERROR", evidenceCount: 0, error: "not configured" }],
    errors: [],
    scoreIntegration: { suggestedOverallScore: null, factors: [] },
    ...overrides,
  };
}

describe("buildMonetizationSignal", () => {
  it("does not invent monetization when commercial-intent is missing", () => {
    const signal: ValidationSignal = {
      key: "commercial-intent",
      label: "Commercial Intent",
      status: "INSUFFICIENT",
      evidenceIds: [],
      basis: "none",
    };
    expect(buildMonetizationSignal([signal]).status).toBe("INSUFFICIENT");
  });

  it("mirrors commercial-intent when evidence exists", () => {
    const signal: ValidationSignal = {
      key: "commercial-intent",
      label: "Commercial Intent",
      status: "SUPPORTED",
      evidenceIds: ["a", "b", "c"],
      basis: "3 items",
    };
    const result = buildMonetizationSignal([signal]);
    expect(result.status).toBe("SUPPORTED");
    expect(result.evidenceIds).toEqual(["a", "b", "c"]);
    expect(result.basis).toContain("commercial-intent");
  });
});

describe("buildOpportunityEvidenceBundle", () => {
  it("treats missing evidence as insufficient, not positive", () => {
    const bundle = buildOpportunityEvidenceBundle(emptyRun());
    expect(bundle.demand.status).toBe("INSUFFICIENT");
    expect(bundle.evidenceCoverage).toBe(0);
    expect(bundle.conclusion).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("reports provider health without inventing success", () => {
    const summary = providerHealthSummary([
      { name: "brave", status: "CONFIG_ERROR", evidenceCount: 0, error: "not configured" },
      { name: "reddit", status: "EMPTY", evidenceCount: 0, error: null },
    ]);
    expect(summary[0]).toContain("not configured");
    expect(summary[1]).toContain("empty");
  });
});
