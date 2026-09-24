import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getSystemHealth } from "@/lib/server/system-health-service";

/** GET /api/system/health — authenticated, lightweight, owner-scoped. */
export async function GET() {
  try {
    const user = await requireUser();
    const health = await getSystemHealth(user.id);
    return NextResponse.json({
      status: health.status,
      checks: health.checks,
      criticalFailures: health.criticalFailures,
      warnings: health.warnings,
      degradedComponents: health.degradedComponents,
      healthyComponents: health.healthyComponents,
      generatedAt: health.generatedAt,
    });
  } catch (error) {
    return apiError(error, "Failed to load system health");
  }
}
