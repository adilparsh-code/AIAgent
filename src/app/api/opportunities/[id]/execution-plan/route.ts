import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getOpportunityExecutionPlan } from "@/lib/server/autonomous-operating-loop-service";

export async function GET(_request: Request, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = context.params?.id?.trim().slice(0, 64) ?? "";
    if (!id) return NextResponse.json({ error: "Invalid opportunity id" }, { status: 400 });
    const result = await getOpportunityExecutionPlan(id, user.id);
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "Failed to load execution plan");
  }
}
