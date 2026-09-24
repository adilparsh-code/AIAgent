import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getAutonomousOperationsCycle } from "@/lib/server/autonomous-operations-service";

/** GET /api/portfolio/health — authenticated, owner-scoped, read-only. */
export async function GET() {
  try {
    const user = await requireUser();
    const operations = await getAutonomousOperationsCycle(user.id);
    return NextResponse.json({
      status: operations.health?.status ?? "UNKNOWN",
      health: operations.health,
      cycleId: operations.cycleId,
      nextRecommendedAction: operations.nextRecommendedAction,
      generatedAt: operations.health?.generatedAt ?? operations.completedAt,
    });
  } catch (error) {
    return apiError(error, "Failed to load portfolio health");
  }
}
