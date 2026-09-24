import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getFeedbackBoundary, ingestExternalFeedback } from "@/lib/server/feedback-service";
import { MAX_ID_LENGTH } from "@/lib/server/experiment-input";

function safeId(value: string): string {
  return value.trim().slice(0, MAX_ID_LENGTH);
}

/** Inspect the provider boundary without pretending that a provider exists. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const boundary = await getFeedbackBoundary(safeId(params.id), user.id);
    if (!boundary) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    return NextResponse.json(boundary);
  } catch (error) {
    return apiError(error, "Failed to inspect feedback boundary");
  }
}

/**
 * Ingestion is intentionally unavailable until an owner-configured adapter is
 * injected server-side. This endpoint remains a safe, truthful boundary rather
 * than accepting client-supplied provider data or creating fake feedback.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = safeId(params.id);
    const raw = await request.text().catch(() => "");
    if (raw.length > 2_000) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    const result = await ingestExternalFeedback({ experimentId: id, ownerId: user.id, idempotencyKey: `api:${user.id}:${id}` });
    if (!result.boundary) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    if (result.status === "NOT_CONFIGURED") {
      return NextResponse.json({ ...result, message: "External feedback provider unavailable/not configured." }, { status: 503 });
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    return apiError(error, "Failed to ingest external feedback");
  }
}
