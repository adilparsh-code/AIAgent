import { NextResponse } from "next/server";
import { runResearch } from "@/lib/research-orchestrator";
import { researchRepository } from "@/lib/server/repositories/research";
import { ensureOpportunityExists } from "@/lib/server/ensure-opportunity";
import { apiError } from "@/lib/api-error";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const opportunityId = searchParams.get("opportunityId")?.trim() ?? "";
    const id = searchParams.get("id")?.trim() ?? "";

    if (id) {
      const run = await researchRepository.getById(id);
      if (!run) return NextResponse.json({ error: "Research run not found" }, { status: 404 });
      return NextResponse.json(run);
    }

    if (!opportunityId) {
      return NextResponse.json({ error: "opportunityId or id is required" }, { status: 400 });
    }

    const latest = searchParams.get("latest") === "1";
    if (latest) {
      const run = await researchRepository.getLatestByOpportunityId(opportunityId);
      return NextResponse.json(run);
    }

    const history = await researchRepository.getByOpportunityId(opportunityId);
    return NextResponse.json(history);
  } catch (error) {
    return apiError(error, "Failed to load research history");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { opportunityId?: unknown; title?: unknown };
    const opportunityId = typeof body.opportunityId === "string" ? body.opportunityId.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";

    if (!opportunityId || !title) {
      return NextResponse.json(
        { error: "opportunityId and title are required" },
        { status: 400 },
      );
    }

    if (title.length > 240) {
      return NextResponse.json({ error: "title is too long" }, { status: 400 });
    }

    await ensureOpportunityExists(opportunityId);
    const result = await runResearch(opportunityId, title);
    const saved = await researchRepository.save(result);
    return NextResponse.json(saved, { status: saved.status === "FAILED" ? 502 : 200 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("was not found")) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return apiError(error, "Invalid research request");
  }
}
