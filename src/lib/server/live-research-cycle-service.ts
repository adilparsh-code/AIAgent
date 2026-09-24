import "server-only";

import { runResearch } from "@/lib/research-orchestrator";
import { getResearchProviders } from "@/lib/research-providers";
import { researchRepository } from "@/lib/server/repositories/research";
import { opportunityRepository } from "@/lib/server/repositories/opportunities";
import { getOpportunityDecision } from "@/lib/server/opportunity-decision-service";
import { activateProvider } from "@/lib/server/live-activation-service";
import { getProviderActivations } from "@/lib/integrations/activation-service";
import { planLiveResearchCycle, buildLiveResearchRunId, type LiveResearchProvider } from "@/lib/integrations/live-research-cycle";
import { auditRealDataProvenance } from "@/lib/integrations/real-data-integrity";
import { createOperationalEvent, type OperationalEvent } from "@/lib/operational-events";
import { logger } from "@/lib/server/logger";
import { ForbiddenError } from "@/lib/authz-errors";
import type { ResearchRun } from "@/lib/research-types";

export const LIVE_RESEARCH_LIMITS = {
  MAX_TITLE_LENGTH: 240,
  MAX_REQUEST_ID_LENGTH: 64,
  MAX_PROVIDERS: 3,
  MAX_QUERY_RESULTS_PER_PROVIDER: 10,
} as const;

export interface LiveResearchCycleResult {
  status: "SUCCEEDED" | "NOT_CONFIGURED" | "BLOCKED";
  researchRun: ResearchRun | null;
  decision: ReturnType<typeof decisionSummary>;
  evidenceCount: number;
  realDataCount: number;
  rejectedEvidenceCount: number;
  providers: {
    selected: string[];
    healthy: string[];
    skipped: Array<{ provider: string; state: string; reason: string }>;
  };
  events: OperationalEvent[];
  idempotentReplay: boolean;
  safeMessage: string;
}

function event(input: {
  name: string;
  message: string;
  severity?: OperationalEvent["severity"];
  dataClass?: OperationalEvent["dataClass"];
  opportunityId?: string;
}): OperationalEvent {
  return createOperationalEvent({
    category: "RESEARCH",
    severity: input.severity ?? "INFO",
    event: input.name,
    safeMessage: input.message,
    opportunityId: input.opportunityId,
    dataClass: input.dataClass ?? "UNKNOWN",
  });
}

function emit(events: OperationalEvent[]) {
  for (const item of events) logger.operationalEvent(item);
}

function decisionSummary(decision: Awaited<ReturnType<typeof getOpportunityDecision>>) {
  if (!decision) return null;
  return {
    opportunityId: decision.opportunityId,
    state: decision.decision,
    score: decision.decisionScore,
    dataClass: decision.dataClass,
    blockers: decision.blockers,
    recommendedAction: decision.recommendedAction,
    lifecycleState: decision.lifecycleState,
  };
}

function providerObject(name: LiveResearchProvider) {
  const provider = getResearchProviders().find((candidate) => candidate.name === name);
  if (!provider) throw new Error(`research provider ${name} is unavailable`);
  return provider;
}

/** Execute one controlled first-live research cycle through the existing pipeline. */
export async function runLiveResearchCycle(input: {
  ownerId: string;
  opportunityId: string;
  title: string;
  requestId: string;
  providerIds?: readonly string[];
}): Promise<LiveResearchCycleResult> {
  const opportunity = await opportunityRepository.getById(input.opportunityId, input.ownerId);
  if (!opportunity) throw new ForbiddenError("Resource not found");

  const runId = buildLiveResearchRunId(input.ownerId, input.opportunityId, input.requestId);
  const existing = await researchRepository.getById(runId, input.ownerId);
  if (existing) {
    return {
      status: "SUCCEEDED",
      researchRun: existing,
      decision: decisionSummary(await getOpportunityDecision(input.opportunityId, input.ownerId)),
      evidenceCount: existing.evidence.length,
      realDataCount: existing.evidence.filter((item) => item.dataClass === "REAL_LIVE_DATA").length,
      rejectedEvidenceCount: 0,
      providers: { selected: [], healthy: [], skipped: [] },
      events: [],
      idempotentReplay: true,
      safeMessage: "This requestId already has a persisted live research run; no duplicate research run was created.",
    };
  }

  const activations = await getProviderActivations();
  const initialPlan = planLiveResearchCycle(
    activations,
    input.providerIds?.slice(0, LIVE_RESEARCH_LIMITS.MAX_PROVIDERS),
  );
  const events: OperationalEvent[] = [];
  const healthy: string[] = [];
  for (const activationProvider of initialPlan.activationProviders) {
    const result = await activateProvider({ provider: activationProvider, ownerId: input.ownerId });
    events.push(...result.events);
    if (result.state === "HEALTHY" || result.state === "LIVE_TEST_READY") healthy.push(activationProvider);
  }
  const researchProviders = initialPlan.researchProviders.filter((provider) => healthy.includes(
    provider === "brave" ? "brave-search" : provider,
  ));
  const skipped = [...initialPlan.skipped];
  if (researchProviders.length === 0) {
    const blocked = event({
      name: "RESEARCH_RUN_BLOCKED",
      severity: "WARNING",
      message: "No configured research provider passed a real health check; no research run was created.",
      opportunityId: input.opportunityId,
    });
    events.push(blocked);
    emit(events);
    return {
      status: "NOT_CONFIGURED",
      researchRun: null,
      decision: decisionSummary(await getOpportunityDecision(input.opportunityId, input.ownerId)),
      evidenceCount: 0,
      realDataCount: 0,
      rejectedEvidenceCount: 0,
      providers: { selected: initialPlan.activationProviders, healthy, skipped },
      events,
      idempotentReplay: false,
      safeMessage: "Provider not configured or not health-verified. Activation remains READY_FOR_HEALTH_CHECK.",
    };
  }

  const started = event({
    name: "RESEARCH_RUN_STARTED",
    message: `Starting one bounded live research cycle across ${researchProviders.length} health-verified provider(s).`,
    opportunityId: input.opportunityId,
  });
  events.push(started);
  emit(events);

  let result: ResearchRun;
  try {
    result = await runResearch(input.opportunityId, input.title, researchProviders.map(providerObject));
  } catch (error) {
    const failure = event({
      name: "RESEARCH_RUN_FAILED",
      severity: "ERROR",
      message: error instanceof Error ? error.message : "Research cycle failed without a safe diagnostic.",
      opportunityId: input.opportunityId,
    });
    events.push(failure);
    emit(events);
    throw error;
  }

  // Replace the random id only after the run completed; the stable id is the
  // idempotency boundary for this request and remains unique in ResearchRun.
  result = { ...result, id: runId };
  const audit = auditRealDataProvenance(result, { healthyProviders: researchProviders });
  result = audit.run;
  const saved = await researchRepository.save(result);
  const realDataCount = audit.realDataCount;
  const accepted = event({
    name: realDataCount > 0 ? "REAL_DATA_RECORDED" : "EVIDENCE_ACCEPTED",
    message: realDataCount > 0
      ? `${realDataCount} provider-backed observation(s) retained REAL_DATA provenance.`
      : "Research completed without a provenance-complete REAL_DATA observation; no data class was upgraded.",
    dataClass: realDataCount > 0 ? "REAL_DATA" : "UNKNOWN",
    opportunityId: input.opportunityId,
  });
  events.push(accepted);
  if (audit.rejectedEvidenceIds.length > 0) {
    events.push(event({
      name: "EVIDENCE_REJECTED",
      severity: "WARNING",
      message: `${audit.rejectedEvidenceIds.length} evidence item(s) were downgraded because REAL_DATA provenance was incomplete.`,
      opportunityId: input.opportunityId,
    }));
  }
  const completed = event({
    name: saved.status === "FAILED" ? "RESEARCH_RUN_FAILED" : "RESEARCH_RUN_SUCCEEDED",
    severity: saved.status === "FAILED" ? "WARNING" : "INFO",
    message: `Live research run ${saved.id} finished with status ${saved.status}; ${saved.evidence.length} evidence item(s) persisted.`,
    dataClass: realDataCount > 0 ? "REAL_DATA" : "UNKNOWN",
    opportunityId: input.opportunityId,
  });
  events.push(completed);
  emit(events);

  return {
    status: saved.status === "FAILED" ? "BLOCKED" : "SUCCEEDED",
    researchRun: saved,
    decision: decisionSummary(await getOpportunityDecision(input.opportunityId, input.ownerId)),
    evidenceCount: saved.evidence.length,
    realDataCount,
    rejectedEvidenceCount: audit.rejectedEvidenceIds.length,
    providers: { selected: initialPlan.activationProviders, healthy, skipped },
    events,
    idempotentReplay: false,
    safeMessage: saved.status === "FAILED"
      ? "Research run failed honestly; no external success was fabricated."
      : "Research run persisted through the existing evidence, validation, history, and decision pipeline.",
  };
}
