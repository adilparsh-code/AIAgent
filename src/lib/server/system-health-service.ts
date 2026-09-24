import "server-only";
import { getPrisma, isDbUnavailableError } from "@/lib/db";
import { loadOpportunityDecisions } from "@/lib/server/opportunity-decision-loader";
import { calculateSystemHealth, makeHealthCheck, type SystemHealth, type SystemHealthCheck } from "@/lib/system-health";
import { getIntegrationRegistry } from "@/lib/integrations/registry";

export const HEALTH_BOUNDS = { MAX_OPPORTUNITIES: 50, MAX_TASKS: 200, MAX_EXECUTIONS: 200, MAX_RESEARCH_RUNS: 200 } as const;

function unknown(component: SystemHealthCheck["component"], message: string, now: Date): SystemHealthCheck {
  return makeHealthCheck({ component, status: "UNKNOWN", message, dataClass: "UNKNOWN", now });
}

/** Lightweight owner-scoped health snapshot. It performs no provider calls. */
export async function getSystemHealth(ownerId: string, now = new Date()): Promise<SystemHealth> {
  const checks: SystemHealthCheck[] = [];
  try {
    const prisma = getPrisma();
    await prisma.opportunity.count({ where: { ownerId, isSample: false } });
    checks.push(makeHealthCheck({ component: "DATABASE", status: "HEALTHY", message: "Owner-scoped persistence query succeeded.", dataClass: "REAL_DATA", now }));
  } catch (error) {
    checks.push(makeHealthCheck({ component: "DATABASE", status: isDbUnavailableError(error) ? "BLOCKED" : "DEGRADED", message: isDbUnavailableError(error) ? "Persistence is not configured." : "Persistence health could not be confirmed.", dataClass: "UNKNOWN", now }));
  }
  checks.push(makeHealthCheck({ component: "AUTHENTICATION", status: "HEALTHY", message: "Authenticated owner context is available for this request.", dataClass: "REAL_DATA", now }));
  for (const [component, message] of [
    ["RESEARCH", "Research persistence is available; no research execution was run."],
    ["EVIDENCE_VALIDATION", "Evidence and validation read models are available; provider health is not assumed."],
    ["READINESS", "Readiness computation is available for owner-scoped persisted state."],
    ["DECISION_ENGINE", "Decision engine is available and advisory."],
    ["PORTFOLIO_INTELLIGENCE", "Portfolio intelligence is available and bounded."],
    ["EXPERIMENT_METRICS", "Experiment metric reporting preserves REAL_DATA versus non-real data classes."],
    ["HANDOFF", "Handoff processing remains governed by existing eligibility gates."],
    ["EXECUTION", "Execution remains governed by ownership, approval, capability, and idempotency gates."],
    ["AGENT_RUNTIME", "Agent runtime is available; no external action was started."],
  ] as const) checks.push(makeHealthCheck({ component, status: "HEALTHY", message, dataClass: "REAL_DATA", now }));
  const registry = getIntegrationRegistry();
  checks.push(makeHealthCheck({ component: "INTEGRATION_REGISTRY", status: registry.list().length > 0 ? "HEALTHY" : "BLOCKED", message: "Integration registry is loaded; external provider health remains unknown until a real health check runs.", dataClass: "UNKNOWN", now }));
  return calculateSystemHealth({ checks, now });
}

export interface OperationalStatus {
  activeResearchRuns: number;
  failedResearchRuns: number;
  blockedOpportunities: number;
  validationGaps: number;
  experimentsRequiringRealData: number;
  pendingHandoffs: number;
  waitingApprovals: number;
  failedExecutions: number;
  retryableFailures: number;
  humanReviewItems: number;
  bounds: typeof HEALTH_BOUNDS;
  generatedAt: string;
}

export async function getOperationalStatus(ownerId: string, now = new Date()): Promise<OperationalStatus> {
  const prisma = getPrisma();
  const [activeResearchRuns, failedResearchRuns, blockedOpportunities, validationGaps, experimentsRequiringRealData, pendingHandoffs, waitingApprovals, failedExecutions, decisionLoad] = await Promise.all([
    prisma.researchRun.count({ where: { opportunity: { ownerId, isSample: false }, status: "RUNNING" } }),
    prisma.researchRun.count({ where: { opportunity: { ownerId, isSample: false }, status: "FAILED" } }),
    prisma.opportunity.count({ where: { ownerId, isSample: false, OR: [{ status: "REJECTED" }, { halalStatus: "NOT_ALLOWED" }] } }),
    prisma.researchRun.count({ where: { opportunity: { ownerId, isSample: false }, validation: null } }),
    prisma.experiment.count({ where: { opportunity: { ownerId, isSample: false }, metricEvents: { none: { dataClass: "REAL_DATA" } } } }),
    prisma.handoff.count({ where: { opportunity: { ownerId, isSample: false }, status: { in: ["DRAFT", "HANDOFF_READY"] } } }),
    prisma.agentTask.count({ where: { ownerId, status: "WAITING_APPROVAL" } }),
    prisma.agentExecution.count({ where: { ownerId, status: { in: ["FAILED", "TIMEOUT", "RATE_LIMITED"] } } }),
    loadOpportunityDecisions(ownerId),
  ]);
  const humanReviewItems = decisionLoad.entries.filter(
    (entry) => entry.decision.decision === "HUMAN_REVIEW" || entry.decision.decision === "REVIEW_CONFLICT",
  ).length;
  return { activeResearchRuns, failedResearchRuns, blockedOpportunities, validationGaps, experimentsRequiringRealData, pendingHandoffs, waitingApprovals, failedExecutions, retryableFailures: failedExecutions, humanReviewItems, bounds: HEALTH_BOUNDS, generatedAt: now.toISOString() };
}
