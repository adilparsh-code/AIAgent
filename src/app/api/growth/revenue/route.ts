import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import {
  getRevenueIntelligence,
  REVENUE_INTELLIGENCE_BOUNDS,
} from "@/lib/server/revenue-intelligence-service";

/**
 * GET /api/growth/revenue — Phase 26 owner-scoped revenue intelligence.
 *
 * - requireUser() first; identity comes only from the server session.
 * - Reads the caller's own non-sample rows; no cross-tenant access.
 * - Bounded reads; advisory/read-only; never executes, spends, or publishes.
 * - Revenue is claimed only from REAL_DATA provenance; with no real data the
 *   response honestly reports NOT_MEASURED / INSUFFICIENT_DATA semantics.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const state = await getRevenueIntelligence(user.id);
    return NextResponse.json(state);
  } catch (error) {
    return apiError(error, "Failed to load revenue intelligence");
  }
}
