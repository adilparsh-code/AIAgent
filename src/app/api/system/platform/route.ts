import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getPlatformIntegrationSnapshot } from "@/lib/server/platform-integration-service";

/**
 * GET /api/system/platform — Phase 24 owner-scoped production integration
 * snapshot across the full lifecycle. Read-only, bounded, no provider calls,
 * no execution, no fabricated state.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const snapshot = await getPlatformIntegrationSnapshot(user.id);
    return NextResponse.json(snapshot);
  } catch (error) {
    return apiError(error, "Failed to load platform integration snapshot");
  }
}
