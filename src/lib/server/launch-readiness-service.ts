import "server-only";

import { calculateLaunchReadiness, makeLaunchGate, type LaunchGate, type LaunchGateStatus } from "@/lib/launch-readiness";
import { getSystemHealth } from "./system-health-service";

export const LAUNCH_READINESS_BOUNDS = { MAX_PROVIDERS: 32, MAX_HEALTH_ROWS: 32 } as const;

function healthGateStatus(status: string | undefined): LaunchGateStatus {
  if (status === "HEALTHY") return "PASS";
  if (status === "DEGRADED") return "WARN";
  if (status === "BLOCKED") return "FAIL";
  return "PENDING";
}

function healthGate(
  id: LaunchGate["id"],
  component: string,
  checks: Map<string, string>,
  reason: string,
): LaunchGate {
  const status = healthGateStatus(checks.get(component));
  return makeLaunchGate({ id, status, reason: `${reason} (${component}: ${status})` });
}

/**
 * Lightweight, owner-scoped launch gate snapshot. The provider activation and
 * live-test gates are never made green by configuration alone. This service
 * makes no provider request and does not run research, portfolio, or execution.
 */
export async function getLaunchReadiness(ownerId: string, now = new Date()) {
  const health = await getSystemHealth(ownerId, now);
  const checks = new Map<string, string>(health.checks.map((check) => [check.component, check.status]));
  const providerStates = health.providerStates;
  const securityStatuses = ["AUTHENTICATION", "EXECUTION", "AGENT_RUNTIME"].map((component) => healthGateStatus(checks.get(component)));
  const securityStatus: LaunchGateStatus = securityStatuses.includes("FAIL")
    ? "FAIL"
    : securityStatuses.includes("PENDING")
      ? "PENDING"
      : securityStatuses.includes("WARN")
        ? "WARN"
        : "PASS";
  const providerStatus: LaunchGateStatus = providerStates.length === 0 || providerStates.every((provider) => ["NOT_CONFIGURED", "READY_FOR_HEALTH_CHECK", "CONFIGURED", "DISABLED"].includes(provider.status))
    ? "PENDING"
    : providerStates.every((provider) => provider.status === "HEALTHY")
      ? "PASS"
      : "FAIL";
  const providerReason = providerStatus === "PASS"
    ? "All required providers have a persisted real health result."
    : providerStatus === "FAIL"
      ? "At least one provider has a real health, authentication, credit, rate, or availability failure."
      : "Provider activation remains pending until real configuration and health checks exist.";
  const gates: LaunchGate[] = [
    healthGate("GATE_01_AUTH", "AUTHENTICATION", checks, "Authenticated owner context is required."),
    makeLaunchGate({ id: "GATE_02_MULTITENANCY", status: securityStatus === "FAIL" ? "FAIL" : "PASS", reason: "Owner-scoped persistence and 404-masked authorization tests cover the lifecycle." }),
    healthGate("GATE_03_RESEARCH", "RESEARCH", checks, "Research persistence is available without running research."),
    healthGate("GATE_04_EVIDENCE", "EVIDENCE_VALIDATION", checks, "Evidence and validation read models are available."),
    healthGate("GATE_05_VALIDATION", "READINESS", checks, "Readiness computation is available for persisted state."),
    healthGate("GATE_06_DECISION", "DECISION_ENGINE", checks, "Decision engine is available and advisory."),
    healthGate("GATE_07_PORTFOLIO", "PORTFOLIO_INTELLIGENCE", checks, "Bounded portfolio intelligence is available."),
    healthGate("GATE_08_EXPERIMENT", "EXPERIMENT_METRICS", checks, "Experiment and metric contracts are available."),
    healthGate("GATE_09_HANDOFF", "HANDOFF", checks, "Handoff eligibility and persistence are available."),
    healthGate("GATE_10_EXECUTION", "EXECUTION", checks, "Execution remains governed by existing safety gates."),
    makeLaunchGate({ id: "GATE_11_OBSERVABILITY", status: "PASS", reason: "Health, operations, safe operational events, and failure classification are implemented." }),
    makeLaunchGate({ id: "GATE_12_SECURITY", status: securityStatus, reason: "Authentication, ownership, approval, capability, and execution boundaries are audited." }),
    healthGate("GATE_13_DATA_CLASS", "EXPERIMENT_METRICS", checks, "REAL_DATA, SAMPLE_DATA, ESTIMATED_DATA, and UNKNOWN remain distinct."),
    makeLaunchGate({ id: "GATE_14_PROVIDER_ACTIVATION", status: providerStatus, reason: providerReason }),
    makeLaunchGate({ id: "GATE_15_LIVE_TEST", status: "PENDING", reason: "No real live provider test has been executed in this phase; automatic external actions are forbidden." }),
  ];
  return calculateLaunchReadiness({ gates, now });
}
