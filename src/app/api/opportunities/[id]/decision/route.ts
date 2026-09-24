import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getOpportunityDecision } from "@/lib/server/opportunity-decision-service";

/**
 * GET /api/opportunities/:id/decision — deterministic opportunity decision
 * computed from persisted application data only. No external API is called.
 *
 * - requireUser() first; identity comes from the server session.
 * - Owner-scoped: a foreign opportunity is an indistinguishable 404.
 * - Sample opportunities never expose private decision data (404).
 * - Bounded database reads; no unbounded loads; no sample leakage.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = params.id.trim().slice(0, 64);
    const decision = await getOpportunityDecision(id, user.id);
    if (!decision) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    return NextResponse.json({
      opportunityId: id,
      decision,
    });
  } catch (error) {
    return apiError(error, "Failed to load decision");
  }
}
