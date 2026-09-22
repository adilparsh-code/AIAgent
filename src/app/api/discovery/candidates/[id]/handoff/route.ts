import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";
import { safeId } from "@/lib/discovery-input";
import { prepareHandoff } from "@/lib/server/discovery-service";

/**
 * POST /api/discovery/candidates/[id]/handoff
 * Prepares the machine-readable AI Income Lab handoff contract.
 * Does not execute Income Lab implementation actions.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const id = safeId(params.id);
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const result = await prepareHandoff(id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      candidate: result.candidate,
      handoff: result.handoff,
      note: "Handoff contract prepared. AI Income Lab actions are not executed by AIAgent.",
    });
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json(
        { error: "DATABASE_URL is not configured — handoff cannot be prepared without persistence" },
        { status: 503 },
      );
    }
    return apiError(error, "Failed to prepare handoff");
  }
}
