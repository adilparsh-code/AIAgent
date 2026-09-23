import { NextResponse } from "next/server";
import { experimentRepository } from "@/lib/server/repositories/experiments";
import { apiError } from "@/lib/api-error";
import { SAMPLE_EXPERIMENTS } from "@/lib/data/catalog";
import { validateExperimentPayload, MAX_ID_LENGTH } from "@/lib/server/experiment-input";
import type { Experiment } from "@/lib/types";

function safeId(value: string): string {
  return value.trim().slice(0, MAX_ID_LENGTH);
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const id = safeId(params.id);
    const row = await experimentRepository.getById(id);
    if (row) return NextResponse.json(row);
    const sample = SAMPLE_EXPERIMENTS.find((item) => item.id === id);
    if (sample) return NextResponse.json(sample);
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  } catch (error) {
    return apiError(error, "Failed to load experiment");
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body: unknown = await request.json().catch(() => null);
    const { ok, errors, data } = validateExperimentPayload(body);
    if (!ok || !data) {
      return NextResponse.json({ error: errors.join("; ") || "Invalid payload" }, { status: 400 });
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
    }
    const updated = await experimentRepository.update(safeId(params.id), data);
    if (!updated) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error, "Failed to update experiment");
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const deleted = await experimentRepository.delete(safeId(params.id));
    if (!deleted) return NextResponse.json({ error: "Experiment not found or is sample data" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Failed to delete experiment");
  }
}
