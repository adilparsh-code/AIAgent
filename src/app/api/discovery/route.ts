import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";
import { parseDiscoveryStartBody } from "@/lib/discovery-input";
import { executeDiscoveryRun } from "@/lib/server/discovery-service";
import { discoveryRepository } from "@/lib/server/repositories/discovery";
import { requireUser } from "@/lib/server/authz";

/**
 * Phase 6A — discovery runs are owner-scoped: users see and create only their
 * own runs. Created opportunities inherit the caller's ownership.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? 20) || 20));
    const rows = await discoveryRepository.listForOwner(user.id, limit);
    return NextResponse.json(rows);
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json(
        { error: "DATABASE_URL is not configured — discovery runs cannot be loaded without persistence" },
        { status: 503 },
      );
    }
    return apiError(error, "Failed to load discovery runs");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const raw = await request.text();
    const parsed = parseDiscoveryStartBody(raw);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const result = await executeDiscoveryRun({
      topic: parsed.topic,
      category: parsed.category,
      maxCandidates: parsed.maxCandidates,
      ownerId: user.id,
    });
    return NextResponse.json(result, { status: result.status === "FAILED" ? 502 : 200 });
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json(
        { error: "DATABASE_URL is not configured — discovery runs cannot be saved without persistence" },
        { status: 503 },
      );
    }
    return apiError(error, "Failed to start discovery run");
  }
}
