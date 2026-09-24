import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { requireUser } from "@/lib/server/authz";
import { getLaunchReadiness, LAUNCH_READINESS_BOUNDS } from "@/lib/server/launch-readiness-service";

/**
 * Phase 16 — authenticated, bounded, read-only pre-live readiness snapshot.
 * Provider activation and live-test gates are metadata only; this route never
 * calls a provider or executes research/external work.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const readiness = await getLaunchReadiness(user.id);
    return NextResponse.json({
      status: readiness.status,
      score: readiness.score,
      gates: readiness.gates,
      blockers: readiness.blockers,
      warnings: readiness.warnings,
      providerPending: readiness.externalProviderPending,
      liveTestPending: readiness.liveTestPending,
      securityReady: readiness.securityReady,
      dataReady: readiness.dataReady,
      executionReady: readiness.executionReady,
      observabilityReady: readiness.observabilityReady,
      generatedAt: readiness.generatedAt,
      bounds: LAUNCH_READINESS_BOUNDS,
    });
  } catch (error) {
    return apiError(error, "Failed to load launch readiness");
  }
}
