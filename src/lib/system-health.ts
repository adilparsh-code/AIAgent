/**
 * Phase 14 — pure deterministic system health model.
 *
 * A check describes observed internal state only. It never infers provider
 * health from configuration or credentials, and it never executes recovery.
 */

export const SYSTEM_HEALTH_STATUSES = ["HEALTHY", "DEGRADED", "BLOCKED", "UNKNOWN"] as const;
export type SystemHealthStatus = (typeof SYSTEM_HEALTH_STATUSES)[number];

export const SYSTEM_HEALTH_COMPONENTS = [
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
] as const;
export type SystemHealthComponent = (typeof SYSTEM_HEALTH_COMPONENTS)[number];

export type HealthDataClass = "REAL_DATA" | "AI_ESTIMATE" | "SAMPLE_DATA" | "UNKNOWN";

export interface SystemHealthCheck {
  component: SystemHealthComponent;
  status: SystemHealthStatus;
  message: string;
  dataClass: HealthDataClass;
  observedAt: string;
}

export interface SystemHealthProviderState {
  provider: string;
  status: string;
  configured: boolean;
  healthCheckRequired: boolean;
  safeReason: string;
}

export interface SystemHealth {
  status: SystemHealthStatus;
  checks: SystemHealthCheck[];
  criticalFailures: string[];
  warnings: string[];
  degradedComponents: SystemHealthComponent[];
  healthyComponents: SystemHealthComponent[];
  providerStates: SystemHealthProviderState[];
  generatedAt: string;
}

export interface CalculateSystemHealthInput {
  checks: SystemHealthCheck[];
  providerStates?: SystemHealthProviderState[];
  now?: Date;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Aggregate checks deterministically. Blocked wins over degraded, degraded over unknown. */
export function calculateSystemHealth(input: CalculateSystemHealthInput): SystemHealth {
  const now = input.now ?? new Date();
  const checks = [...(input.checks ?? [])].sort((a, b) =>
    a.component.localeCompare(b.component),
  );
  const criticalFailures = checks
    .filter((check) => check.status === "BLOCKED")
    .map((check) => `${check.component}: ${check.message}`);
  const warnings = checks
    .filter((check) => check.status === "DEGRADED" || check.status === "UNKNOWN")
    .map((check) => `${check.component}: ${check.message}`);
  const degradedComponents = [
    ...new Set(checks.filter((check) => check.status === "DEGRADED").map((check) => check.component)),
  ];
  const healthyComponents = [
    ...new Set(checks.filter((check) => check.status === "HEALTHY").map((check) => check.component)),
  ];
  const status: SystemHealthStatus = checks.some((check) => check.status === "BLOCKED")
    ? "BLOCKED"
    : checks.some((check) => check.status === "DEGRADED")
      ? "DEGRADED"
      : checks.some((check) => check.status === "UNKNOWN")
        ? "UNKNOWN"
        : "HEALTHY";

  const providerStates = [...(input.providerStates ?? [])].sort((a, b) => a.provider.localeCompare(b.provider));

  return {
    status,
    checks,
    criticalFailures: unique(criticalFailures),
    warnings: unique(warnings),
    degradedComponents,
    healthyComponents,
    providerStates,
    generatedAt: now.toISOString(),
  };
}

export function makeHealthCheck(input: {
  component: SystemHealthComponent;
  status: SystemHealthStatus;
  message: string;
  dataClass?: HealthDataClass;
  now?: Date;
}): SystemHealthCheck {
  return {
    component: input.component,
    status: input.status,
    message: input.message.slice(0, 500),
    dataClass: input.dataClass ?? "UNKNOWN",
    observedAt: (input.now ?? new Date()).toISOString(),
  };
}
