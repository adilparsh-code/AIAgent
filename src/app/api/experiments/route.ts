import { NextResponse } from "next/server";
import { experimentRepository } from "@/lib/server/repositories/experiments";
import { apiError } from "@/lib/api-error";
import { ensureOpportunityExists } from "@/lib/server/ensure-opportunity";
import type { Experiment } from "@/lib/types";

export async function GET() {
  try {
    const rows = await experimentRepository.getAll();
    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error, "Failed to load experiments");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Omit<Experiment, "id" | "createdAt" | "updatedAt">;
    if (!body?.hypothesis || !body?.opportunityId || !body?.target) {
      return NextResponse.json({ error: "hypothesis, opportunityId, and target are required" }, { status: 400 });
    }
    await ensureOpportunityExists(body.opportunityId);
    const created = await experimentRepository.create(body);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to create experiment");
  }
}
