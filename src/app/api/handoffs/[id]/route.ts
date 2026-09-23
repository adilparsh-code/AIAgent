import { NextResponse } from "next/server";
import { createExperimentFromHandoff, decideHandoff, getHandoff } from "@/lib/server/handoff-service";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";
import { requireUser } from "@/lib/server/authz";

const MAX_BODY_BYTES = 4_096;
const MAX_ID_LENGTH = 64;

function safeId(value: string): string {
  return value.trim().slice(0, MAX_ID_LENGTH);
}

/**
 * Phase 5 — Handoff detail and transitions. Phase 6A: every action is
 * owner-scoped — only the owning user can view, accept, reject, or create an
 * experiment from a handoff. Foreign handoffs answer 404.
 * GET  /api/handoffs/:id   → retrieve handoff
 * POST /api/handoffs/:id   → { action: "accept" | "reject" | "createExperiment" }
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const handoff = await getHandoff(safeId(params.id), user.id);
    if (!handoff) return NextResponse.json({ error: "Handoff not found" }, { status: 404 });
    return NextResponse.json(handoff);
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    return apiError(error, "Failed to load handoff");
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    const body = JSON.parse(raw || "{}") as {
      action?: unknown;
      rejectionReason?: unknown;
      budget?: unknown;
      startDate?: unknown;
    };
    const id = safeId(params.id);

    if (body.action === "accept") {
      const handoff = await decideHandoff(id, "accept", undefined, user.id);
      if (!handoff) return NextResponse.json({ error: "Handoff not found" }, { status: 404 });
      return NextResponse.json(handoff);
    }

    if (body.action === "reject") {
      const reason = typeof body.rejectionReason === "string" ? body.rejectionReason : undefined;
      const handoff = await decideHandoff(id, "reject", reason, user.id);
      if (!handoff) return NextResponse.json({ error: "Handoff not found" }, { status: 404 });
      return NextResponse.json(handoff);
    }

    if (body.action === "createExperiment") {
      if (typeof body.budget !== "undefined" && (typeof body.budget !== "number" || !Number.isFinite(body.budget) || body.budget < 0)) {
        return NextResponse.json({ error: "budget must be a non-negative number" }, { status: 400 });
      }
      // The created experiment inherits ownership through the handoff's
      // opportunity — ownership is never taken from the request body.
      const experiment = await createExperimentFromHandoff(id, { budget: body.budget, startDate: body.startDate }, user.id);
      if (!experiment) return NextResponse.json({ error: "Handoff not found" }, { status: 404 });
      return NextResponse.json(experiment, { status: 201 });
    }

    return NextResponse.json({ error: "action must be accept, reject, or createExperiment" }, { status: 400 });
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "";
    if (/was not found$/.test(message)) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (/cannot be re-decided|must be ACCEPTED/.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    return apiError(error, "Handoff action failed");
  }
}
