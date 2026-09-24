import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getResearchHistoryForOpportunity } from "@/lib/server/research-history-service";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = params.id.trim().slice(0, 64);
    const summary = await getResearchHistoryForOpportunity(id, user.id);
    if (!summary) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    return NextResponse.json({ opportunityId: id, ...summary });
  } catch (error) {
    return apiError(error, "Failed to load research history");
  }
}
