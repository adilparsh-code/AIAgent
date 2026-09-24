import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { runClosedLoopForExperiment } from "@/lib/server/closed-loop-service";
import { MAX_ID_LENGTH } from "@/lib/server/experiment-input";

function safeId(value: string): string {
  return value.trim().slice(0, MAX_ID_LENGTH);
}

/** Request one bounded, server-computed closed-loop pass; clients cannot inject scores. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const raw = await request.text().catch(() => "");
    if (raw.length > 1_024) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    if (raw.trim() && raw.trim() !== "{}") {
      return NextResponse.json({ error: "This endpoint accepts no input; closed-loop data is computed server-side" }, { status: 400 });
    }
    const result = await runClosedLoopForExperiment(safeId(params.id), user.id);
    if (!result) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    return NextResponse.json({
      experimentId: params.id,
      assessment: result.assessment,
      learning: result.feedback.contract,
      measurementSummary: result.feedback.summary,
      rankingSnapshotIds: result.rankingSnapshotIds,
    }, { status: 201 });
  } catch (error) {
    return apiError(error, "Closed-loop assessment failed");
  }
}
