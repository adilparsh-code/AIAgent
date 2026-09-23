import { NextResponse } from "next/server";
import { experimentRepository } from "@/lib/server/repositories/experiments";
import { apiError } from "@/lib/api-error";
import {
  buildExperimentFeedback,
  decideExperiment,
  evaluateExperimentMetrics,
} from "@/lib/experiment-evaluation";
import type { ExperimentMetrics } from "@/lib/experiment-evaluation";
import { MAX_ID_LENGTH } from "@/lib/server/experiment-input";

const MAX_ID = 64;

function safeId(value: string): string {
  return value.trim().slice(0, Math.min(MAX_ID_LENGTH, MAX_ID));
}

/**
 * Phase 5 — Experiment evaluation + feedback.
 * GET  /api/experiments/:id/evaluate → evaluation preview (nothing persisted)
 * POST /api/experiments/:id/evaluate → evaluate recorded metrics, persist
 *      result + decision + feedback. Explicit rules only; no data is invented
 *      and missing metrics stay missing.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const experiment = await experimentRepository.getById(safeId(params.id));
    if (!experiment) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    const metrics = (experiment.metrics ?? {}) as ExperimentMetrics;
    const hasTraffic = (experiment.visitors ?? 0) > 0 || (experiment.clicks ?? 0) > 0;
    return NextResponse.json({
      evaluation: evaluateExperimentMetrics(metrics),
      decision: decideExperiment(metrics, hasTraffic),
    });
  } catch (error) {
    return apiError(error, "Failed to evaluate experiment");
  }
}

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const experiment = await experimentRepository.getById(safeId(params.id));
    if (!experiment) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });

    const metrics = (experiment.metrics ?? {}) as ExperimentMetrics;
    const hasTraffic = (experiment.visitors ?? 0) > 0 || (experiment.clicks ?? 0) > 0;
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
    });
  } catch (error) {
    return apiError(error, "Failed to evaluate experiment");
  }
}
