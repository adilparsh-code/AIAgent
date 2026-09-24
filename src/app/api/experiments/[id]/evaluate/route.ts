import { NextResponse } from "next/server";
import { experimentRepository } from "@/lib/server/repositories/experiments";
import { metricRepository } from "@/lib/server/repositories/metrics";
import { apiError } from "@/lib/api-error";
import { requireUser } from "@/lib/server/authz";
import {
  buildExperimentFeedback,
  decideExperiment,
  evaluateExperimentMetrics,
} from "@/lib/experiment-evaluation";
import type { ExperimentMetrics } from "@/lib/experiment-evaluation";
import { orderChronologically, summarizeMetricSeries, toPhase5Metrics } from "@/lib/metric-aggregation";
import { MAX_ID_LENGTH } from "@/lib/server/experiment-input";

const MAX_ID = 64;

function safeId(value: string): string {
  return value.trim().slice(0, Math.min(MAX_ID_LENGTH, MAX_ID));
}

/**
 * Phase 5 evaluation, upgraded by Phase 6B.
 *
 * Sources of truth, in priority order:
 * 1. Recorded ExperimentMetric time-series rows (aggregated with strict
 *    missing-data semantics — sums of recorded values only).
 * 2. Otherwise the result is explicitly NOT_MEASURED. Legacy JSON snapshots
 *    have no traceable measurement provenance and cannot be upgraded to real.
 *
 * Decision rules are the unchanged, explicit Phase 5 rules. Feedback records
 * carry the data class of the underlying measurements.
 */
interface TimeSeriesResolution {
  metrics: ExperimentMetrics;
  source: "TIME_SERIES" | "NOT_MEASURED";
  dataClass: "REAL_DATA" | "ESTIMATED_DATA" | "MIXED" | "NOT_MEASURED";
  recordCount: number;
  estimatedRecordCount: number;
}

async function resolveMetrics(experimentId: string, ownerId: string): Promise<TimeSeriesResolution | null> {
  const rows = await metricRepository.listForOwner(experimentId, ownerId);
  if (rows === null) return null; // foreign/missing experiment
  if (rows.length > 0) {
    const safeRows = rows.map((row) => ({
      ...row,
      dataClass: row.dataClass === "REAL_DATA" && row.source.trim() ? "REAL_DATA" as const : "ESTIMATED_DATA" as const,
    }));
    const summary = summarizeMetricSeries(orderChronologically(safeRows));
    return {
      metrics: toPhase5Metrics(summary),
      source: "TIME_SERIES",
      dataClass: summary.dataClass,
      recordCount: summary.recordCount,
      estimatedRecordCount: summary.estimatedRecordCount,
    };
  }
  return {
    metrics: {} as ExperimentMetrics,
    source: "NOT_MEASURED",
    dataClass: "NOT_MEASURED",
    recordCount: 0,
    estimatedRecordCount: 0,
  };
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const experiment = await experimentRepository.getById(safeId(params.id), user.id);
    if (!experiment) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    const resolved = await resolveMetrics(experiment.id, user.id);
    if (!resolved) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });

    const metrics: ExperimentMetrics = resolved.source === "TIME_SERIES" ? resolved.metrics : {};
    const hasTraffic = resolved.source === "TIME_SERIES" && ((metrics.visits ?? 0) > 0 || (metrics.clicks ?? 0) > 0);
    return NextResponse.json({
      metricsSource: resolved.source,
      dataClass: resolved.dataClass,
      recordCount: resolved.recordCount,
      evaluation: evaluateExperimentMetrics(metrics),
      decision: decideExperiment(metrics, hasTraffic),
    });
  } catch (error) {
    return apiError(error, "Failed to evaluate experiment");
  }
}

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const experiment = await experimentRepository.getById(safeId(params.id), user.id);
    if (!experiment) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    const resolved = await resolveMetrics(experiment.id, user.id);
    if (!resolved) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });

    // A legacy experiment with no traceable metric rows is evaluated as an
    // explicit INCONCLUSIVE/NOT_MEASURED lifecycle, never as REAL_DATA.
    if (resolved.source === "TIME_SERIES" && resolved.dataClass !== "REAL_DATA") {
      return NextResponse.json(
        { error: "REAL_DATA is required for a learning decision; estimated metrics remain non-real", dataClass: resolved.dataClass },
        { status: 422 },
      );
    }
    const metrics: ExperimentMetrics = resolved.metrics;
    const hasTraffic = (metrics.visits ?? 0) > 0 || (metrics.clicks ?? 0) > 0;
    const decision = decideExperiment(metrics, hasTraffic);
    if (!decision) {
      return NextResponse.json({ error: "No metrics recorded to evaluate" }, { status: 422 });
    }
    const computed = evaluateExperimentMetrics(metrics);

    const feedback = buildExperimentFeedback({
      opportunityId: experiment.opportunityId,
      experimentId: experiment.id,
      hypothesis: experiment.hypothesis,
      metrics,
      decision: decision.decision,
    });
    if (resolved.source === "TIME_SERIES" && resolved.dataClass !== "REAL_DATA") {
      feedback.dataClass = resolved.dataClass === "ESTIMATED_DATA" ? "ESTIMATED_DATA" : "REAL_DATA";
      feedback.lessons.push(
        resolved.dataClass === "ESTIMATED_DATA"
          ? "All recorded metric periods are marked ESTIMATED_DATA; treat results as forecasts, not measurements."
          : `Series mixes estimated periods (${resolved.estimatedRecordCount} of ${resolved.recordCount}) with recorded ones; results are partly forecast-based.`,
      );
    } else if (resolved.dataClass === "NOT_MEASURED") {
      feedback.dataClass = "ESTIMATED_DATA";
      feedback.lessons.push("NOT_MEASURED: no traceable source-backed metric exists; no experiment outcome is inferred.");
    }

    const updated = await experimentRepository.update(experiment.id, {
      status: "COMPLETED",
      decision: decision.decision,
      result: decision.basis,
      actualResult: decision.basis,
      endDate: experiment.endDate ?? new Date().toISOString(),
      feedback,
    });
    if (!updated) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });

    return NextResponse.json({
      experiment: updated,
      feedback,
      evaluation: computed,
      metricsSource: resolved.source,
      dataClass: resolved.dataClass,
      recordCount: resolved.recordCount,
    });
  } catch (error) {
    return apiError(error, "Failed to evaluate experiment");
  }
}
