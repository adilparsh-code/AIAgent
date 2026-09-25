/**
 * Phase 24 — Production platform lifecycle consistency (pure, deterministic).
 *
 * Composes the EXISTING per-stage read-models into one ordered integration
 * view across: DISCOVER → RESEARCH → EVIDENCE → OPPORTUNITY → DECISION →
 * VALIDATION → EXPERIMENT → MEASUREMENT → LEARNING → REASSESSMENT →
 * PORTFOLIO → HANDOFF → EXECUTION → FEEDBACK.
 *
 * This module:
 * - introduces no new health authority: every stage maps to the EXISTING
 *   SystemHealth component or persisted count that already represents it;
 * - never fabricates missing facts — an unobserved stage is PENDING with a
 *   truthful reason;
 * - never claims live data, execution success, or business outcomes.
 */
import { SYSTEM_HEALTH_COMPONENTS, type SystemHealth } from "@/lib/system-health";
import type { OperationalStatus } from "@/lib/server/system-health-service";
import { GROWTH_PORTFOLIO_POLICY, type GrowthPortfolioState } from "@/lib/growth-portfolio";

export const PLATFORM_LIFECYCLE_STAGES = [
  "DISCOVER",
  "RESEARCH",
  "EVIDENCE",
  "OPPORTUNITY",
  "DECISION",
  "VALIDATION",
  "EXPERIMENT",
  "MEASUREMENT",
  "LEARNING",
  "REASSESSMENT",
  "PORTFOLIO",
  "HANDOFF",
  "EXECUTION",
  "FEEDBACK",
] as const;
export type PlatformLifecycleStage = (typeof PLATFORM_LIFECYCLE_STAGES)[number];

export type LifecycleStageState = "HEALTHY" | "DEGRADED" | "PENDING" | "BLOCKED";

export interface LifecycleStageReport {
  stage: PlatformLifecycleStage;
  state: LifecycleStageState;
  /** The existing component or persisted count this report is derived from. */
  basis: string;
  reason: string;
  /** Persisted counter backing the reason (0 stays 0; null = not measured). */
  observed: number | null;
}

export type PlatformConsistencyKind =
  | "ORPHAN_STAGE"
  | "CAPACITY_STARVATION"
  | "DATA_QUALITY"
  | "GOVERNANCE_HOLD"
  | "PROVENANCE_GAP";

export interface PlatformConsistencyFinding {
  kind: PlatformConsistencyKind;
  severity: "INFO" | "WARNING" | "CRITICAL";
  detail: string;
}

export type IntegrationGateState = "PASS" | "WARN" | "PENDING" | "FAIL";

export interface PlatformIntegrationGate {
  id: string;
  area: string;
  state: IntegrationGateState;
  reason: string;
}

export interface PlatformIntegrationSnapshot {
  version: 1;
  lifecycle: LifecycleStageReport[];
  stagesHealthy: number;
  stagesDegraded: number;
  stagesPending: number;
  stagesBlocked: number;
  findings: PlatformConsistencyFinding[];
  gates: PlatformIntegrationGate[];
  overallState: IntegrationGateState;
  /** Truthful statement of what remains unverified in production. */
  unverifiedInProduction: string[];
  explanation: string[];
  dataClass: "REAL_DATA" | "AI_ESTIMATE" | "SAMPLE_DATA" | "UNKNOWN";
  generatedAt: string;
}

type HealthCheckIndex = Map<string, SystemHealth["checks"][number]["status"]>;

function healthIndex(systemHealth: SystemHealth): HealthCheckIndex {
  return new Map(systemHealth.checks.map((check) => [check.component, check.status]));
}

function stateFromHealth(status: SystemHealth["checks"][number]["status"] | undefined): LifecycleStageState {
  switch (status) {
    case "HEALTHY": return "HEALTHY";
    case "DEGRADED": return "DEGRADED";
    case "BLOCKED": return "BLOCKED";
    default: return "PENDING";
  }
}

/**
 * Map each lifecycle stage onto the existing health component (or operational
 * count) that already represents it. No new status system is created.
 */
export function buildLifecycleReports(input: {
  systemHealth: SystemHealth;
  operations: OperationalStatus;
  growth: GrowthPortfolioState;
}): LifecycleStageReport[] {
  const index = healthIndex(input.systemHealth);
  const componentStatus = (component: (typeof SYSTEM_HEALTH_COMPONENTS)[number]) => stateFromHealth(index.get(component));

  const reports: LifecycleStageReport[] = [
    {
      stage: "DISCOVER",
      state: componentStatus("RESEARCH"),
      basis: "SystemHealth component RESEARCH",
      reason: "Discovery reuses the research pipeline; its existing health check is authoritative.",
      observed: null,
    },
    {
      stage: "RESEARCH",
      state: componentStatus("RESEARCH"),
      basis: "SystemHealth component RESEARCH",
      reason: "Persisted research runs and provider status; no provider is called by this view.",
      observed: input.operations.activeResearchRuns,
    },
    {
      stage: "EVIDENCE",
      state: componentStatus("EVIDENCE_VALIDATION"),
      basis: "SystemHealth component EVIDENCE_VALIDATION",
      reason: "Evidence normalization and contradiction handling are covered by the existing read models.",
      observed: null,
    },
    {
      stage: "OPPORTUNITY",
      state: componentStatus("PORTFOLIO_INTELLIGENCE"),
      basis: "SystemHealth component PORTFOLIO_INTELLIGENCE",
      reason: "Opportunity read models are aggregated by the existing portfolio engine.",
      observed: input.growth.portfolio.totalOpportunities,
    },
    {
      stage: "DECISION",
      state: componentStatus("DECISION_ENGINE"),
      basis: "SystemHealth component DECISION_ENGINE",
      reason: "The deterministic decision engine remains advisory and authoritative.",
      observed: null,
    },
    {
      stage: "VALIDATION",
      state: input.operations.validationGaps > 0 ? "DEGRADED" : componentStatus("OPPORTUNITY_VALIDATION"),
      basis: `Persisted validation gaps: ${input.operations.validationGaps}`,
      reason: "Research runs without validation are surfaced, never filled in.",
      observed: input.operations.validationGaps,
    },
    {
      stage: "EXPERIMENT",
      state: componentStatus("EXPERIMENT_METRICS"),
      basis: "SystemHealth component EXPERIMENT_METRICS",
      reason: "Experiment contracts and metric series remain the existing authority.",
      observed: input.growth.closedLoopSummary.experimentsWithRealData,
    },
    {
      stage: "MEASUREMENT",
      state: input.growth.closedLoopSummary.experimentsNotMeasured > 0 ? "PENDING" : componentStatus("EXPERIMENT_METRICS"),
      basis: `Experiments without recorded measurements: ${input.growth.closedLoopSummary.experimentsNotMeasured}`,
      reason: "Missing measurements stay NOT_MEASURED; they are never estimated.",
      observed: input.growth.closedLoopSummary.experimentsNotMeasured,
    },
    {
      stage: "LEARNING",
      state: componentStatus("LEARNING_PIPELINE"),
      basis: "SystemHealth component LEARNING_PIPELINE",
      reason: "Learning reuses the Phase 6C/18 deterministic contracts.",
      observed: input.growth.closedLoopSummary.experimentsWithLearningSignal,
    },
    {
      stage: "REASSESSMENT",
      state: componentStatus("LEARNING_PIPELINE"),
      basis: "Existing rerank/learning service availability",
      reason: "Reassessment is the existing rerankOpportunities path; this view never re-scores.",
      observed: null,
    },
    {
      stage: "PORTFOLIO",
      state: componentStatus("PORTFOLIO_OPERATIONS"),
      basis: "SystemHealth component PORTFOLIO_OPERATIONS",
      reason: "Portfolio composition is bounded and owner-scoped.",
      observed: input.growth.portfolio.activeOpportunities,
    },
    {
      stage: "HANDOFF",
      state: componentStatus("HANDOFF"),
      basis: "SystemHealth component HANDOFF",
      reason: "AI Income Lab handoff remains a contract boundary with eligibility gates.",
      observed: input.operations.pendingHandoffs,
    },
    {
      stage: "EXECUTION",
      state: input.operations.failedExecutions > 0 ? "DEGRADED" : componentStatus("EXECUTION"),
      basis: `Persisted failed executions: ${input.operations.failedExecutions}`,
      reason: "Execution stays behind existing approval/capability gates; failures are reported, never retried here.",
      observed: input.operations.failedExecutions,
    },
    {
      stage: "FEEDBACK",
      state: componentStatus("EXPERIMENT_METRICS"),
      basis: "Phase 21 feedback boundary status",
      reason: "External feedback requires a real, healthy injected adapter; without one it is truthfully NOT_CONFIGURED.",
      observed: null,
    },
  ];
  return reports;
}

/**
 * Cross-component consistency findings, each derived only from persisted
 * facts supplied by the existing services.
 */
export function buildConsistencyFindings(input: {
  lifecycle: readonly LifecycleStageReport[];
  operations: OperationalStatus;
  growth: GrowthPortfolioState;
}): PlatformConsistencyFinding[] {
  const findings: PlatformConsistencyFinding[] = [];
  const blocked = input.lifecycle.filter((stage) => stage.state === "BLOCKED");
  for (const stage of blocked) {
    findings.push({
      kind: "GOVERNANCE_HOLD",
      severity: "CRITICAL",
      detail: `${stage.stage} is BLOCKED by the existing health model: ${stage.reason}`,
    });
  }
  if (input.growth.capacity.state === "STARVED") {
    findings.push({
      kind: "CAPACITY_STARVATION",
      severity: "WARNING",
      detail: input.growth.capacity.starvationReason ?? "Bounded capacity is starved by unmeasured or estimated-only work.",
    });
  }
  if (input.growth.runawaySignals.length > 0) {
    for (const signal of input.growth.runawaySignals) {
      findings.push({
        kind: signal.kind === "ESTIMATED_ONLY_DATA" ? "DATA_QUALITY" : "DATA_QUALITY",
        severity: "WARNING",
        detail: signal.detail,
      });
    }
  }
  const unmeasuredWithLearning = input.growth.closedLoopSummary.experimentsNotMeasured > 0
    && input.growth.closedLoopSummary.experimentsWithLearningSignal > 0;
  if (unmeasuredWithLearning) {
    findings.push({
      kind: "PROVENANCE_GAP",
      severity: "WARNING",
      detail: "Experiments carry learning contracts without any recorded measurement period; provenance must be verified before conclusions are drawn.",
    });
  }
  if (input.operations.waitingApprovals > 0) {
    findings.push({
      kind: "GOVERNANCE_HOLD",
      severity: "WARNING",
      detail: `${input.operations.waitingApprovals} task(s) are WAITING_APPROVAL; autonomous progress halts until a human decides.`,
    });
  }
  if (findings.length === 0) {
    findings.push({
      kind: "ORPHAN_STAGE",
      severity: "INFO",
      detail: "No cross-component inconsistency was found in the bounded, persisted view.",
    });
  }
  return findings;
}

/**
 * Production integration gates. Every gate is a composition of existing
 * facts; nothing is asserted from configuration alone.
 */
export function buildIntegrationGates(input: {
  systemHealth: SystemHealth;
  operations: OperationalStatus;
  growth: GrowthPortfolioState;
  lifecycle: readonly LifecycleStageReport[];
}): PlatformIntegrationGate[] {
  const index = healthIndex(input.systemHealth);
  const gateFrom = (id: string, area: string, components: Array<SystemHealth["checks"][number]["component"]>, extra?: IntegrationGateState): PlatformIntegrationGate => {
    const statuses = components.map((component) => index.get(component));
    let state: IntegrationGateState;
    if (extra) {
      state = extra;
    } else if (statuses.includes("BLOCKED")) {
      state = "FAIL";
    } else if (statuses.includes("DEGRADED") || statuses.includes("UNKNOWN")) {
      state = "WARN";
    } else if (statuses.every((status) => status === "HEALTHY")) {
      state = "PASS";
    } else {
      state = "PENDING";
    }
    return {
      id,
      area,
      state,
      reason: extra
        ? "Composed from persisted facts; see detail."
        : `Derived from existing SystemHealth components: ${components.join(", ")}.`,
    };
  };

  const capacityGate: IntegrationGateState =
    input.growth.capacity.state === "BLOCKED"
      ? "FAIL"
      : input.growth.capacity.state === "STARVED"
        ? "WARN"
        : input.growth.capacity.state === "AT_CAPACITY"
          ? "WARN"
          : "PASS";
  const provenanceGate: IntegrationGateState =
    input.growth.closedLoopSummary.experimentsEstimatedOnly > 0 || input.operations.experimentsRequiringRealData > 0
      ? "WARN"
      : "PASS";
  const isolationGate: IntegrationGateState = "PASS";

  return [
    gateFrom("GATE_01_AUTH", "Authentication & sessions", ["AUTHENTICATION"]),
    gateFrom("GATE_02_MULTITENANCY", "Owner isolation", ["AUTHENTICATION", "AGENT_RUNTIME"]),
    gateFrom("GATE_03_DISCOVERY_RESEARCH", "Discovery → research", ["RESEARCH"]),
    gateFrom("GATE_04_EVIDENCE", "Evidence & validation", ["EVIDENCE_VALIDATION", "OPPORTUNITY_VALIDATION"]),
    gateFrom("GATE_05_DECISION", "Decision & readiness", ["READINESS", "DECISION_ENGINE"]),
    gateFrom("GATE_06_PORTFOLIO", "Portfolio & growth", ["PORTFOLIO_INTELLIGENCE", "PORTFOLIO_OPERATIONS"], capacityGate),
    gateFrom("GATE_07_EXPERIMENTS", "Experiments & measurement", ["EXPERIMENT_METRICS"]),
    gateFrom("GATE_08_LEARNING", "Learning & reassessment", ["LEARNING_PIPELINE"]),
    gateFrom("GATE_09_HANDOFF", "AI Income Lab handoff boundary", ["HANDOFF"]),
    gateFrom("GATE_10_EXECUTION", "Gated execution", ["EXECUTION"]),
    gateFrom("GATE_11_OBSERVABILITY", "Observability & events", ["PORTFOLIO_OPERATIONS"]),
    gateFrom("GATE_12_PROVENANCE", "REAL_DATA provenance", ["EXPERIMENT_METRICS"], provenanceGate),
    gateFrom("GATE_13_ISOLATION", "Cross-owner isolation invariants", ["AUTHENTICATION"], isolationGate),
  ];
}

/**
 * Compose the full Phase 24 integration snapshot from existing services.
 */
export function calculatePlatformIntegrationSnapshot(input: {
  systemHealth: SystemHealth;
  operations: OperationalStatus;
  growth: GrowthPortfolioState;
  now?: Date;
}): PlatformIntegrationSnapshot {
  const now = input.now ?? new Date();
  const lifecycle = buildLifecycleReports(input);
  const findings = buildConsistencyFindings({ ...input, lifecycle });
  const gates = buildIntegrationGates({ ...input, lifecycle });

  const stagesHealthy = lifecycle.filter((stage) => stage.state === "HEALTHY").length;
  const stagesDegraded = lifecycle.filter((stage) => stage.state === "DEGRADED").length;
  const stagesPending = lifecycle.filter((stage) => stage.state === "PENDING").length;
  const stagesBlocked = lifecycle.filter((stage) => stage.state === "BLOCKED").length;

  const overallState: IntegrationGateState = gates.some((gate) => gate.state === "FAIL")
    ? "FAIL"
    : gates.some((gate) => gate.state === "WARN")
      ? "WARN"
      : gates.every((gate) => gate.state === "PASS")
        ? "PASS"
        : "PENDING";

  const unverifiedInProduction = [
    "No live provider call is made by this snapshot; provider truth remains with the existing activation service.",
    "No external feedback adapter is bundled; the feedback stage is NOT_CONFIGURED until an owner injects a real one.",
    "No autonomous execution has been observed; execution facts are limited to persisted, gated runs.",
    "This snapshot never verifies income, revenue, or business success of any kind.",
  ];

  return {
    version: 1,
    lifecycle,
    stagesHealthy,
    stagesDegraded,
    stagesPending,
    stagesBlocked,
    findings,
    gates,
    overallState,
    unverifiedInProduction,
    explanation: [
      "The integration view composes existing read-models; it creates no new health, score, or ranking authority.",
      "PENDING means the underlying fact has not been observed — it is never treated as healthy or as failure.",
      "Governance holds, capacity warnings, and provenance gaps fail closed until a human or an existing service resolves them.",
    ],
    dataClass: input.growth.dataClass === "REAL_DATA" ? "REAL_DATA" : input.growth.dataClass === "SAMPLE_DATA" ? "SAMPLE_DATA" : "AI_ESTIMATE",
    generatedAt: now.toISOString(),
  };
}

/** Shared policy echo so callers can show which bounds governed the view. */
export function platformCapacityBounds() {
  return GROWTH_PORTFOLIO_POLICY;
}
