import { NextResponse } from "next/server";
import { createHandoff, listHandoffs } from "@/lib/server/handoff-service";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";
import { requireUser } from "@/lib/server/authz";

const MAX_BODY_BYTES = 8_192;

/**
 * Phase 5 — Opportunity Handoff API. Phase 6A: authenticated and owner-scoped.
 * GET  /api/handoffs            → list the caller's handoffs
 * POST /api/handoffs            → create + validate handoff for an OWNED opportunity
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? 50);
    const rows = await listHandoffs(Number.isFinite(limit) ? limit : 50, user.id);
    return NextResponse.json(rows);
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    return apiError(error, "Failed to load handoffs");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    const body = JSON.parse(raw) as {
      opportunityId: unknown;
      recommendedExperiment?: unknown;
      budgetLimit?: unknown;
      timeLimitDays?: unknown;
      experimentHypothesis?: unknown;
    };
    if (!body || typeof body !== "object" || typeof body.opportunityId !== "string") {
      return NextResponse.json({ error: "opportunityId is required" }, { status: 400 });
    }

    // Ownership enforced inside the service: a foreign opportunity is "not found".
    const result = await createHandoff({ ...body, ownerId: user.id });
    if (!result.ok) {
      return NextResponse.json(
        {
          error: "Opportunity is not ready for handoff",
          reasons: result.reasons,
        },
        { status: 422 },
      );
    }
    return NextResponse.json(result.handoff, { status: 201 });
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    if (error instanceof Error && /^Opportunity .+ was not found$/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    return apiError(error, "Failed to create handoff");
  }
}
