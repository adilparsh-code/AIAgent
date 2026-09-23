import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { buildExperimentFeedbackFromSeries } from "@/lib/server/learning-service";
import { getPrisma } from "@/lib/db";
import { MAX_ID_LENGTH } from "@/lib/server/experiment-input";

function safeId(value: string): string {
  return value.trim().slice(0, MAX_ID_LENGTH);
}

/**
 * Phase 6C — experiment feedback contract.
 *
 * GET  /api/experiments/:id/feedback → current persisted learning contract
 * POST /api/experiments/:id/feedback → (re)build the contract from the
 *      recorded time series. Deterministic rules only; the client cannot
 *      supply any score, signal, or outcome. Owner-scoped (404 for foreign).
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = safeId(params.id);
    const row = await getPrisma().experiment.findFirst({
      where: { id, opportunity: { ownerId: user.id } },
      select: { feedback: true },
    });
    if (!row) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    const feedback = row.feedback as { learning?: unknown } | null;
    if (!feedback?.learning) {
      return NextResponse.json(
        { error: "No learning feedback generated yet — POST to build it from recorded metrics" },
        { status: 404 },
      );
    }
    return NextResponse.json({ learning: feedback.learning });
  } catch (error) {
    return apiError(error, "Failed to load feedback");
  }
}

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = safeId(params.id);
    const exists = await getPrisma().experiment.findFirst({
      where: { id, opportunity: { ownerId: user.id } },
      select: { id: true, opportunityId: true, hypothesis: true, decision: true, status: true },
    });
    if (!exists) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });

    const built = await buildExperimentFeedbackFromSeries(exists, user.id);
    if (!built) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });

    // Persist the contract alongside any legacy Phase 5 feedback.
    const existing = await getPrisma().experiment.findUnique({ where: { id }, select: { feedback: true } });
    const legacy = (existing?.feedback ?? null) as Record<string, unknown> | null;
    await getPrisma().experiment.update({
      where: { id },
      data: { feedback: { ...(legacy ?? {}), learning: built.contract } as never },
    });
    return NextResponse.json({ learning: built.contract, summary: built.summary }, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to build feedback");
  }
}
