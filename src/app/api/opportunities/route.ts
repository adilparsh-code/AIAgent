import { NextResponse } from "next/server";
import { opportunityRepository } from "@/lib/server/repositories/opportunities";
import { apiError } from "@/lib/api-error";
import { requireUser } from "@/lib/server/authz";
import type { Opportunity } from "@/lib/types";

/**
 * Phase 6A — all routes require authentication. List/create are owner-scoped:
 * users only ever see and create their own opportunities. Ownership comes from
 * the session; any client-supplied owner/user id is ignored.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const rows = await opportunityRepository.getAll(user.id);
    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error, "Failed to load opportunities");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as Partial<Opportunity> & { ownerId?: unknown };
    if (!body?.title || !body?.category || !body?.businessModel) {
      return NextResponse.json({ error: "title, category, and businessModel are required" }, { status: 400 });
    }
    const created = await opportunityRepository.create({
      ...(body as Omit<Opportunity, "id" | "createdAt" | "updatedAt">),
      // Server-side ownership assignment — request fields cannot override it.
      ownerId: user.id,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to create opportunity");
  }
}
