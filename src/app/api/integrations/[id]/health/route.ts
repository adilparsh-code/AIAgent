import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { runHealthCheck } from "@/lib/integrations/service";

/**
 * Phase 8 — run a REAL health check for one integration and persist the
 * result. Never fabricates status: whatever the adapter probe returns is
 * what gets stored and shown.
 */
export async function POST(_request: Request, context: { params: { id: string } }) {
  try {
    await requireUser();
    const { id } = context.params;
    if (typeof id !== "string" || id.length === 0 || id.length > 64) {
      return NextResponse.json({ error: "Invalid integration id" }, { status: 400 });
    }
    const summary = await runHealthCheck(id);
    if (!summary) {
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    }
    return NextResponse.json({ integration: summary });
  } catch (error) {
    return apiError(error, "Health check failed");
  }
}
