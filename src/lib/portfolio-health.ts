/** Phase 20 — portfolio-level health aggregation. */
import type { AutonomousOperatingLoop } from "@/lib/autonomous-operating-loop";
import type { ProviderActivation } from "@/lib/integrations/provider-activation";
import type { SystemHealth } from "@/lib/system-health";
import type { OperationalStatus } from "@/lib/server/system-health-service";

export const PORTFOLIO_HEALTH_STATUSES = ["HEALTHY", "DEGRADED", "BLOCKED", "UNKNOWN"] as const;
export type PortfolioHealthStatus = (typeof PORTFOLIO_HEALTH_STATUSES)[number];

export interface PortfolioHealth {
  status: PortfolioHealthStatus;
  blockingComponent: string | null;
  blockers: string[];
  warnings: string[];
  providerStates: Array<{ provider: string; status: string; safeReason: string }>;
  counts: {
    activeResearchRuns: number;
    failedResearchRuns: number;
    blockedOpportunities: number;
    validationGaps: number;
    experimentsRequiringRealData: number;
    pendingHandoffs: number;
    waitingApprovals: number;
    failedExecutions: number;
    humanReviewItems: number;
  };
  lastCycle: {
    cycleId: string;
    stage: string;
    nextAction: string;
    generatedAt: string;
  } | null;
  nextRecommendedAction: string;
  generatedAt: string;
  dataClass: "REAL_DATA" | "UNKNOWN";
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** Aggregate observed portfolio state; no provider call or recovery is performed. */
export function calculatePortfolioHealth(input: {
  systemHealth: SystemHealth;
  operationalStatus: OperationalStatus;
  providers: readonly ProviderActivation[];
  cycle: AutonomousOperatingLoop | null;
  now?: Date;
}): PortfolioHealth {
  const now = input.now ?? new Date();
  const system = input.systemHealth;
  const status = input.operationalStatus;
  const providerStates = input.providers
    .map((provider) => ({ provider: provider.provider, status: provider.status, safeReason: provider.safeReason }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
  const providerBlockers = providerStates
    .filter((provider) => ["AUTH_FAILED", "CREDIT_LIMITED", "RATE_LIMITED", "UNAVAILABLE", "DISABLED", "DEGRADED"].includes(provider.status))
    .map((provider) => `Provider ${provider.provider} is ${provider.status}: ${provider.safeReason}`);
  const providerWarnings = providerStates
    .filter((provider) => ["NOT_CONFIGURED", "CONFIGURED", "READY_FOR_HEALTH_CHECK"].includes(provider.status))
    .map((provider) => `Provider ${provider.provider} is ${provider.status}; configuration is not health.`);
  const blockers = unique([
    ...system.criticalFailures,
    ...providerBlockers,
    ...(status.blockedOpportunities > 0 ? [`${status.blockedOpportunities} opportunity(s) are blocked.`] : []),
    ...(status.failedExecutions > 0 ? [`${status.failedExecutions} execution(s) require classification or review.`] : []),
  ]);
  const warnings = unique([
    ...system.warnings,
    ...providerWarnings,
    ...(status.activeResearchRuns > 0 ? [`${status.activeResearchRuns} research run(s) are active.`] : []),
    ...(status.validationGaps > 0 ? [`${status.validationGaps} research run(s) lack validation.`] : []),
    ...(status.experimentsRequiringRealData > 0 ? [`${status.experimentsRequiringRealData} experiment(s) lack source-backed REAL_DATA.`] : []),
    ...(status.waitingApprovals > 0 ? [`${status.waitingApprovals} approval(s) are waiting.`] : []),
  ]);
  const hasBlockingProvider = providerBlockers.length > 0;
  const hasUnverifiedProvider = providerWarnings.length > 0;
  const finalStatus: PortfolioHealthStatus = system.status === "BLOCKED" || blockers.length > 0
    ? "BLOCKED"
    : system.status === "DEGRADED" || warnings.length > 0 || hasUnverifiedProvider
      ? "DEGRADED"
      : system.status === "UNKNOWN" || input.cycle === null
        ? "UNKNOWN"
        : "HEALTHY";
  const blockingComponent = system.criticalFailures[0]?.split(":")[0]
    ?? (hasBlockingProvider ? "INTEGRATION_REGISTRY" : null);
  const lastCycle = input.cycle
    ? { cycleId: input.cycle.cycleId, stage: input.cycle.cycleStage, nextAction: input.cycle.nextAction, generatedAt: input.cycle.generatedAt }
    : null;

  return {
    status: finalStatus,
    blockingComponent,
    blockers,
    warnings,
    providerStates,
    counts: {
      activeResearchRuns: status.activeResearchRuns,
      failedResearchRuns: status.failedResearchRuns,
      blockedOpportunities: status.blockedOpportunities,
      validationGaps: status.validationGaps,
      experimentsRequiringRealData: status.experimentsRequiringRealData,
      pendingHandoffs: status.pendingHandoffs,
      waitingApprovals: status.waitingApprovals,
      failedExecutions: status.failedExecutions,
      humanReviewItems: status.humanReviewItems,
    },
    lastCycle,
    nextRecommendedAction: input.cycle?.nextAction ?? "Observe the portfolio again after the current blockers are resolved.",
    generatedAt: now.toISOString(),
    dataClass: "REAL_DATA",
  };
}
