import { NextResponse } from "next/server";
import { runResearch } from "@/lib/research-orchestrator";
import { researchRepository } from "@/lib/server/repositories/research";
import { ensureOpportunityExists } from "@/lib/server/ensure-opportunity";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";
import { logger } from "@/lib/server/logger";
import { requireUser } from "@/lib/server/authz";
import { opportunityRepository } from "@/lib/server/repositories/opportunities";
import { ForbiddenError } from "@/lib/authz-errors";
import { SAMPLE_OPPORTUNITIES } from "@/lib/data/opportunities";

const SAMPLE_OPPORTUNITY_IDS = new Set(SAMPLE_OPPORTUNITIES.map((item) => item.id));

const MAX_TITLE_LENGTH = 240;
const MAX_ID_LENGTH = 64;

function safeId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_ID_LENGTH);
}

/**
 * Phase 6A — research history is owner-scoped through the owning opportunity:
 * users can only list/read runs for their own opportunities.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const opportunityId = safeId(searchParams.get("opportunityId"));
    const id = safeId(searchParams.get("id"));
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? 10) || 10));

    const assertOwnership = async (ownerOpportunityId: string): Promise<boolean> => {
      const owned = await opportunityRepository.getById(ownerOpportunityId, user.id);
      return Boolean(owned);
    };

    if (id) {
      const run = await researchRepository.getById(id, user.id);
      if (!run) return NextResponse.json({ error: "Research run not found" }, { status: 404 });
      return NextResponse.json(run);
    }

    if (!opportunityId) {
      return NextResponse.json({ error: "opportunityId or id is required" }, { status: 400 });
    }

    if (!(await assertOwnership(opportunityId))) {
      return NextResponse.json({ error: "Research runs not found" }, { status: 404 });
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
    const user = await requireUser();
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

    // Only opportunities owned by the caller may be researched. Pinned sample
    // opportunities are public demo data (rendered to every user) and remain
    // researchable; arbitrary unowned/legacy rows stay protected.
    const owned = await opportunityRepository.getById(opportunityId, user.id);
    const isPinnedSample = SAMPLE_OPPORTUNITY_IDS.has(opportunityId);
    if (!owned && !isPinnedSample) {
      throw new ForbiddenError("Resource not found");
    }

    if (isPinnedSample && !owned) {
      await ensureOpportunityExists(opportunityId);
    }
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
