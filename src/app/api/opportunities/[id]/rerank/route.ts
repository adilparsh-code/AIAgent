import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { rerankOpportunities } from "@/lib/server/learning-service";
import { getPrisma } from "@/lib/db";
import { MAX_ID_LENGTH } from "@/lib/server/experiment-input";

const MAX_BODY_BYTES = 1_024;

function safeId(value: string): string {
  return value.trim().slice(0, MAX_ID_LENGTH);
}

/**
 * POST /api/opportunities/:id/rerank — controlled, manual re-ranking trigger.
 * The client supplies NOTHING but the request: scores, deltas, and signals are
 * always computed server-side from recorded experiment data (no arbitrary
 * score injection, no infinite loops — one deterministic pass per call).
 * The rerank covers the owner's whole opportunity set so cross-opportunity
 * ranks stay consistent; the response is filtered to the requested id.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    if (raw && raw !== "{}") {
      try {
        const body = JSON.parse(raw) as Record<string, unknown>;
        if (Object.keys(body).length > 0) {
          return NextResponse.json({ error: "This endpoint accepts no input — ranking is computed server-side" }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }
    }

    const id = safeId(params.id);
    const owned = await getPrisma().opportunity.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });

    const { ranked, snapshotIds } = await rerankOpportunities(user.id);
    const target = ranked.find((entry) => entry.opportunityId === id);
    if (!target) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    return NextResponse.json({ ranking: target, snapshotIds });
  } catch (error) {
    return apiError(error, "Failed to rerank");
  }
}
