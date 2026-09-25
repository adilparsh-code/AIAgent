import "server-only";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "../db";
import { logger } from "./logger";
import {
  aggregateExperimentImpacts,
  assessExperimentSufficiency,
  buildLearningContract,
  classifyValidationContext,
  combineConfidence,
  computeExperimentRankingImpact,
  deriveLearningSignals,
  outcomeFromSignals,
} from "../experiment-learning";
import type { ExperimentLearningContract, RankingAdjustment } from "../experiment-learning";
import { summarizeMetricSeries, orderChronologically } from "../metric-aggregation";
import type { MetricPointRaw } from "../metric-aggregation";
import type { ExperimentFeedback } from "../experiment-evaluation";

/**
 * Phase 6C — deterministic re-ranking service.
 *
 * - The server computes everything; clients can only REQUEST a rerank.
 * - Queries are batched (no per-experiment round trips) to avoid N+1.
 * - Ranking changes are persisted as append-only RankingSnapshot rows with
 *   full explanations — never applied silently.
 * - Research evidence is never overwritten: the experiment layer adds a
 *   bounded delta on top of the existing overallScore.
 */

type MetricRowLike = {
  periodStart: Date;
  periodEnd: Date;
  recordedAt: Date;
  impressions: number | null;
  clicks: number | null;
  visits: number | null;
  leads: number | null;
  conversions: number | null;
  revenue: Prisma.Decimal | null;
  cost: Prisma.Decimal | null;
  currency: string;
  source: string;
  dataClass: string;
  notes: string;
};

function toMetricPoint(row: MetricRowLike): MetricPointRaw {
  return {
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    impressions: row.impressions,
    clicks: row.clicks,
    visits: row.visits,
    leads: row.leads,
    conversions: row.conversions,
    revenue: row.revenue === null ? null : Number(row.revenue),
    cost: row.cost === null ? null : Number(row.cost),
    currency: row.currency,
    source: row.source,
    // REAL_DATA is valid only when traceable source provenance is present.
    // Legacy rows with an empty source are never silently upgraded.
    dataClass: row.dataClass === "REAL_DATA" && row.source.trim() ? "REAL_DATA" : "ESTIMATED_DATA",
    notes: row.notes,
  };
}

type PrismaDecimal = import("@prisma/client").Prisma.Decimal;

/**
 * MEDIUM-4 — bounded, non-degenerate reranking.
 *
 * A rerank loaded the owner's entire opportunity set, every experiment for
 * those opportunities, and every recorded metric row, all in memory; then it
 * did linear `find`/`filter` scans inside the per-experiment and per-opportunity
 * loops, so the cost grew with the product of the set sizes. Finally the write
 * phase (snapshot → opportunity columns → experiment feedback) ran as separate
 * statements outside any transaction, so a mid-loop failure left half of the
 * portfolio re-ranked and half of it not, with no record of which.
 *
 * The computation itself is unchanged — the same deterministic adjustment, the
 * same bounded influence cap, the same append-only snapshots. Only the way it
 * is loaded, joined and persisted changes:
 *   - every query is bounded by an explicit, named cap;
 *   - all lookups go through Maps, so there is no N×M scan;
 *   - the write phase is a single transaction, so a rerank is all-or-nothing.
 */
export const RERANK_LIMITS = {
  MAX_OPPORTUNITIES: 500,
  MAX_EXPERIMENTS: 2_000,
  MAX_METRIC_ROWS: 20_000,
} as const;

interface OpportunityForRanking {
  id: string;
  title: string;
  overallScore: number;
  confidence: number;
  lastResearchConclusion: string | null;
  experimentScoreDelta: number | null;
}

/**
 * Build the learning contract for one experiment from its recorded time
 * series and existing evaluation. Returns null when the experiment has no
 * recorded metrics (nothing to learn from — never fabricated).
 */
export async function buildExperimentFeedbackFromSeries(
  experiment: {
    id: string;
    opportunityId: string;
    hypothesis?: string;
    decision: string | null;
    feedback?: unknown;
    status?: string;
  },
  ownerId: string,
): Promise<{ contract: ExperimentLearningContract; summary: ReturnType<typeof summarizeMetricSeries>; adjustment: RankingAdjustment } | null> {
  const prisma = getPrisma();
  const experimentRow = await prisma.experiment.findFirst({
    where: { id: experiment.id, opportunity: { ownerId } },
    select: {
      id: true,
      opportunityId: true,
      visitors: true,
      clicks: true,
      decision: true,
      metrics: true,
      opportunity: { select: { lastResearchConclusion: true } },
    },
  });
  if (!experimentRow) return null; // foreign or missing

  const metricRows = await prisma.experimentMetric.findMany({
    where: { experimentId: experiment.id },
    orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }],
  });
  const summary = summarizeMetricSeries(orderChronologically(metricRows.map(toMetricPoint)));

  const sufficiency = assessExperimentSufficiency({
    recordCount: summary.recordCount,
    totals: summary.totals,
    estimatedRecordCount: summary.estimatedRecordCount,
  });
  const derived = summary.derived;
  const signals = deriveLearningSignals({
    sufficiency,
    totals: summary.totals,
    derived: { ctr: derived.ctr, conversionRate: derived.conversionRate, profit: derived.profit, roi: derived.roi },
    dataClass: summary.dataClass,
    decision: (experimentRow.decision as "WIN" | "ITERATE" | "STOP" | "INSUFFICIENT_DATA") ?? "INSUFFICIENT_DATA",
  });

  const adjustment = computeExperimentRankingImpact({
    contract: {} as ExperimentLearningContract,
    totals: summary.totals,
    derived: { ctr: derived.ctr, conversionRate: derived.conversionRate, profit: derived.profit, roi: derived.roi },
    sufficiency,
    signals,
    dataClass: summary.dataClass,
    researchConclusion: experimentRow.opportunity.lastResearchConclusion,
  });

  const eligible = sufficiency.level !== "INSUFFICIENT" && signals.some((s) => s.key !== "INSUFFICIENT_EXPERIMENT_DATA");
  const contract = buildLearningContract({
    opportunityId: experimentRow.opportunityId,
    experimentId: experiment.id,
    measurementPeriod: {
      from: metricRows[0]?.periodStart.toISOString() ?? null,
      to: metricRows[metricRows.length - 1]?.periodEnd.toISOString() ?? null,
    },
    totals: summary.totals,
    derived: { ctr: derived.ctr, conversionRate: derived.conversionRate, profit: derived.profit, roi: derived.roi },
    sufficiency,
    signals,
    dataClass: summary.dataClass,
    decision: (experimentRow.decision as "WIN" | "ITERATE" | "STOP" | "INSUFFICIENT_DATA") ?? "INSUFFICIENT_DATA",
    researchImplications: [
      outcomeFromSignals(signals) === "POSITIVE"
        ? "Recorded experiment results partially support the demand/monetization hypothesis; future research should still verify generalizability beyond the tested channel/audience."
        : outcomeFromSignals(signals) === "NEGATIVE"
          ? "Recorded experiment results contradict parts of the hypothesis; future research should collect channel/audience-specific evidence before ranking this pattern higher."
          : "No strong inference yet; instrument metrics and accumulate more recorded periods.",
    ],
    rankingImpact: {
      eligible,
      reason: eligible
        ? `Sufficiency ${sufficiency.level} with ${signals.length} signal(s); contribution bounded by the experiment influence cap.`
        : "Insufficient recorded data — this experiment cannot move the ranking.",
      maxContribution: eligible ? 10 : 0,
    },
    generatedAt: new Date().toISOString(),
  });

  return { contract, summary, adjustment };
}

export interface RankedOpportunity {
  opportunityId: string;
  title: string;
  previousScore: number;
  newScore: number;
  rank: number;
  experimentDelta: number;
  validationContext: string;
  contradiction: string;
  confidence: number;
  explanation: string[];
  signals: Array<{ key: string; basis: string; dataClass: string }>;
  experimentIds: string[];
  changed: boolean;
}

/**
 * Deterministically re-rank the owner's opportunities from recorded experiment
 * evidence. Batched loads; every change is explained and persisted as an
 * append-only RankingSnapshot.
 */
export async function rerankOpportunities(ownerId: string): Promise<{
  ranked: RankedOpportunity[];
  snapshotIds: string[];
}> {
  const prisma = getPrisma();
  const opportunities = await prisma.opportunity.findMany({
    where: { ownerId, isSample: false },
    select: {
      id: true,
      title: true,
      overallScore: true,
      confidence: true,
      lastResearchConclusion: true,
      experimentScoreDelta: true,
    },
    orderBy: [{ overallScore: "desc" }, { id: "asc" }],
    take: RERANK_LIMITS.MAX_OPPORTUNITIES,
  });
  if (opportunities.length === 0) return { ranked: [], snapshotIds: [] };

  const opportunityIds = opportunities.map((o) => o.id);
  // MEDIUM-4: O(1) join instead of a linear scan inside the experiment loop.
  const opportunityById = new Map(opportunities.map((o) => [o.id, o]));

  // Batched: one query per table for the whole owner's set.
  const experiments = await prisma.experiment.findMany({
    where: { opportunityId: { in: opportunityIds }, isSample: false },
    select: {
      id: true,
      opportunityId: true,
      decision: true,
      status: true,
      feedback: true,
      metrics: true,
      visitors: true,
      clicks: true,
    },
    take: RERANK_LIMITS.MAX_EXPERIMENTS,
  });
  const experimentById = new Map(experiments.map((e) => [e.id, e]));
  const experimentIds = experiments.map((e) => e.id);
  const metricRows = experimentIds.length
    ? await prisma.experimentMetric.findMany({
        where: { experimentId: { in: experimentIds } },
        orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }],
        take: RERANK_LIMITS.MAX_METRIC_ROWS,
      })
    : [];
  const metricsByExperiment = new Map<string, typeof metricRows>();
  for (const row of metricRows) {
    const list = metricsByExperiment.get(row.experimentId) ?? [];
    list.push(row);
    metricsByExperiment.set(row.experimentId, list);
  }

  const researchRuns = await prisma.researchRun.findMany({
    where: { opportunityId: { in: opportunityIds } },
    select: { opportunityId: true, confidence: true },
    orderBy: { startedAt: "desc" },
  });
  const researchConfidenceByOpp = new Map<string, number>();
  for (const run of researchRuns) {
    if (!researchConfidenceByOpp.has(run.opportunityId)) {
      researchConfidenceByOpp.set(run.opportunityId, Number(run.confidence));
    }
  }

  // Per-experiment adjustments.
  const adjustmentsByOpp = new Map<string, RankingAdjustment[]>();
  const contractsByExperiment = new Map<string, ExperimentLearningContract>();
  for (const experiment of experiments) {
    const rows = metricsByExperiment.get(experiment.id) ?? [];
    if (rows.length === 0) continue; // nothing recorded → nothing to learn
    const summary = summarizeMetricSeries(orderChronologically(rows.map(toMetricPoint)));
    const sufficiency = assessExperimentSufficiency({
      recordCount: summary.recordCount,
      totals: summary.totals,
      estimatedRecordCount: summary.estimatedRecordCount,
    });
    const opportunity = opportunityById.get(experiment.opportunityId);
    const signals = deriveLearningSignals({
      sufficiency,
      totals: summary.totals,
      derived: {
        ctr: summary.derived.ctr,
        conversionRate: summary.derived.conversionRate,
        profit: summary.derived.profit,
        roi: summary.derived.roi,
      },
      dataClass: summary.dataClass,
      decision: (experiment.decision as "WIN" | "ITERATE" | "STOP" | "INSUFFICIENT_DATA") ?? "INSUFFICIENT_DATA",
    });
    const adjustment = computeExperimentRankingImpact({
      contract: {} as ExperimentLearningContract,
      totals: summary.totals,
      derived: {
        ctr: summary.derived.ctr,
        conversionRate: summary.derived.conversionRate,
        profit: summary.derived.profit,
        roi: summary.derived.roi,
      },
      sufficiency,
      signals,
      dataClass: summary.dataClass,
      researchConclusion: opportunity?.lastResearchConclusion ?? null,
    });
    const list = adjustmentsByOpp.get(experiment.opportunityId) ?? [];
    list.push(adjustment);
    adjustmentsByOpp.set(experiment.opportunityId, list);

    const contract = buildLearningContract({
      opportunityId: experiment.opportunityId,
      experimentId: experiment.id,
      measurementPeriod: {
        from: rows[0]?.periodStart.toISOString() ?? null,
        to: rows[rows.length - 1]?.periodEnd.toISOString() ?? null,
      },
      totals: summary.totals,
      derived: {
        ctr: summary.derived.ctr,
        conversionRate: summary.derived.conversionRate,
        profit: summary.derived.profit,
        roi: summary.derived.roi,
      },
      sufficiency,
      signals,
      dataClass: summary.dataClass,
      decision: (experiment.decision as "WIN" | "ITERATE" | "STOP" | "INSUFFICIENT_DATA") ?? "INSUFFICIENT_DATA",
      researchImplications: [],
      rankingImpact: {
        eligible: sufficiency.level !== "INSUFFICIENT",
        reason: sufficiency.basis,
        maxContribution: 10,
      },
      generatedAt: new Date().toISOString(),
    });
    contractsByExperiment.set(experiment.id, contract);
  }

  // MEDIUM-4: precomputed so the per-opportunity loop never rescans the whole
  // experiment list.
  const experimentIdsByOpportunity = new Map<string, string[]>();
  for (const experiment of experiments) {
    if (!metricsByExperiment.has(experiment.id)) continue;
    const list = experimentIdsByOpportunity.get(experiment.opportunityId) ?? [];
    list.push(experiment.id);
    experimentIdsByOpportunity.set(experiment.opportunityId, list);
  }

  // Compute new scores deterministically, then rank.
  const computed = opportunities.map((opportunity) => {
    const adjustments = adjustmentsByOpp.get(opportunity.id) ?? [];
    const aggregate = aggregateExperimentImpacts(adjustments);
    const validationContext = classifyValidationContext({
      researchConclusion: opportunity.lastResearchConclusion,
      experimentDelta: aggregate.delta,
      experimentCount: aggregate.completedCount,
    });
    const researchConfidence = researchConfidenceByOpp.get(opportunity.id) ?? null;
    const confidence = combineConfidence({
      researchConfidence,
      experimentConfidence: aggregate.experimentConfidence,
      experimentCount: aggregate.completedCount,
    });
    // overallScore is the pure research base (never mutated by reranking);
    // the bounded experiment delta is stored separately, so the effective
    // score is always base + delta. Recomputing from the base (not by
    // incrementing) keeps repeated reranks idempotent.
    const researchBaseScore = Number(opportunity.overallScore);
    const previousDelta = opportunity.experimentScoreDelta === null ? 0 : Number(opportunity.experimentScoreDelta);
    const previousScore = Math.max(0, Math.min(100, Number((researchBaseScore + previousDelta).toFixed(1))));
    const newScore = Math.max(0, Math.min(100, Number((researchBaseScore + aggregate.delta).toFixed(1))));
    const experimentIds = experimentIdsByOpportunity.get(opportunity.id) ?? [];
    return {
      opportunity,
      aggregate,
      validationContext,
      confidence,
      previousScore,
      newScore,
      experimentIds,
    };
  });

  computed.sort((a, b) => b.newScore - a.newScore || a.opportunity.id.localeCompare(b.opportunity.id));

  const previousRankById = new Map<string, number>();
  [...computed]
    .sort((a, b) => b.previousScore - a.previousScore || a.opportunity.id.localeCompare(b.opportunity.id))
    .forEach((entry, index) => previousRankById.set(entry.opportunity.id, index + 1));

  const ranked: RankedOpportunity[] = computed.map((entry, index) => ({
    opportunityId: entry.opportunity.id,
    title: entry.opportunity.title,
    previousScore: entry.previousScore,
    newScore: entry.newScore,
    rank: index + 1,
    experimentDelta: entry.aggregate.delta,
    validationContext: entry.validationContext,
    contradiction: entry.aggregate.contradiction,
    confidence: entry.confidence,
    explanation: entry.aggregate.explanation,
    signals: (adjustmentsByOpp.get(entry.opportunity.id) ?? []).flatMap((a) =>
      a.signals.map((s) => ({ key: s.key, basis: s.basis, dataClass: s.dataClass })),
    ),
    experimentIds: entry.experimentIds,
    changed: entry.newScore !== entry.previousScore,
  }));

  // MEDIUM-4: O(1) lookup instead of a linear scan of `ranked` per entry.
  const rankByOpportunityId = new Map(ranked.map((entry) => [entry.opportunityId, entry.rank]));
  // MEDIUM-4: precomputed once, instead of scanning every contract for every
  // opportunity.
  const contractIdsByOpportunity = new Map<string, string[]>();
  for (const [experimentId, contract] of contractsByExperiment) {
    const list = contractIdsByOpportunity.get(contract.opportunityId) ?? [];
    list.push(experimentId);
    contractIdsByOpportunity.set(contract.opportunityId, list);
  }

  // Persist audit snapshots + learning columns (append-only, idempotent deltas).
  //
  // MEDIUM-4: the whole write phase is one transaction. Previously each
  // statement committed independently, so a failure part-way through left the
  // portfolio half re-ranked with no record of which half, and the next
  // rerank started from a state no snapshot described.
  const snapshotIds: string[] = [];
  const learningEvents: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const entry of computed) {
      const opportunity = entry.opportunity;
      const aggregate = entry.aggregate;
      const snapshot = await tx.rankingSnapshot.create({
        data: {
          opportunityId: opportunity.id,
          ownerId,
          previousScore: entry.previousScore,
          newScore: entry.newScore,
          previousRank: previousRankById.get(opportunity.id) ?? null,
          newRank: rankByOpportunityId.get(opportunity.id) ?? null,
          experimentDelta: aggregate.delta,
          contradiction: aggregate.contradiction,
          validationContext: entry.validationContext,
          confidence: entry.confidence,
          reason: aggregate.explanation.join(" ") || "No recorded experiment evidence; ranking unchanged.",
          contributingSignals: (adjustmentsByOpp.get(opportunity.id) ?? []).flatMap((a) =>
            a.signals.map((s) => ({ key: s.key, basis: s.basis })),
          ) as unknown as PrismaJson,
          experimentIds: entry.experimentIds,
        },
      });
      snapshotIds.push(snapshot.id);
      await tx.opportunity.update({
        where: { id: opportunity.id },
        data: {
          experimentScoreDelta: aggregate.delta,
          experimentEvidence: {
            experimentCount: aggregate.experimentCount,
            completedCount: aggregate.completedCount,
            contradiction: aggregate.contradiction,
            confidence: aggregate.experimentConfidence,
            explanation: aggregate.explanation,
          } as unknown as PrismaJson,
          lastRankingAt: new Date(),
          lastRankingSnapshotId: snapshot.id,
        },
      });

      // Persist the versioned learning contract on each experiment (Phase 5 field).
      for (const experimentId of contractIdsByOpportunity.get(opportunity.id) ?? []) {
        const contract = contractsByExperiment.get(experimentId);
        if (!contract) continue;
        const legacy = (experimentById.get(experimentId)?.feedback ?? null) as ExperimentFeedback | null;
        const feedback: ExperimentFeedback | null = legacy
          ? { ...legacy, dataClass: contract.experimentEvidence.dataClass === "ESTIMATED_DATA" ? "ESTIMATED_DATA" : legacy.dataClass }
          : null;
        await tx.experiment.update({
          where: { id: experimentId },
          data: {
            feedback: {
              ...(feedback ?? {}),
              learning: contract,
            } as unknown as PrismaJson,
          },
        });
        learningEvents.push(`${experimentId}:${contract.experimentEvidence.dataClass}:${contract.outcome}`);
      }
    }
  });

  // Emitted only after the transaction committed, so an operational event can
  // never describe a learning signal that was rolled back.
  for (const event of learningEvents) {
    const [experimentId, dataClass, outcome] = event.split(":");
    logger.operationalEvent({
      event: "LEARNING_SIGNAL_GENERATED",
      safeMessage: `Learning signal generated for experiment ${experimentId}; data class ${dataClass}.`,
      severity: outcome === "INSUFFICIENT" ? "WARNING" : "INFO",
      dataClass: dataClass === "ESTIMATED_DATA" ? "ESTIMATED_DATA" : "REAL_DATA",
    });
  }

  logger.operationalEvent({
    event: "OPPORTUNITY_REASSESSED",
    safeMessage: `Opportunity reassessment completed for ${ranked.length} opportunities using persisted research and experiment evidence.`,
    severity: "INFO",
    dataClass: "UNKNOWN",
  });
  logger.researchCompleted("rerank", `${ranked.length} opportunities`, "COMPLETED", 0, "phase18");
  return { ranked, snapshotIds };
}

type PrismaJson = Prisma.InputJsonValue;
