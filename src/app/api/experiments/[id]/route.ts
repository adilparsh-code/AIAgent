import { NextResponse } from "next/server";
import { experimentRepository } from "@/lib/server/repositories/experiments";
import { apiError } from "@/lib/api-error";
import { SAMPLE_EXPERIMENTS } from "@/lib/data/catalog";
import type { Experiment } from "@/lib/types";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const row = await experimentRepository.getById(params.id);
    if (row) return NextResponse.json(row);
    const sample = SAMPLE_EXPERIMENTS.find((item) => item.id === params.id);
    if (sample) return NextResponse.json(sample);
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  } catch (error) {
    return apiError(error, "Failed to load experiment");
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const updates = (await request.json()) as Partial<Experiment>;
    const updated = await experimentRepository.update(params.id, updates);
    if (!updated) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error, "Failed to update experiment");
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const deleted = await experimentRepository.delete(params.id);
    if (!deleted) return NextResponse.json({ error: "Experiment not found or is sample data" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Failed to delete experiment");
  }
}
