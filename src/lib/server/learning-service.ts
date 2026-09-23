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
    dataClass: row.dataClass === "ESTIMATED_DATA" ? "ESTIMATED_DATA" : "REAL_DATA",
    notes: row.notes,
  };
}

type PrismaDecimal = import("@prisma/client").Prisma.Decimal;

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
  });
  if (opportunities.length === 0) return { ranked: [], snapshotIds: [] };

  const opportunityIds = opportunities.map((o) => o.id);

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
  });
  const experimentIds = experiments.map((e) => e.id);
  const metricRows = experimentIds.length
    ? await prisma.experimentMetric.findMany({
        where: { experimentId: { in: experimentIds } },
        orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }],
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
    const opportunity = opportunities.find((o) => o.id === experiment.opportunityId);
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
    const experimentIds = experiments
      .filter((e) => e.opportunityId === opportunity.id && metricsByExperiment.has(e.id))
      .map((e) => e.id);
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

  // Persist audit snapshots + learning columns (append-only, idempotent deltas).
  const snapshotIds: string[] = [];
  for (const entry of computed) {
    const opportunity = entry.opportunity;
    const aggregate = entry.aggregate;
    const rankedEntry = ranked.find((r) => r.opportunityId === opportunity.id)!;
    const snapshot = await prisma.rankingSnapshot.create({
      data: {
        opportunityId: opportunity.id,
        ownerId,
        previousScore: entry.previousScore,
        newScore: entry.newScore,
        previousRank: previousRankById.get(opportunity.id) ?? null,
        newRank: rankedEntry.rank,
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
    await prisma.opportunity.update({
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
    for (const [experimentId, contract] of contractsByExperiment) {
      if (contract.opportunityId !== opportunity.id) continue;
      const existing = experiments.find((e) => e.id === experimentId);
      const legacy = (existing?.feedback ?? null) as ExperimentFeedback | null;
      const feedback: ExperimentFeedback | null = legacy
        ? { ...legacy, dataClass: contract.experimentEvidence.dataClass === "ESTIMATED_DATA" ? "ESTIMATED_DATA" : legacy.dataClass }
        : null;
      await prisma.experiment.update({
        where: { id: experimentId },
        data: {
          feedback: {
            ...(feedback ?? {}),
            learning: contract,
          } as unknown as PrismaJson,
        },
      });
    }
  }

  logger.researchCompleted("rerank", `${ranked.length} opportunities`, "COMPLETED", 0, "phase6c");
  return { ranked, snapshotIds };
}

type PrismaJson = Prisma.InputJsonValue;
