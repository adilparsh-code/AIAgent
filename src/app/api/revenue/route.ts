import { NextResponse } from "next/server";
import { revenueRepository } from "@/lib/server/repositories/revenue";
import { apiError } from "@/lib/api-error";
import { requireUser } from "@/lib/server/authz";
import { opportunityRepository } from "@/lib/server/repositories/opportunities";
import { ForbiddenError } from "@/lib/authz-errors";
import type { RevenueEntry } from "@/lib/types";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await revenueRepository.getAll(user.id);
    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error, "Failed to load revenue");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as Omit<RevenueEntry, "id">;
    if (body.grossRevenue === undefined || body.grossRevenue === null) {
      return NextResponse.json({ error: "grossRevenue is required" }, { status: 400 });
    }
    if (body.opportunityId) {
      const owned = await opportunityRepository.getById(body.opportunityId, user.id);
      if (!owned) throw new ForbiddenError("Resource not found");
    }
    const created = await revenueRepository.create({ ...body, ownerId: user.id });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to create revenue entry");
  }
}
