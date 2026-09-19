import { NextResponse } from "next/server";
import { revenueRepository } from "@/lib/server/repositories/revenue";
import { apiError } from "@/lib/api-error";
import { ensureOpportunityExists } from "@/lib/server/ensure-opportunity";
import type { RevenueEntry } from "@/lib/types";

export async function GET() {
  try {
    const rows = await revenueRepository.getAll();
    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error, "Failed to load revenue");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Omit<RevenueEntry, "id">;
    if (body.grossRevenue === undefined || body.grossRevenue === null) {
      return NextResponse.json({ error: "grossRevenue is required" }, { status: 400 });
    }
    if (body.opportunityId) await ensureOpportunityExists(body.opportunityId);
    const created = await revenueRepository.create(body);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to create revenue entry");
  }
}
