import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getIntegrationSummary } from "@/lib/integrations/service";

/**
 * Phase 8 — single integration detail. Unknown adapter names answer 404
 * (indistinguishable from missing), consistent with the app's authz style.
 */
export async function GET(_request: Request, context: { params: { id: string } }) {
  try {
    await requireUser();
    const { id } = context.params;
    if (typeof id !== "string" || id.length === 0 || id.length > 64) {
      return NextResponse.json({ error: "Invalid integration id" }, { status: 400 });
    }
    const integration = await getIntegrationSummary(id);
    if (!integration) {
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    }
    return NextResponse.json({ integration });
  } catch (error) {
    return apiError(error, "Failed to load integration");
  }
}
