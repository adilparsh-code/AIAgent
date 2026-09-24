import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getOpportunityReadiness } from "@/lib/server/opportunity-readiness-service";

/**
 * GET /api/opportunities/:id/readiness — deterministic decision-readiness
 * computed from persisted application data only. No external API is called.
 *
 * - requireUser() first; identity comes from the server session.
 * - Owner-scoped: a foreign opportunity is an indistinguishable 404.
 * - Sample opportunities never expose private readiness data (404).
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = params.id.trim().slice(0, 64);
    const readiness = await getOpportunityReadiness(id, user.id);
    if (!readiness) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    return NextResponse.json({ opportunityId: id, readiness });
  } catch (error) {
    return apiError(error, "Failed to load readiness");
  }
}
