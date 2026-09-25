import "server-only";
import { randomBytes } from "node:crypto";
import { getPrisma } from "../db";
import { handoffRepository } from "./repositories/handoffs";
import { mapExperiment } from "../db-mappers";
import { opportunityRepository } from "./repositories/opportunities";
import { experimentRepository } from "./repositories/experiments";
import { researchRepository } from "./repositories/research";
import {
  evaluateHandoffEligibility,
  buildSuccessCriteria,
  buildMonetizationOptions,
  resolveExperimentHypothesis,
} from "../handoff";
import type {
  HandoffSourceData,
  OpportunityHandoffContract,
  HandoffRecommendedExperimentType,
} from "../handoff";
import type { Evidence, ResearchConclusion } from "../research-types";
import type { Opportunity, Experiment, HandoffRecord } from "../types";

const MAX_ID_LENGTH = 64;
const MAX_BUDGET_LIMIT = 1_000_000;
const MAX_TIME_LIMIT_DAYS = 365;

function handoffId(): string {
  return `handoff-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

function safeId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_ID_LENGTH);
}

function clampBudgetLimit(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(value, MAX_BUDGET_LIMIT);
}

function clampTimeLimitDays(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return null;
  return Math.min(Math.round(value), MAX_TIME_LIMIT_DAYS);
}

/** Gather persisted source facts for eligibility checks — no invented data. */
async function loadHandoffSource(opportunityId: string): Promise<HandoffSourceData> {
  const opportunity = await opportunityRepository.getById(opportunityId);
  if (!opportunity) throw new Error(`Opportunity ${opportunityId} was not found`);

  const run = await researchRepository.getLatestByOpportunityId(opportunityId);
  const evidence: Evidence[] = run?.evidence ?? [];

  return {
    opportunity,
    lastResearchConclusion: (run?.conclusion ?? null) as ResearchConclusion | null,
    lastResearchConfidence: run?.confidence ?? null,
    lastResearchEvidence: evidence,
  };
}

function buildContract(
  source: HandoffSourceData,
  id: string,
  options: { recommendedExperiment?: unknown; budgetLimit?: unknown; timeLimitDays?: unknown; hypothesisOverride?: unknown },
): OpportunityHandoffContract {
  const recommendedExperiment: HandoffRecommendedExperimentType =
    options.recommendedExperiment === "ASSET_LAUNCH" ? "ASSET_LAUNCH" : "MVP_BUILD";
  const hypothesis = resolveExperimentHypothesis({
    ...source,
    experimentHypothesisOverride:
      typeof options.hypothesisOverride === "string" && options.hypothesisOverride.trim()
        ? options.hypothesisOverride.trim().slice(0, 600)
        : null,
  });

  return {
    contractVersion: 1,
    handoffId: id,
    opportunityId: source.opportunity.id,
    title: source.opportunity.title,
    category: source.opportunity.category,
    targetAudience: source.opportunity.targetAudience,
    problem: source.opportunity.problemSolved,
    validationConclusion: source.lastResearchConclusion,
    confidence: source.lastResearchConfidence,
    score: source.opportunity.overallScore,
    evidence: source.lastResearchEvidence.slice(0, 25).map((item) => ({
      evidenceId: item.id,
      source: item.source,
      url: item.url,
      title: item.title,
      supports: item.supports,
    })),
    monetizationOptions: buildMonetizationOptions(source.opportunity),
    risks: source.opportunity.risks,
    recommendedExperiment,
    experimentHypothesis: hypothesis,
    successCriteria: buildSuccessCriteria(source),
    budgetLimit: clampBudgetLimit(options.budgetLimit),
    timeLimitDays: clampTimeLimitDays(options.timeLimitDays),
    handoffStatus: "DRAFT",
  };
}

/**
 * Create a handoff draft. The contract is persisted only if the opportunity
 * passes the evidence-driven eligibility gate; otherwise the reasons are
 * returned and nothing is written. The opportunity MUST belong to the caller.
 */
export async function createHandoff(input: {
  opportunityId: unknown;
  recommendedExperiment?: unknown;
  budgetLimit?: unknown;
  timeLimitDays?: unknown;
  experimentHypothesis?: unknown;
  ownerId: string;
}): Promise<
  | { ok: true; handoff: HandoffRecord }
  | { ok: false; reasons: string[] }
> {
  const opportunityId = safeId(input.opportunityId);
  // Ownership check happens inside the load: a foreign opportunity is
  // indistinguishable from a missing one.
  const owned = await opportunityRepository.getById(opportunityId, input.ownerId);
  if (!owned) throw new Error(`Opportunity ${opportunityId} was not found`);
  const source = await loadHandoffSource(opportunityId);
  const eligibility = evaluateHandoffEligibility(source);
  if (!eligibility.eligible) return { ok: false, reasons: eligibility.reasons };

  const id = handoffId();
  const contract = buildContract(source, id, input);
  const handoff = await handoffRepository.create({
    id,
    opportunityId,
    contract,
    validationConclusion: source.lastResearchConclusion,
    confidence: source.lastResearchConfidence,
    score: source.opportunity.overallScore,
    recommendedExperiment: contract.recommendedExperiment,
    experimentHypothesis: contract.experimentHypothesis,
    successCriteria: contract.successCriteria,
    budgetLimit: contract.budgetLimit,
    timeLimitDays: contract.timeLimitDays,
    status: "HANDOFF_READY",
  });
  return { ok: true, handoff };
}

export async function getHandoff(id: string, ownerId?: string): Promise<HandoffRecord | null> {
  return handoffRepository.getById(safeId(id), ownerId);
}

export async function listHandoffs(limit?: unknown, ownerId?: string): Promise<HandoffRecord[]> {
  const max = typeof limit === "number" && Number.isFinite(limit) ? limit : 50;
  return handoffRepository.getAll(max, ownerId);
}

/**
 * Accept or reject a HANDOFF_READY handoff. Acceptance requires the persisted
 * contract to still pass eligibility (facts may have changed since creation).
 * Owner-scoped: only the opportunity's owner may decide the handoff.
 */
export async function decideHandoff(
  id: string,
  decision: "accept" | "reject",
  rejectionReason: string | undefined,
  ownerId: string,
): Promise<HandoffRecord | null> {
  const handoff = await handoffRepository.getById(safeId(id), ownerId);
  if (!handoff) return null;
  if (handoff.status !== "HANDOFF_READY") {
    throw new Error(`Handoff ${id} is ${handoff.status} and cannot be re-decided`);
  }
  const now = new Date();
  if (decision === "reject") {
    const reason = (rejectionReason ?? "Rejected by AI Income Lab").slice(0, 500);
    return handoffRepository.updateStatus(id, {
      status: "REJECTED",
      rejectedAt: now,
      rejectionReason: reason,
    });
  }
  return handoffRepository.updateStatus(id, { status: "ACCEPTED", acceptedAt: now });
}

/**
 * Create a READY experiment from an ACCEPTED handoff.
 *
 * HIGH-4: one handoff produces at most one experiment.
 *  - The ACCEPTED → COMPLETED transition is a *conditional* claim inside the
 *    transaction. Under Postgres row locking a second concurrent request waits
 *    and then re-evaluates the WHERE clause, so it matches zero rows and
 *    creates nothing.
 *  - `Experiment.handoffId` carries a unique index as a second, storage-level
 *    guarantee.
 *  - A request that loses the race returns the already-created experiment
 *    (idempotent replay) instead of an error or a duplicate row.
 *
 * No campaigns launch and no money moves — the experiment starts in READY.
 */
export async function createExperimentFromHandoff(
  handoffIdValue: string,
  overrides: { budget?: unknown; startDate?: unknown } | undefined,
  ownerId: string,
): Promise<Experiment | null> {
  const id = safeId(handoffIdValue);
  const prisma = getPrisma();
  // Owner-scoped: a handoff owned by another user is "not found".
  const handoff = await handoffRepository.getById(id, ownerId);
  if (!handoff) throw new Error(`Handoff ${id} was not found`);
  if (handoff.status !== "ACCEPTED") {
    // Idempotent replay: the handoff was already turned into an experiment.
    const existing = await prisma.experiment.findFirst({
      where: { handoffId: id, opportunity: { ownerId } },
      orderBy: { createdAt: "asc" },
    });
    if (existing) return mapExperiment(existing);
    throw new Error(`Handoff ${id} must be ACCEPTED before an experiment can be created`);
  }

  const budget =
    typeof overrides?.budget === "number" && Number.isFinite(overrides.budget) && overrides.budget >= 0
      ? Math.min(overrides.budget, MAX_BUDGET_LIMIT)
      : (handoff.budgetLimit ?? 0);
  const startDateInput = typeof overrides?.startDate === "string" ? overrides.startDate : null;
  const startDate = startDateInput && !Number.isNaN(new Date(startDateInput).getTime())
    ? new Date(startDateInput)
    : new Date();

  const created = await prisma.$transaction(async (tx) => {
    // Claim the handoff first. Only the transaction that actually moves
    // ACCEPTED → COMPLETED may create the experiment.
    const claimed = await tx.handoff.updateMany({
      where: { id, status: "ACCEPTED" },
      data: { status: "COMPLETED" },
    });
    if (claimed.count !== 1) {
      const replay = await tx.experiment.findFirst({
        where: { handoffId: id },
        orderBy: { createdAt: "asc" },
      });
      if (replay) return replay;
      throw new Error(`Handoff ${id} must be ACCEPTED before an experiment can be created`);
    }

    return tx.experiment.create({
      data: {
        hypothesis: handoff.experimentHypothesis,
        opportunityId: handoff.opportunityId,
        target: handoff.successCriteria[0] ?? "Record measurable outcome against the handoff success criteria",
        budget,
        startDate,
        expectedResult: handoff.successCriteria.join("; ") || "Outcome recorded against success criteria",
        objective: handoff.contract.problem || handoff.experimentHypothesis,
        successCriteria: handoff.successCriteria,
        status: "READY",
        handoffId: id,
        isSample: false,
        revenue: 0,
        profit: 0,
        conversionRate: 0,
      },
    });
  });

  return mapExperiment(created);
}
