import { NextResponse } from "next/server";
import { revenueRepository } from "@/lib/server/repositories/revenue";
import { apiError } from "@/lib/api-error";
import { SAMPLE_REVENUE } from "@/lib/data/catalog";
import type { RevenueEntry } from "@/lib/types";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const row = await revenueRepository.getById(params.id);
    if (row) return NextResponse.json(row);
    const sample = SAMPLE_REVENUE.find((item) => item.id === params.id);
    if (sample) return NextResponse.json(sample);
    return NextResponse.json({ error: "Revenue entry not found" }, { status: 404 });
  } catch (error) {
    return apiError(error, "Failed to load revenue entry");
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const updates = (await request.json()) as Partial<RevenueEntry>;
    const updated = await revenueRepository.update(params.id, updates);
    if (!updated) return NextResponse.json({ error: "Revenue entry not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error, "Failed to update revenue entry");
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const deleted = await revenueRepository.delete(params.id);
    if (!deleted) return NextResponse.json({ error: "Revenue entry not found or is sample data" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Failed to delete revenue entry");
  }
}
