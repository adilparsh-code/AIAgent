import { NextResponse } from "next/server";
import { opportunityRepository } from "@/lib/server/repositories/opportunities";
import { apiError } from "@/lib/api-error";
import { SAMPLE_OPPORTUNITIES } from "@/lib/data/opportunities";
import type { Opportunity } from "@/lib/types";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("meta") === "1") {
      const isSample = await opportunityRepository.isSample(params.id);
      return NextResponse.json({ isSample });
    }
    const row = await opportunityRepository.getById(params.id);
    if (row) return NextResponse.json(row);
    const sample = SAMPLE_OPPORTUNITIES.find((item) => item.id === params.id);
    if (sample) return NextResponse.json(sample);
    return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
  } catch (error) {
    return apiError(error, "Failed to load opportunity");
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const updates = (await request.json()) as Partial<Opportunity>;
    const updated = await opportunityRepository.update(params.id, updates);
    if (!updated) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error, "Failed to update opportunity");
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const deleted = await opportunityRepository.delete(params.id);
    if (!deleted) return NextResponse.json({ error: "Opportunity not found or is sample data" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Failed to delete opportunity");
  }
}
