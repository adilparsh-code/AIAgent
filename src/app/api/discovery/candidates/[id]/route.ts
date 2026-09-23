import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";
import { safeId } from "@/lib/discovery-input";
import { discoveryRepository } from "@/lib/server/repositories/discovery";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const id = safeId(params.id);
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const found = await discoveryRepository.getCandidate(id);
    if (!found) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }
    return NextResponse.json({
      candidate: found.candidate,
      brief: found.candidate.brief,
      rankingBreakdown: found.candidate.rankingBreakdown,
      handoff: found.candidate.handoffPayload,
      run: {
        id: found.run.id,
        topic: found.run.topic,
        category: found.run.category,
        status: found.run.status,
      },
    });
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json(
        { error: "DATABASE_URL is not configured — opportunity briefs cannot be loaded without persistence" },
        { status: 503 },
      );
    }
    return apiError(error, "Failed to load opportunity brief");
  }
}
