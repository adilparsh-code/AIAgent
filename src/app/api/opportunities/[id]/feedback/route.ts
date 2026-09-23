import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getPrisma } from "@/lib/db";
import { MAX_ID_LENGTH } from "@/lib/server/experiment-input";

function safeId(value: string): string {
  return value.trim().slice(0, MAX_ID_LENGTH);
}

/**
 * GET /api/opportunities/:id/feedback — every experiment learning contract for
 * this opportunity, newest evidence first. Owner-scoped: a foreign opportunity
 * is a 404. Read-only aggregation; nothing is computed here that the pure
 * learning module has not already made deterministic.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = safeId(params.id);
    const owned = await getPrisma().opportunity.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });

    const experiments = await getPrisma().experiment.findMany({
      where: { opportunityId: id, isSample: false },
      select: { id: true, hypothesis: true, decision: true, status: true, feedback: true },
      orderBy: { updatedAt: "desc" },
    });
    const feedback = experiments.map((experiment) => {
      const stored = experiment.feedback as { learning?: unknown } | null;
      return {
        experimentId: experiment.id,
        hypothesis: experiment.hypothesis,
        decision: experiment.decision,
        status: experiment.status,
        learning: stored?.learning ?? null,
      };
    });
    return NextResponse.json({ opportunityId: id, feedback });
  } catch (error) {
    return apiError(error, "Failed to load opportunity feedback");
  }
}
