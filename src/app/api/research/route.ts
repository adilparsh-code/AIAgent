import { NextResponse } from "next/server";
import { runResearch } from "@/lib/research-orchestrator";

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

    const result = await runResearch(opportunityId, title);
    return NextResponse.json(result, { status: result.status === "FAILED" ? 502 : 200 });
  } catch {
    return NextResponse.json({ error: "Invalid research request" }, { status: 400 });
  }
}
