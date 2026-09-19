import { NextResponse } from "next/server";
import { runResearch } from "@/lib/research-orchestrator";
import { researchRepository } from "@/lib/server/repositories/research";
import { ensureOpportunityExists } from "@/lib/server/ensure-opportunity";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";
import { logger } from "@/lib/server/logger";

const MAX_TITLE_LENGTH = 240;
const MAX_ID_LENGTH = 64;

function safeId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_ID_LENGTH);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const opportunityId = safeId(searchParams.get("opportunityId"));
    const id = safeId(searchParams.get("id"));
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? 10) || 10));

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

    const history = await researchRepository.getByOpportunityId(opportunityId, limit);

    if (searchParams.get("include") === "validation") {
      const withValidation = await Promise.all(
        history.map(async (run) => ({
          ...run,
          persistedValidation: await researchRepository.getValidationByRunId(run.id),
        })),
      );
      return NextResponse.json(withValidation);
    }

    return NextResponse.json(history);
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json(
        { error: "DATABASE_URL is not configured — research runs cannot be loaded without persistence" },
        { status: 503 },
      );
    }
    return apiError(error, "Failed to load research history");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { opportunityId?: unknown; title?: unknown } | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const opportunityId = safeId(body.opportunityId);
    const title = typeof body.title === "string" ? body.title.trim().slice(0, MAX_TITLE_LENGTH) : "";

    if (!opportunityId || !title) {
      return NextResponse.json(
        { error: "opportunityId and title are required" },
        { status: 400 },
      );
    }

    if (title.length < 3) {
      return NextResponse.json({ error: "title must be at least 3 characters" }, { status: 400 });
    }

    await ensureOpportunityExists(opportunityId);
    logger.researchStarted(`pending-${Date.now()}`, opportunityId, []);
    const result = await runResearch(opportunityId, title);
    const saved = await researchRepository.save(result);
    return NextResponse.json(saved, { status: saved.status === "FAILED" ? 502 : 200 });
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json(
        { error: "DATABASE_URL is not configured — research runs cannot be saved without persistence" },
        { status: 503 },
      );
    }
    if (error instanceof Error && error.message.includes("was not found")) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return apiError(error, "Invalid research request");
  }
}
