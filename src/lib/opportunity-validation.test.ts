import { describe, expect, it } from "vitest";
import { buildMonetizationSignal, buildOpportunityEvidenceBundle, providerHealthSummary, calculateOpportunityValidation } from "./opportunity-validation";
import type { ResearchRun, ValidationSignal } from "./research-types";
import type { OpportunityDecision } from "./opportunity-decision";
import type { OpportunityReadiness } from "./opportunity-readiness";

function emptyRun(overrides: Partial<ResearchRun> = {}): ResearchRun {
  return {
    id: "r1", opportunityId: "o1", status: "COMPLETED", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:01:00.000Z",
    queries: [], evidence: [], findings: [], validationSignals: [], confidence: 0, conclusion: "INSUFFICIENT_EVIDENCE", conclusionBasis: "none",
    providersAttempted: ["brave"], providersSucceeded: [], providerStatuses: [{ name: "brave", status: "CONFIG_ERROR", evidenceCount: 0, error: "not configured" }], errors: [], scoreIntegration: { suggestedOverallScore: null, factors: [] }, ...overrides,
  };
}

describe("buildMonetizationSignal", () => {
  it("does not invent monetization when commercial-intent is missing", () => {
    const signal: ValidationSignal = { key: "commercial-intent", label: "Commercial Intent", status: "INSUFFICIENT", evidenceIds: [], basis: "none" };
    expect(buildMonetizationSignal([signal]).status).toBe("INSUFFICIENT");
  });
  it("mirrors commercial-intent when evidence exists", () => {
    const signal: ValidationSignal = { key: "commercial-intent", label: "Commercial Intent", status: "SUPPORTED", evidenceIds: ["a", "b", "c"], basis: "3 items" };
    const result = buildMonetizationSignal([signal]);
    expect(result.status).toBe("SUPPORTED");
    expect(result.evidenceIds).toEqual(["a", "b", "c"]);
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

function readiness(overrides: Partial<OpportunityReadiness> = {}): OpportunityReadiness {
  return {
    readinessState: "EXPERIMENT_REQUIRED", readinessScore: 60, confidence: 0.5, blockers: [], missingEvidence: [], contradictions: [], staleResearch: false,
    researchFreshness: { kind: "CURRENT_RESEARCH", isStale: false, ageDays: 1, thresholdDays: 30, lastResearchAt: "2026-09-01T00:00:00Z" },
    experimentReadiness: { experimentCount: 0, realMetricPeriods: 0, estimatedMetricPeriods: 0, dataClass: "NONE", sufficient: false, decisions: [], contradictsResearch: false },
    recommendedNextAction: { action: "RUN_EXPERIMENT", basis: "test" }, explanation: [], dataClass: "REAL_DATA", generatedAt: "2026-09-02T00:00:00Z",
    ...overrides,
  } as OpportunityReadiness;
}
function decision(value: OpportunityDecision["decision"]): OpportunityDecision {
  return { decision: value, blockers: [], dataClass: "REAL_DATA" } as unknown as OpportunityDecision;
}

describe("calculateOpportunityValidation", () => {
  it("returns RESEARCH_REQUIRED for no research", () => {
    const result = calculateOpportunityValidation({ opportunityId: "o1", decision: decision("RESEARCH_MORE"), readiness: readiness({ researchFreshness: { kind: "NO_RESEARCH", isStale: true, ageDays: null, thresholdDays: 30, lastResearchAt: null } }) });
    expect(result.state).toBe("RESEARCH_REQUIRED");
  });

  it("does not call estimated-only measurements REAL_DATA", () => {
    const result = calculateOpportunityValidation({ opportunityId: "o1", decision: decision("VALIDATE"), readiness: readiness({ experimentReadiness: { ...readiness().experimentReadiness, estimatedMetricPeriods: 2 } }) });
    expect(result.considered.measurementStatus).toBe("ESTIMATED_DATA");
    expect(result.reasons.join(" ")).toContain("non-real");
  });

  it("blocks when the authoritative decision is blocked", () => {
    const result = calculateOpportunityValidation({ opportunityId: "o1", decision: decision("BLOCKED"), readiness: readiness({ readinessState: "BLOCKED" }) });
    expect(result.state).toBe("BLOCKED");
    expect(result.blockers.length).toBeGreaterThan(0);
  });
});
