import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";
import { sanitizeRequestId } from "@/lib/integrations/test-execution";
import { runLiveResearchCycle, LIVE_RESEARCH_LIMITS } from "@/lib/server/live-research-cycle-service";

const MAX_BODY_BYTES = 8_000;

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const raw = await request.text().catch(() => "");
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    let body: { opportunityId?: unknown; title?: unknown; requestId?: unknown; providerIds?: unknown } = {};
    if (raw.trim()) {
      try { body = JSON.parse(raw) as typeof body; } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
    }
    const opportunityId = typeof body.opportunityId === "string" ? body.opportunityId.trim().slice(0, 64) : "";
    const title = typeof body.title === "string" ? body.title.trim().slice(0, LIVE_RESEARCH_LIMITS.MAX_TITLE_LENGTH) : "";
    const requestId = sanitizeRequestId(body.requestId);
    if (!opportunityId || title.length < 3 || !requestId) {
      return NextResponse.json({ error: "opportunityId, title (minimum 3 characters), and a safe requestId are required" }, { status: 400 });
    }
    const providerIds = Array.isArray(body.providerIds)
      ? body.providerIds.filter((value): value is string => typeof value === "string").slice(0, LIVE_RESEARCH_LIMITS.MAX_PROVIDERS)
      : undefined;
    const result = await runLiveResearchCycle({ ownerId: user.id, opportunityId, title, requestId, providerIds });
    return NextResponse.json(result, { status: result.status === "BLOCKED" ? 502 : result.status === "NOT_CONFIGURED" ? 409 : 200 });
  } catch (error) {
    if (isDbUnavailableError(error)) return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    return apiError(error, "Live research cycle failed");
  }
}
