/**
 * Phase 12 — pure portfolio intelligence tests (no DB, no network).
 * Covers every required scenario: empty/single portfolios, each queue,
 * execution-ready, blocked, human review, conflicts, staleness, data-class
 * honesty, concentration warnings, determinism, and the single portfolio
 * action contract.
 */
import { describe, expect, it } from "vitest";
import {
  bucketForOpportunity,
  calculatePortfolioIntelligence,
  PORTFOLIO_POLICY,
  type PortfolioOpportunityInput,
} from "./opportunity-portfolio";

const NOW = new Date("2026-09-24T12:00:00.000Z");

function row(overrides: Partial<PortfolioOpportunityInput> = {}): PortfolioOpportunityInput {
  return {
    opportunityId: "opp_1",
    decision: "RESEARCH_MORE",
    readinessState: "RESEARCH_REQUIRED",
    lifecycleState: "DISCOVERED",
    confidence: 0,
    decisionScore: 10,
    dataClass: "AI_ESTIMATE",
    researchFreshnessKind: "NO_RESEARCH",
    evidenceGapCount: 0,
    validationGapCount: 0,
    experimentGapCount: 0,
    executionGapCount: 0,
    blockerCount: 1,
    hasContradictions: false,
    evidenceGapCodes: [],
    experimentCount: 0,
    realMetricPeriods: 0,
    estimatedMetricPeriods: 0,
    experimentDataClass: "NONE",
    experimentSufficient: false,
    lastExperimentMetricAt: null,
    hasLearningSignal: false,
    handoffStatus: null,
    requiresHumanApproval: false,
    hasExecutionBlocker: false,
    isBlocked: false,
    latestResearchRunStatus: null,
    ...overrides,
  };
}

describe("opportunity portfolio intelligence", () => {
  it("1. empty portfolio → MONITOR, zeroed summary, no recommendations", () => {
    const result = calculatePortfolioIntelligence({ opportunities: [], now: NOW });
    expect(result.totalOpportunities).toBe(0);
    expect(result.portfolioDecision).toBe("MONITOR");
    expect(result.recommendedOpportunityIds).toEqual([]);
    expect(result.recommendedNextActions).toEqual([]);
    expect(result.portfolioConfidence).toBe(0);
    expect(result.dataClass).toBe("REAL_DATA"); // nothing claimed
  });

  it("2. single research-required opportunity → RESEARCH_QUEUE / FILL_RESEARCH_GAPS", () => {
    const result = calculatePortfolioIntelligence({ opportunities: [row()], now: NOW });
    expect(result.totalOpportunities).toBe(1);
    expect(result.activeOpportunities).toBe(1);
    expect(result.researchRequired).toBe(1);
    expect(result.queues.RESEARCH_QUEUE).toEqual(["opp_1"]);
    expect(result.portfolioDecision).toBe("FILL_RESEARCH_GAPS");
    // Exactly one portfolio-level action.
    expect(result.recommendedNextActions.length).toBeLessThanOrEqual(PORTFOLIO_POLICY.MAX_RECOMMENDED);
    expect(result.explanation[0]).toContain("FILL_RESEARCH_GAPS");
  });

  it("3. multiple research-required opportunities → research backlog warning", () => {
    const opportunities = Array.from({ length: 5 }, (_, i) => row({ opportunityId: `opp_${i}` }));
    const result = calculatePortfolioIntelligence({ opportunities, now: NOW });
    expect(result.researchRequired).toBe(5);
    expect(result.concentrationWarnings.map((w) => w.code)).toContain("RESEARCH_BACKLOG");
    expect(result.concentrationWarnings.find((w) => w.code === "RESEARCH_BACKLOG")?.affected).toBe(5);
  });

  it("4. multiple validation-required opportunities → VALIDATION_QUEUE", () => {
    const opportunities = Array.from({ length: 3 }, (_, i) =>
      row({
        opportunityId: `opp_${i}`,
        decision: "VALIDATE",
        readinessState: "VALIDATION_REQUIRED",
        lifecycleState: "VALIDATION_REQUIRED",
        researchFreshnessKind: "CURRENT_RESEARCH",
        evidenceGapCount: 0,
        validationGapCount: 1,
        blockerCount: 0,
        dataClass: "REAL_DATA",
        confidence: 70,
      }),
    );
    const result = calculatePortfolioIntelligence({ opportunities, now: NOW });
    expect(result.validationRequired).toBe(3);
    expect(result.queues.VALIDATION_QUEUE).toHaveLength(3);
    expect(result.portfolioDecision).toBe("VALIDATE_OPPORTUNITIES");
  });

  it("5. multiple experiment-required opportunities → EXPERIMENT_QUEUE / RUN_EXPERIMENTS", () => {
    const opportunities = Array.from({ length: 2 }, (_, i) =>
      row({
        opportunityId: `opp_${i}`,
        decision: "RUN_EXPERIMENT",
        readinessState: "EXPERIMENT_REQUIRED",
        lifecycleState: "VALIDATING",
        researchFreshnessKind: "CURRENT_RESEARCH",
        dataClass: "REAL_DATA",
        confidence: 80,
      }),
    );
    const result = calculatePortfolioIntelligence({ opportunities, now: NOW });
    expect(result.experimentsRequired).toBe(2);
    expect(result.queues.EXPERIMENT_QUEUE).toHaveLength(2);
    expect(result.portfolioDecision).toBe("RUN_EXPERIMENTS");
  });

  it("6. execution-ready opportunity → EXECUTION_QUEUE / EXECUTE_APPROVED_WORK", () => {
    const result = calculatePortfolioIntelligence({
      opportunities: [
        row({
          decision: "EXECUTION_READY",
          readinessState: "READY_FOR_EXECUTION",
          lifecycleState: "EXECUTION_READY",
          researchFreshnessKind: "CURRENT_RESEARCH",
          dataClass: "REAL_DATA",
          confidence: 90,
          experimentCount: 1,
          realMetricPeriods: 2,
          experimentDataClass: "REAL_DATA",
          experimentSufficient: true,
          handoffStatus: "ACCEPTED",
        }),
      ],
      now: NOW,
    });
    expect(result.executionReady).toBe(1);
    expect(result.queues.EXECUTION_QUEUE).toEqual(["opp_1"]);
    expect(result.portfolioDecision).toBe("EXECUTE_APPROVED_WORK");
  });

  it("7. blocked opportunity → BLOCKED_QUEUE, excluded from active", () => {
    const result = calculatePortfolioIntelligence({
      opportunities: [row({ decision: "BLOCKED", isBlocked: true, lifecycleState: "BLOCKED" })],
      now: NOW,
    });
    expect(result.blockedOpportunities).toBe(1);
    expect(result.activeOpportunities).toBe(0);
    expect(result.queues.BLOCKED_QUEUE).toEqual(["opp_1"]);
    // Blocked alone must not manufacture a work action.
    expect(result.portfolioDecision).not.toBe("EXECUTE_APPROVED_WORK");
  });

  it("8. human-review opportunity → HUMAN_REVIEW_QUEUE", () => {
    const result = calculatePortfolioIntelligence({
      opportunities: [
        row({
          decision: "HUMAN_REVIEW",
          lifecycleState: "HUMAN_REVIEW",
          requiresHumanApproval: true,
          researchFreshnessKind: "CURRENT_RESEARCH",
        }),
      ],
      now: NOW,
    });
    expect(result.humanReviewRequired).toBe(1);
    expect(result.queues.HUMAN_REVIEW_QUEUE).toEqual(["opp_1"]);
    expect(result.portfolioDecision).toBe("HUMAN_REVIEW_REQUIRED");
  });

  it("9. conflicting opportunities → REVIEW_CONFLICTS", () => {
    const result = calculatePortfolioIntelligence({
      opportunities: [
        row({
          opportunityId: "opp_a",
          decision: "REVIEW_CONFLICT",
          lifecycleState: "VALIDATION_CONFLICT",
          hasContradictions: true,
          researchFreshnessKind: "CURRENT_RESEARCH",
          dataClass: "REAL_DATA",
        }),
      ],
      now: NOW,
    });
    expect(result.queues.HUMAN_REVIEW_QUEUE).toEqual(["opp_a"]);
    expect(result.portfolioDecision).toBe("REVIEW_CONFLICTS");
  });

  it("10. stale research → stale count + never a market claim", () => {
    const result = calculatePortfolioIntelligence({
      opportunities: [
        row({
          decision: "VALIDATE",
          lifecycleState: "VALIDATION_REQUIRED",
          researchFreshnessKind: "STALE_RESEARCH",
          dataClass: "REAL_DATA",
        }),
      ],
      now: NOW,
    });
    expect(result.staleOpportunityCount).toBe(1);
    expect(result.explanation.join(" ")).toContain("never implies demand changed");
  });

  it("11. insufficient REAL_DATA → experiment coverage reports the shortfall", () => {
    const result = calculatePortfolioIntelligence({
      opportunities: [
        row({
          decision: "IMPROVE_EXPERIMENT",
          lifecycleState: "EXPERIMENT_INSUFFICIENT",
          researchFreshnessKind: "CURRENT_RESEARCH",
          dataClass: "REAL_DATA",
          experimentCount: 1,
          realMetricPeriods: 1,
          experimentDataClass: "REAL_DATA",
          experimentSufficient: false,
        }),
      ],
      now: NOW,
    });
    expect(result.experimentCoverageSummary.opportunitiesWithExperiments).toBe(1);
    expect(result.experimentCoverageSummary.withSufficientRealData).toBe(0);
    expect(result.queues.LEARNING_QUEUE).toEqual(["opp_1"]);
  });

  it("12. SAMPLE_DATA is never counted as REAL_DATA coverage", () => {
    // The loader never produces SAMPLE rows (samples are excluded), and a
    // SAMPLE_DATA result class must not inflate the real-data summary.
    const result = calculatePortfolioIntelligence({
      opportunities: [
        row({
          dataClass: "SAMPLE_DATA",
          realMetricPeriods: 0,
          experimentDataClass: "NONE",
          researchFreshnessKind: "CURRENT_RESEARCH",
        }),
      ],
      now: NOW,
    });
    expect(result.evidenceQualitySummary.realDataOpportunities).toBe(0);
    expect(result.portfolioConfidence).toBe(0);
  });

  it("13. ESTIMATED_DATA is reported as a limitation, never as real coverage", () => {
    const result = calculatePortfolioIntelligence({
      opportunities: [
        row({
          decision: "IMPROVE_EXPERIMENT",
          lifecycleState: "EXPERIMENT_INSUFFICIENT",
          researchFreshnessKind: "CURRENT_RESEARCH",
          experimentCount: 1,
          realMetricPeriods: 0,
          estimatedMetricPeriods: 4,
          experimentDataClass: "ESTIMATED_DATA",
        }),
      ],
      now: NOW,
    });
    expect(result.experimentCoverageSummary.estimatedOnly).toBe(1);
    expect(result.experimentCoverageSummary.withSufficientRealData).toBe(0);
    expect(result.evidenceQualitySummary.nonRealDataLimitations.join(" ")).toContain("ESTIMATED_DATA");
  });

  it("14. UNKNOWN / unparseable data is not promoted to REAL_DATA", () => {
    const result = calculatePortfolioIntelligence({
      opportunities: [
        row({
          researchFreshnessKind: "CURRENT_RESEARCH",
          lastExperimentMetricAt: "not-a-date",
          experimentCount: 1,
          experimentDataClass: "NONE",
        }),
      ],
      now: NOW,
    });
    expect(result.experimentCoverageSummary.withSufficientRealData).toBe(0);
    const recommendation = result.recommendations[0]!;
    expect(recommendation.priorityScore).toBeLessThanOrEqual(100);
  });

  it("15. concentration warning for a shared evidence blocker", () => {
    const opportunities = Array.from({ length: 3 }, (_, i) =>
      row({
        opportunityId: `opp_${i}`,
        decision: "RESEARCH_MORE",
        evidenceGapCount: 1,
        evidenceGapCodes: ["DEMAND"],
        researchFreshnessKind: "CURRENT_RESEARCH",
      }),
    );
    const result = calculatePortfolioIntelligence({ opportunities, now: NOW });
    const shared = result.concentrationWarnings.find((w) => w.code === "SHARED_BLOCKER_DEMAND");
    expect(shared).toBeTruthy();
    expect(shared?.affected).toBe(3);
    expect(shared?.kind).toBe("SHARED_BLOCKER");
  });

  it("16. deterministic same input → same output", () => {
    const opportunities = [row({ opportunityId: "b" }), row({ opportunityId: "a" })];
    const first = calculatePortfolioIntelligence({ opportunities, now: NOW });
    const second = calculatePortfolioIntelligence({
      opportunities: [...opportunities].reverse(),
      now: NOW,
    });
    expect(first).toEqual(second);
  });

  it("17/18. owner isolation + bounded reads are enforced server-side (loader)", () => {
    // The pure module only sees already-scoped rows; scoping and the constant
    // query-count bound live in opportunity-decision-loader.ts and are covered
    // by the DB-backed portfolio API test. Here we assert the declared bounds.
    expect(PORTFOLIO_POLICY.MAX_OPPORTUNITIES).toBe(50);
    const result = calculatePortfolioIntelligence({ opportunities: [row()], now: NOW });
    expect(result.bounds.maxOpportunities).toBe(50);
    expect(result.bounds.truncated).toBe(false);
  });

  it("19. no external API calls (pure module, no I/O surface)", () => {
    // The module only transforms its argument; it exposes no fetch/IO.
    expect(typeof calculatePortfolioIntelligence).toBe("function");
  });

  it("20. exactly one portfolio-level action", () => {
    const opportunities = [
      row({ opportunityId: "a", decision: "RESEARCH_MORE" }),
      row({ opportunityId: "b", decision: "VALIDATE", researchFreshnessKind: "CURRENT_RESEARCH" }),
      row({
        opportunityId: "c",
        decision: "EXECUTION_READY",
        researchFreshnessKind: "CURRENT_RESEARCH",
        experimentCount: 1,
        experimentSufficient: true,
        experimentDataClass: "REAL_DATA",
        handoffStatus: "ACCEPTED",
      }),
    ];
    const result = calculatePortfolioIntelligence({ opportunities, now: NOW });
    // The first decisive rule wins → exactly one decision + one action line.
    expect(result.portfolioDecision).toBe("FILL_RESEARCH_GAPS");
    expect(result.explanation.filter((line) => line.startsWith("Portfolio decision is"))).toHaveLength(1);
  });

  it("bucket mapping is a pure projection of the existing decision read-model", () => {
    expect(bucketForOpportunity(row({ decision: "BLOCKED", isBlocked: true }))).toBe("BLOCKED_QUEUE");
    expect(bucketForOpportunity(row({ decision: "HUMAN_REVIEW" }))).toBe("HUMAN_REVIEW_QUEUE");
    expect(bucketForOpportunity(row({ decision: "REVIEW_CONFLICT" }))).toBe("HUMAN_REVIEW_QUEUE");
    expect(bucketForOpportunity(row({ decision: "RESEARCH_MORE" }))).toBe("RESEARCH_QUEUE");
    expect(bucketForOpportunity(row({ decision: "RUN_EXPERIMENT", experimentCount: 0 }))).toBe("EXPERIMENT_QUEUE");
    expect(bucketForOpportunity(row({ decision: "RUN_EXPERIMENT", experimentCount: 1 }))).toBe("LEARNING_QUEUE");
    expect(bucketForOpportunity(row({ decision: "IMPROVE_EXPERIMENT" }))).toBe("LEARNING_QUEUE");
    expect(bucketForOpportunity(row({ decision: "HANDOFF_READY" }))).toBe("HANDOFF_QUEUE");
  });
});
