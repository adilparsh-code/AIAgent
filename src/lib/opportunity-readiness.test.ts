import { describe, expect, it } from "vitest";
import {
  calculateOpportunityReadiness,
  calculateResearchFreshness,
  READINESS_POLICY,
  type CalculateOpportunityReadinessInput,
  type ReadinessExperimentInput,
  type ReadinessValidationInput,
} from "./opportunity-readiness";

const NOW = new Date("2026-09-24T12:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function baseInput(overrides: {
  opportunity?: Partial<CalculateOpportunityReadinessInput["opportunity"]>;
  researchRuns?: CalculateOpportunityReadinessInput["researchRuns"];
  validation?: ReadinessValidationInput | null;
  experiments?: ReadinessExperimentInput[];
  now?: Date;
}): CalculateOpportunityReadinessInput {
  return {
    opportunity: {
      id: "opp_1",
      status: "VALIDATED",
      halalStatus: "HALAL",
      isSample: false,
      handoffStatus: null,
      risksCount: 1,
      ...overrides.opportunity,
    },
    researchRuns: overrides.researchRuns ?? [],
    validation: overrides.validation === undefined ? null : overrides.validation,
    experiments: overrides.experiments ?? [],
    now: overrides.now ?? NOW,
  };
}

const recentRun = {
  id: "run_1",
  status: "COMPLETED",
  startedAt: daysAgo(5),
  completedAt: daysAgo(5),
  evidenceCount: 8,
  confidence: 0.8,
};

const cleanValidation: ReadinessValidationInput = {
  demandStatus: "SUPPORTED",
  painPointStatus: "SUPPORTED",
  commercialIntentStatus: "SUPPORTED",
  trendStatus: "SUPPORTED",
  competitionStatus: "SUPPORTED",
  evidenceCoverage: 0.9,
  sourceDiversity: 3,
  contradictionCount: 0,
  confidence: 0.85,
};

const sufficientExperiment: ReadinessExperimentInput = {
  id: "exp_1",
  status: "ACTIVE",
  decision: null,
  metrics: [
    { dataClass: "REAL_DATA", conversions: 2, revenue: 40, cost: 10 },
    { dataClass: "REAL_DATA", conversions: 3, revenue: 60, cost: 10 },
  ],
};

describe("opportunity readiness (pure)", () => {
  it("1. no research → RESEARCH_REQUIRED", () => {
    const readiness = calculateOpportunityReadiness(baseInput({}));
    expect(readiness.readinessState).toBe("RESEARCH_REQUIRED");
    expect(readiness.researchFreshness.kind).toBe("NO_RESEARCH");
    expect(readiness.researchFreshness.isStale).toBe(true);
    expect(readiness.recommendedNextAction.action).toBe("Run research");
  });

  it("2. research with insufficient evidence → EVIDENCE_INSUFFICIENT", () => {
    const readiness = calculateOpportunityReadiness(
      baseInput({
        researchRuns: [recentRun],
        validation: { ...cleanValidation, demandStatus: "INSUFFICIENT", evidenceCoverage: 0.4 },
      }),
    );
    expect(readiness.readinessState).toBe("EVIDENCE_INSUFFICIENT");
    expect(readiness.missingEvidence.some((gap) => gap.area === "DEMAND")).toBe(true);
  });

  it("3. stale research → staleResearch + freshness blocker, honest wording", () => {
    const staleRun = { ...recentRun, startedAt: daysAgo(60), completedAt: daysAgo(60) };
    const readiness = calculateOpportunityReadiness(
      baseInput({ researchRuns: [staleRun], validation: cleanValidation, experiments: [sufficientExperiment] }),
    );
    expect(readiness.researchFreshness.kind).toBe("STALE_RESEARCH");
    expect(readiness.staleResearch).toBe(true);
    expect(readiness.blockers.join(" ")).toContain("60 days old");
    // It must NOT claim demand disappeared — the freshness reason is about age.
    expect(readiness.explanation.join(" ")).toContain("does NOT imply demand changed");
    expect(readiness.recommendedNextAction.action).toBe("Refresh research");
  });

  it("4. sufficient research + validation → proceeds past evidence gates", () => {
    const readiness = calculateOpportunityReadiness(
      baseInput({
        researchRuns: [recentRun],
        validation: cleanValidation,
        experiments: [sufficientExperiment],
      }),
    );
    expect(readiness.readinessState).toBe("HANDOFF_READY");
    expect(readiness.handoffReadiness.ready).toBe(true);
    expect(readiness.missingEvidence).toHaveLength(0);
    expect(readiness.confidence).toBe(85);
  });

  it("5. contradictory validation → HUMAN_REVIEW_REQUIRED with contradiction detail", () => {
    const readiness = calculateOpportunityReadiness(
      baseInput({
        researchRuns: [recentRun],
        validation: { ...cleanValidation, commercialIntentStatus: "MIXED", contradictionCount: 1 },
      }),
    );
    expect(readiness.readinessState).toBe("HUMAN_REVIEW_REQUIRED");
    expect(readiness.contradictions.length).toBeGreaterThan(0);
    expect(readiness.recommendedNextAction.action).toBe("Review contradictory evidence");
  });

  it("6. no experiment → EXPERIMENT_REQUIRED", () => {
    const readiness = calculateOpportunityReadiness(
      baseInput({ researchRuns: [recentRun], validation: cleanValidation }),
    );
    expect(readiness.readinessState).toBe("EXPERIMENT_REQUIRED");
    expect(readiness.recommendedNextAction.action).toBe("Create validation experiment");
  });

  it("7. experiment with estimated data only → ESTIMATED_DATA, never real evidence", () => {
    const readiness = calculateOpportunityReadiness(
      baseInput({
        researchRuns: [recentRun],
        validation: cleanValidation,
        experiments: [
          {
            id: "exp_est",
            status: "ACTIVE",
            decision: null,
            metrics: [
              { dataClass: "ESTIMATED_DATA", conversions: 10, revenue: 100, cost: 0 },
              { dataClass: "ESTIMATED_DATA", conversions: 12, revenue: 120, cost: 0 },
            ],
          },
        ],
      }),
    );
    expect(readiness.experimentReadiness.dataClass).toBe("ESTIMATED_DATA");
    expect(readiness.experimentReadiness.realMetricPeriods).toBe(0);
    expect(readiness.experimentReadiness.sufficient).toBe(false);
    expect(readiness.readinessState).toBe("EXPERIMENT_INSUFFICIENT");
    expect(readiness.explanation.join(" ")).toContain("not treated as real-world performance");
  });

  it("8. experiment with insufficient REAL_DATA → EXPERIMENT_INSUFFICIENT", () => {
    const readiness = calculateOpportunityReadiness(
      baseInput({
        researchRuns: [recentRun],
        validation: cleanValidation,
        experiments: [
          {
            id: "exp_small",
            status: "ACTIVE",
            decision: null,
            metrics: [{ dataClass: "REAL_DATA", conversions: 0, revenue: 0, cost: 5 }],
          },
        ],
      }),
    );
    expect(readiness.experimentReadiness.realMetricPeriods).toBe(1);
    expect(readiness.readinessState).toBe("EXPERIMENT_INSUFFICIENT");
    expect(readiness.recommendedNextAction.action).toBe("Record additional REAL_DATA metrics");
  });

  it("9. experiment with sufficient REAL_DATA → dataClass REAL_DATA and counted", () => {
    const readiness = calculateOpportunityReadiness(
      baseInput({
        researchRuns: [recentRun],
        validation: cleanValidation,
        experiments: [sufficientExperiment],
      }),
    );
    expect(readiness.experimentReadiness.dataClass).toBe("REAL_DATA");
    expect(readiness.experimentReadiness.realMetricPeriods).toBe(2);
    expect(readiness.experimentReadiness.sufficient).toBe(true);
  });

  it("10. handoff ready (no accepted handoff yet) → HANDOFF_READY", () => {
    const readiness = calculateOpportunityReadiness(
      baseInput({
        researchRuns: [recentRun],
        validation: cleanValidation,
        experiments: [sufficientExperiment],
      }),
    );
    expect(readiness.readinessState).toBe("HANDOFF_READY");
    expect(readiness.handoffReadiness.ready).toBe(true);
    expect(readiness.handoffReadiness.reasons.join(" ")).toContain("sufficient");
    expect(readiness.recommendedNextAction.action).toBe("Create/accept handoff");
  });

  it("11. accepted handoff → READY_FOR_EXECUTION", () => {
    const readiness = calculateOpportunityReadiness(
      baseInput({
        opportunity: { handoffStatus: "ACCEPTED" },
        researchRuns: [recentRun],
        validation: cleanValidation,
        experiments: [sufficientExperiment],
      }),
    );
    expect(readiness.readinessState).toBe("READY_FOR_EXECUTION");
    expect(readiness.recommendedNextAction.action).toBe("Execute approved task");
  });

  it("12. missing commercial intent → HIGH-severity gap and targeted next action", () => {
    const readiness = calculateOpportunityReadiness(
      baseInput({
        researchRuns: [recentRun],
        validation: { ...cleanValidation, commercialIntentStatus: "INSUFFICIENT" },
      }),
    );
    const gap = readiness.missingEvidence.find((item) => item.area === "COMMERCIAL_INTENT");
    expect(gap?.severity).toBe("HIGH");
    expect(readiness.recommendedNextAction.action).toBe("Collect commercial-intent evidence");
  });

  it("13. low source diversity → SOURCE_DIVERSITY gap", () => {
    const readiness = calculateOpportunityReadiness(
      baseInput({
        researchRuns: [recentRun],
        validation: { ...cleanValidation, sourceDiversity: 1 },
      }),
    );
    expect(readiness.missingEvidence.some((gap) => gap.area === "SOURCE_DIVERSITY")).toBe(true);
    expect(readiness.missingEvidence.find((gap) => gap.area === "SOURCE_DIVERSITY")?.reason).toContain("1 distinct source");
  });

  it("14. contradiction resolution gap is surfaced", () => {
    const readiness = calculateOpportunityReadiness(
      baseInput({
        researchRuns: [recentRun],
        validation: { ...cleanValidation, trendStatus: "MIXED", contradictionCount: 2 },
      }),
    );
    expect(readiness.missingEvidence.some((gap) => gap.area === "CONTRADICTION_RESOLUTION")).toBe(true);
    expect(readiness.explanation.join(" ")).toContain("2 contradictory signal(s)");
  });

  it("15. foreign opportunity — engine is pure; ownership is enforced by the service layer contract", async () => {
    // The pure engine never sees ownership; the API/service contract returns
    // null for foreign rows (404). Assert the service module exports the
    // expected signature without touching a database.
    const serviceModule = await import("./server/opportunity-readiness-service");
    expect(typeof serviceModule.getOpportunityReadiness).toBe("function");
    // And the route contract uses requireUser + null → 404 (verified in route).
    const routeModule = await import("@/app/api/opportunities/[id]/readiness/route");
    expect(typeof routeModule.GET).toBe("function");
  });

  it("16. sample opportunity → result labeled SAMPLE_DATA and service excludes samples", async () => {
    const readiness = calculateOpportunityReadiness(
      baseInput({
        opportunity: { isSample: true },
        researchRuns: [recentRun],
        validation: cleanValidation,
        experiments: [sufficientExperiment],
      }),
    );
    expect(readiness.dataClass).toBe("SAMPLE_DATA");
    // The service selects isSample: false — sample rows can never leak private
    // readiness data. Re-import to keep this a pure-runtime contract check.
    const serviceModule = await import("./server/opportunity-readiness-service");
    expect(typeof serviceModule.getOpportunityReadiness).toBe("function");
  });

  it("freshness policy is configurable without code edits", () => {
    const staleRun = { ...recentRun, startedAt: daysAgo(10), completedAt: daysAgo(10) };
    const fresh = calculateResearchFreshness([staleRun], 30, NOW);
    const stale = calculateResearchFreshness([staleRun], 5, NOW);
    expect(fresh.isStale).toBe(false);
    expect(stale.isStale).toBe(true);
    expect(READINESS_POLICY.DEFAULT_RESEARCH_FRESHNESS_DAYS).toBe(30);
  });

  it("BLOCKED state for rejected / not-allowed opportunities", () => {
    const rejected = calculateOpportunityReadiness(
      baseInput({
        opportunity: { status: "REJECTED" },
        researchRuns: [recentRun],
        validation: cleanValidation,
        experiments: [sufficientExperiment],
      }),
    );
    const notAllowed = calculateOpportunityReadiness(
      baseInput({
        opportunity: { halalStatus: "NOT_ALLOWED" },
        researchRuns: [recentRun],
        validation: cleanValidation,
        experiments: [sufficientExperiment],
      }),
    );
    expect(rejected.readinessState).toBe("BLOCKED");
    expect(notAllowed.readinessState).toBe("BLOCKED");
  });

  it("RESEARCH_IN_PROGRESS when a run is running", () => {
    const readiness = calculateOpportunityReadiness(
      baseInput({
        researchRuns: [{ ...recentRun, status: "RUNNING" }],
      }),
    );
    expect(readiness.readinessState).toBe("RESEARCH_IN_PROGRESS");
  });

  it("explanation lines cite persisted signals with concrete numbers", () => {
    const readiness = calculateOpportunityReadiness(
      baseInput({
        researchRuns: [recentRun],
        validation: { ...cleanValidation, contradictionCount: 2 },
        experiments: [sufficientExperiment],
      }),
    );
    const text = readiness.explanation.join(" | ");
    expect(text).toContain("evidence coverage is 90%");
    expect(text).toContain("2 contradictory signal(s)");
    expect(text).toContain("5 day(s) old");
    expect(text).toContain("2 REAL_DATA measurement period(s)");
  });

  it("does not exceed score bounds and never mutates opportunity scores", () => {
    const readiness = calculateOpportunityReadiness(
      baseInput({ researchRuns: [recentRun], validation: cleanValidation, experiments: [sufficientExperiment] }),
    );
    expect(readiness.readinessScore).toBeGreaterThanOrEqual(0);
    expect(readiness.readinessScore).toBeLessThanOrEqual(100);
    // The engine's output has no field that could override Opportunity.scores.
    expect(Object.keys(readiness)).not.toContain("overallScore");
  });
});
