/**
 * Phase 16 — pre-live launch readiness.
 *
 * This is an internal engineering-readiness model, not a business forecast.
 * It never calls providers, reads secrets, persists state, or executes work.
 * Provider activation and live-test gates remain pending until a real system
 * records the corresponding provider/test result.
 */

import { sanitizeOperationalMessage } from "./operational-events";

export const LAUNCH_READINESS_STATUSES = [
  "NOT_READY",
  "CONDITIONALLY_READY",
  "READY_FOR_LIVE_ACTIVATION",
  "BLOCKED",
] as const;
export type LaunchReadinessStatus = (typeof LAUNCH_READINESS_STATUSES)[number];

export const LAUNCH_GATE_STATUSES = ["PASS", "WARN", "FAIL", "PENDING"] as const;
export type LaunchGateStatus = (typeof LAUNCH_GATE_STATUSES)[number];

export const LAUNCH_GATE_SEVERITIES = ["INFO", "WARNING", "BLOCKING"] as const;
export type LaunchGateSeverity = (typeof LAUNCH_GATE_SEVERITIES)[number];

export const LAUNCH_GATE_IDS = [
  "GATE_01_AUTH",
  "GATE_02_MULTITENANCY",
  "GATE_03_RESEARCH",
  "GATE_04_EVIDENCE",
  "GATE_05_VALIDATION",
  "GATE_06_DECISION",
  "GATE_07_PORTFOLIO",
  "GATE_08_EXPERIMENT",
  "GATE_09_HANDOFF",
  "GATE_10_EXECUTION",
  "GATE_11_OBSERVABILITY",
  "GATE_12_SECURITY",
  "GATE_13_DATA_CLASS",
  "GATE_14_PROVIDER_ACTIVATION",
  "GATE_15_LIVE_TEST",
] as const;
export type LaunchGateId = (typeof LAUNCH_GATE_IDS)[number];

export const LAUNCH_GATE_LABELS: Record<LaunchGateId, string> = {
  GATE_01_AUTH: "Authentication",
  GATE_02_MULTITENANCY: "Multi-tenancy",
  GATE_03_RESEARCH: "Research",
  GATE_04_EVIDENCE: "Evidence",
  GATE_05_VALIDATION: "Validation",
  GATE_06_DECISION: "Decision",
  GATE_07_PORTFOLIO: "Portfolio",
  GATE_08_EXPERIMENT: "Experiments",
  GATE_09_HANDOFF: "Handoff",
  GATE_10_EXECUTION: "Execution",
  GATE_11_OBSERVABILITY: "Observability",
  GATE_12_SECURITY: "Security",
  GATE_13_DATA_CLASS: "Data-class",
  GATE_14_PROVIDER_ACTIVATION: "Provider activation",
  GATE_15_LIVE_TEST: "Live provider test",
};

export interface LaunchGate {
  id: LaunchGateId;
  status: LaunchGateStatus;
  severity: LaunchGateSeverity;
  reason: string;
  requiredAction: string;
}

export interface LaunchReadiness {
  status: LaunchReadinessStatus;
  score: number;
  gates: LaunchGate[];
  blockers: string[];
  warnings: string[];
  readyComponents: LaunchGateId[];
  missingComponents: LaunchGateId[];
  externalProviderPending: boolean;
  liveTestPending: boolean;
  securityReady: boolean;
  dataReady: boolean;
  executionReady: boolean;
  observabilityReady: boolean;
  generatedAt: string;
}

const DEFAULT_REASONS: Record<LaunchGateId, string> = {
  GATE_01_AUTH: "Authentication has not been observed for this request.",
  GATE_02_MULTITENANCY: "Ownership and tenant-isolation checks have not been recorded.",
  GATE_03_RESEARCH: "Research readiness has not been recorded.",
  GATE_04_EVIDENCE: "Evidence readiness has not been recorded.",
  GATE_05_VALIDATION: "Validation/readiness compatibility has not been recorded.",
  GATE_06_DECISION: "Decision-engine readiness has not been recorded.",
  GATE_07_PORTFOLIO: "Portfolio readiness has not been recorded.",
  GATE_08_EXPERIMENT: "Experiment readiness has not been recorded.",
  GATE_09_HANDOFF: "Handoff readiness has not been recorded.",
  GATE_10_EXECUTION: "Execution readiness has not been recorded.",
  GATE_11_OBSERVABILITY: "Operational event and health reporting readiness has not been recorded.",
  GATE_12_SECURITY: "Security boundary readiness has not been recorded.",
  GATE_13_DATA_CLASS: "Data-class preservation has not been recorded.",
  GATE_14_PROVIDER_ACTIVATION: "Real provider configuration and health verification are pending.",
  GATE_15_LIVE_TEST: "A real provider test has not been run; no automatic live action is permitted.",
};

const DEFAULT_ACTIONS: Record<LaunchGateId, string> = {
  GATE_01_AUTH: "Authenticate through the existing session boundary.",
  GATE_02_MULTITENANCY: "Review owner-scoped persistence and authorization tests.",
  GATE_03_RESEARCH: "Verify the research adapter and persistence contract.",
  GATE_04_EVIDENCE: "Verify evidence normalization and persistence.",
  GATE_05_VALIDATION: "Verify validation and readiness calculation.",
  GATE_06_DECISION: "Verify the decision engine contract.",
  GATE_07_PORTFOLIO: "Verify the bounded portfolio calculation.",
  GATE_08_EXPERIMENT: "Verify experiment and metric contracts.",
  GATE_09_HANDOFF: "Verify handoff eligibility and persistence.",
  GATE_10_EXECUTION: "Verify ownership, approval, capability, and execution gates.",
  GATE_11_OBSERVABILITY: "Verify health, operations, and safe operational events.",
  GATE_12_SECURITY: "Review authentication, ownership, approval, and capability boundaries.",
  GATE_13_DATA_CLASS: "Verify non-real data never becomes REAL_DATA.",
  GATE_14_PROVIDER_ACTIVATION: "Configure server-side, run a real health check, and persist its result.",
  GATE_15_LIVE_TEST: "Run only a safe read/search test through the existing execution flow.",
};

function safeText(value: string, fallback: string): string {
  const text = String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  return sanitizeOperationalMessage(text || fallback);
}

function severityFor(status: LaunchGateStatus): LaunchGateSeverity {
  if (status === "FAIL") return "BLOCKING";
  if (status === "WARN") return "WARNING";
  return "INFO";
}

export function makeLaunchGate(input: {
  id: LaunchGateId;
  status: LaunchGateStatus;
  reason?: string;
  requiredAction?: string;
  severity?: LaunchGateSeverity;
}): LaunchGate {
  return {
    id: input.id,
    status: input.status,
    severity: input.severity ?? severityFor(input.status),
    reason: safeText(input.reason ?? DEFAULT_REASONS[input.id], DEFAULT_REASONS[input.id]),
    requiredAction: safeText(input.requiredAction ?? DEFAULT_ACTIONS[input.id], DEFAULT_ACTIONS[input.id]),
  };
}

function defaultGates(): LaunchGate[] {
  return LAUNCH_GATE_IDS.map((id) => makeLaunchGate({ id, status: "PENDING" }));
}

function statusScore(status: LaunchGateStatus): number {
  if (status === "PASS") return 100;
  if (status === "WARN") return 50;
  return 0;
}

function launchStatus(gates: readonly LaunchGate[], score: number): LaunchReadinessStatus {
  if (gates.some((gate) => gate.status === "FAIL")) return "BLOCKED";
  if (gates.every((gate) => gate.status === "PASS")) return "READY_FOR_LIVE_ACTIVATION";
  if (score < 34) return "NOT_READY";
  return "CONDITIONALLY_READY";
}

/** Aggregate canonical gates deterministically; the score is engineering-only. */
export function calculateLaunchReadiness(input: {
  gates?: readonly LaunchGate[];
  now?: Date;
}): LaunchReadiness {
  const byId = new Map((input.gates ?? []).map((gate) => [gate.id, gate]));
  const gates = LAUNCH_GATE_IDS.map((id) => byId.get(id) ?? makeLaunchGate({ id, status: "PENDING" }));
  const score = Math.round(gates.reduce((sum, gate) => sum + statusScore(gate.status), 0) / gates.length);
  const blockers = gates.filter((gate) => gate.status === "FAIL").map((gate) => `${gate.id}: ${gate.reason}`);
  const warnings = gates.filter((gate) => gate.status === "WARN" || gate.status === "PENDING").map((gate) => `${gate.id}: ${gate.reason}`);
  const readyComponents = gates.filter((gate) => gate.status === "PASS").map((gate) => gate.id);
  const missingComponents = gates.filter((gate) => gate.status !== "PASS").map((gate) => gate.id);
  const byGate = new Map(gates.map((gate) => [gate.id, gate.status]));
  return {
    status: launchStatus(gates, score),
    score,
    gates,
    blockers,
    warnings,
    readyComponents,
    missingComponents,
    externalProviderPending: byGate.get("GATE_14_PROVIDER_ACTIVATION") === "PENDING",
    liveTestPending: byGate.get("GATE_15_LIVE_TEST") === "PENDING",
    securityReady: ["GATE_01_AUTH", "GATE_02_MULTITENANCY", "GATE_10_EXECUTION", "GATE_12_SECURITY"].every((id) => byGate.get(id as LaunchGateId) === "PASS"),
    dataReady: byGate.get("GATE_13_DATA_CLASS") === "PASS",
    executionReady: byGate.get("GATE_10_EXECUTION") === "PASS",
    observabilityReady: byGate.get("GATE_11_OBSERVABILITY") === "PASS",
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}
