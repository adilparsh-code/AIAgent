import { describe, expect, it } from "vitest";
import {
  buildConsistencyFindings,
  buildIntegrationGates,
  buildLifecycleReports,
  calculatePlatformIntegrationSnapshot,
  PLATFORM_LIFECYCLE_STAGES,
} from "@/lib/platform-integration";
import { calculateGrowthPortfolioState, type GrowthExperimentRow } from "@/lib/growth-portfolio";
import type { OpportunityPortfolioIntelligence } from "@/lib/opportunity-portfolio";
import type { PortfolioOperatingController } from "@/lib/portfolio-operating-controller";
import type { SystemHealth } from "@/lib/system-health";
import type { OperationalStatus } from "@/lib/server/system-health-service";

const NOW = new Date("2026-09-25T12:00:00.000Z");

function systemHealth(status: SystemHealth["status"] = "HEALTHY"): SystemHealth {
  return {
    status,
    checks: SYSTEM_HEALTH_COMPONENTS_LIST.map((component) => ({
      component,
      status: status === "DEGRADED" && component === "EXECUTION" ? "DEGRADED" : status === "UNKNOWN" && component === "LEARNING_PIPELINE" ? "UNKNOWN" : status,
      message: `${component} observed`,
      dataClass: "REAL_DATA",
      observedAt: NOW.toISOString(),
    })),
    criticalFailures: [],
    warnings: [],
    degradedComponents: [],
    healthyComponents: [],
    providerStates: [],
    generatedAt: NOW.toISOString(),
  } as SystemHealth;
}

const SYSTEM_HEALTH_COMPONENTS_LIST = [
  "DATABASE",
  "AUTHENTICATION",
  "RESEARCH",
  "EVIDENCE_VALIDATION",
  "OPPORTUNITY_VALIDATION",
  "READINESS",
  "EXPERIMENT_READINESS",
  "DECISION_ENGINE",
  "PORTFOLIO_INTELLIGENCE",
  "LEARNING_PIPELINE",
  "EXPERIMENT_METRICS",
  "HANDOFF",
  "EXECUTION",
  "AGENT_RUNTIME",
  "INTEGRATION_REGISTRY",
  "PORTFOLIO_OPERATIONS",
] as const;

function operations(overrides: Partial<OperationalStatus> = {}): OperationalStatus {
  return {
    activeResearchRuns: 0,
    failedResearchRuns: 0,
    blockedOpportunities: 0,
    validationGaps: 0,
    experimentsRequiringRealData: 0,
    pendingHandoffs: 0,
    waitingApprovals: 0,
    failedExecutions: 0,
    retryableFailures: 0,
    humanReviewItems: 0,
    bounds: { MAX_OPPORTUNITIES: 50, MAX_TASKS: 200, MAX_EXECUTIONS: 200, MAX_RESEARCH_RUNS: 200 },
    generatedAt: NOW.toISOString(),
    ...overrides,
  } as OperationalStatus;
}

function portfolio(): OpportunityPortfolioIntelligence {
  return {
    totalOpportunities: 1,
    activeOpportunities: 1,
    blockedOpportunities: 0,
    researchRequired: 0,
    validationRequired: 0,
    experimentsRequired: 0,
    handoffReady: 0,
    executionReady: 0,
    humanReviewRequired: 0,
    portfolioConfidence: 60,
    concentrationWarnings: [],
    staleOpportunityCount: 0,
    evidenceQualitySummary: {
      opportunitiesWithValidationConfidence: 1,
      averageConfidence: 60,
      realDataOpportunities: 1,
      aiEstimateOpportunities: 0,
      nonRealDataLimitations: [],
    },
    experimentCoverageSummary: {
      opportunitiesWithExperiments: 1,
      withSufficientRealData: 1,
      withInsufficientRealData: 0,
      estimatedOnly: 0,
      withNoData: 0,
      averageRealMetricPeriods: 2,
    },
    recommendedOpportunityIds: [],
    recommendedNextActions: [],
    queues: {
      RESEARCH_QUEUE: [],
      VALIDATION_QUEUE: [],
      EXPERIMENT_QUEUE: [],
      LEARNING_QUEUE: [],
      HANDOFF_QUEUE: [],
      EXECUTION_QUEUE: [],
      HUMAN_REVIEW_QUEUE: [],
      BLOCKED_QUEUE: [],
      MONITOR_QUEUE: [],
    },
    portfolioDecision: "MONITOR",
    recommendations: [],
    explanation: [],
    dataClass: "REAL_DATA",
    generatedAt: NOW.toISOString(),
    bounds: { maxOpportunities: 50, truncated: false },
  } as OpportunityPortfolioIntelligence;
}

function controller(): PortfolioOperatingController {
  return {
    cycleId: "portfolio-cycle-1",
    portfolioDecision: "MONITOR",
    queues: {
      RESEARCH_QUEUE: [],
      VALIDATION_QUEUE: [],
      EXPERIMENT_QUEUE: [],
      LEARNING_QUEUE: [],
      HANDOFF_QUEUE: [],
      EXECUTION_QUEUE: [],
      HUMAN_REVIEW_QUEUE: [],
      BLOCKED_QUEUE: [],
      MONITOR_QUEUE: [],
    },
    items: [],
    selectedOpportunityIds: [],
    deferredOpportunityIds: [],
    limits: {
      maxOpportunitiesPerCycle: 5,
      maxResearchRuns: 2,
      maxConcurrentExperiments: 3,
      maxConcurrentExecutions: 2,
      maxMetricsPerCycle: 50,
      maxRetries: 3,
    },
    observed: { activeResearchRuns: 0, activeExperiments: 0, activeExecutions: 0, metricsAvailable: 0 },
    blocked: false,
    reasons: [],
    generatedAt: NOW.toISOString(),
  } as PortfolioOperatingController;
}

function row(overrides: Partial<GrowthExperimentRow> = {}): GrowthExperimentRow {
  return {
    experimentId: "exp-1",
    opportunityId: "opp-1",
    status: "RUNNING",
    decision: null,
    realMetricPeriods: 2,
    estimatedMetricPeriods: 0,
    unmeasured: false,
    dataClass: "REAL_DATA",
    experimentSufficient: true,
    hasLearningSignal: true,
    handoffStatus: null,
    requiresHumanApproval: false,
    hasExecutionBlocker: false,
    isBlocked: false,
    ...overrides,
  };
}

function growth(experimentRows: GrowthExperimentRow[] = [row()]) {
  return calculateGrowthPortfolioState({
    portfolio: portfolio(),
    controller: controller(),
    experimentRows,
    now: NOW,
  });
}

describe("Phase 24 lifecycle reports", () => {
  it("covers every required lifecycle stage exactly once", () => {
    const reports = buildLifecycleReports({ systemHealth: systemHealth(), operations: operations(), growth: growth() });
    expect(reports.map((report) => report.stage)).toEqual([...PLATFORM_LIFECYCLE_STAGES]);
  });

  it("maps stages onto existing SystemHealth components without inventing status", () => {
    const reports = buildLifecycleReports({ systemHealth: systemHealth(), operations: operations(), growth: growth() });
    for (const report of reports) {
      expect(report.basis.length).toBeGreaterThan(0);
    }
    expect(reports.find((report) => report.stage === "RESEARCH")?.basis).toContain("RESEARCH");
  });

  it("reports MEASUREMENT as PENDING when experiments have never been measured", () => {
    const reports = buildLifecycleReports({
      systemHealth: systemHealth(),
      operations: operations(),
      growth: growth([row({ realMetricPeriods: 0, unmeasured: true, dataClass: "NONE", hasLearningSignal: false })]),
    });
    expect(reports.find((report) => report.stage === "MEASUREMENT")?.state).toBe("PENDING");
  });

  it("degrades VALIDATION when persisted validation gaps exist", () => {
    const reports = buildLifecycleReports({
      systemHealth: systemHealth(),
      operations: operations({ validationGaps: 2 }),
      growth: growth(),
    });
    expect(reports.find((report) => report.stage === "VALIDATION")?.state).toBe("DEGRADED");
  });

  it("degrades EXECUTION when persisted failed executions exist", () => {
    const reports = buildLifecycleReports({
      systemHealth: systemHealth(),
      operations: operations({ failedExecutions: 1 }),
      growth: growth(),
    });
    expect(reports.find((report) => report.stage === "EXECUTION")?.state).toBe("DEGRADED");
  });
});

describe("Phase 24 consistency findings", () => {
  it("flags governance holds from persisted WAITING_APPROVAL tasks", () => {
    const lifecycle = buildLifecycleReports({ systemHealth: systemHealth(), operations: operations({ waitingApprovals: 1 }), growth: growth() });
    const findings = buildConsistencyFindings({ lifecycle, operations: operations({ waitingApprovals: 1 }), growth: growth() });
    expect(findings.some((finding) => finding.kind === "GOVERNANCE_HOLD" && finding.detail.includes("WAITING_APPROVAL"))).toBe(true);
  });

  it("flags capacity starvation from the growth state", () => {
    const starved = growth([row({ realMetricPeriods: 0, unmeasured: true, dataClass: "NONE", hasLearningSignal: false })]);
    void starved;
    const unmeasured = [1, 2, 3, 4, 5].map((n) =>
      row({ experimentId: `exp-${n}`, opportunityId: `opp-${n}`, realMetricPeriods: 0, unmeasured: true, dataClass: "NONE", hasLearningSignal: false }),
    );
    const starvedGrowth = calculateGrowthPortfolioState({ portfolio: portfolio(), controller: controller(), experimentRows: unmeasured, now: NOW });
    const lifecycle = buildLifecycleReports({ systemHealth: systemHealth(), operations: operations(), growth: starvedGrowth });
    const findings = buildConsistencyFindings({ lifecycle, operations: operations(), growth: starvedGrowth });
    expect(findings.some((finding) => finding.kind === "CAPACITY_STARVATION")).toBe(true);
  });

  it("flags provenance gaps when learning exists without measurement", () => {
    const suspicious = calculateGrowthPortfolioState({
      portfolio: portfolio(),
      controller: controller(),
      experimentRows: [row({ realMetricPeriods: 0, unmeasured: true, dataClass: "NONE", hasLearningSignal: true })],
      now: NOW,
    });
    const lifecycle = buildLifecycleReports({ systemHealth: systemHealth(), operations: operations(), growth: suspicious });
    const findings = buildConsistencyFindings({ lifecycle, operations: operations(), growth: suspicious });
    expect(findings.some((finding) => finding.kind === "PROVENANCE_GAP")).toBe(true);
  });

  it("reports an INFO finding when nothing is inconsistent", () => {
    const lifecycle = buildLifecycleReports({ systemHealth: systemHealth(), operations: operations(), growth: growth() });
    const findings = buildConsistencyFindings({ lifecycle, operations: operations(), growth: growth() });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("INFO");
  });
});

describe("Phase 24 integration gates", () => {
  it("fails closed when a component is BLOCKED", () => {
    const snapshot = calculatePlatformIntegrationSnapshot({
      systemHealth: systemHealth("BLOCKED"),
      operations: operations(),
      growth: growth(),
      now: NOW,
    });
    expect(snapshot.gates.some((gate) => gate.state === "FAIL")).toBe(true);
    expect(snapshot.overallState).toBe("FAIL");
  });

  it("keeps isolation and provenance gates explicit and truthful", () => {
    const snapshot = calculatePlatformIntegrationSnapshot({
      systemHealth: systemHealth(),
      operations: operations({ experimentsRequiringRealData: 1 }),
      growth: growth(),
      now: NOW,
    });
    const isolation = snapshot.gates.find((gate) => gate.id === "GATE_13_ISOLATION");
    const provenance = snapshot.gates.find((gate) => gate.id === "GATE_12_PROVENANCE");
    expect(isolation?.state).toBe("PASS");
    expect(provenance?.state).toBe("WARN");
  });

  it("always states what remains unverified in production", () => {
    const snapshot = calculatePlatformIntegrationSnapshot({
      systemHealth: systemHealth(),
      operations: operations(),
      growth: growth(),
      now: NOW,
    });
    expect(snapshot.unverifiedInProduction.length).toBeGreaterThanOrEqual(4);
    expect(snapshot.explanation.join(" ")).toContain("no new health");
  });

  it("does not count PENDING as healthy", () => {
    const snapshot = calculatePlatformIntegrationSnapshot({
      systemHealth: systemHealth("UNKNOWN"),
      operations: operations(),
      growth: growth(),
      now: NOW,
    });
    expect(snapshot.stagesPending).toBeGreaterThan(0);
    expect(snapshot.overallState).not.toBe("PASS");
  });
});
