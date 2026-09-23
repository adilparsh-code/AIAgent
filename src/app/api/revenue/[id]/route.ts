import { NextResponse } from "next/server";
import { revenueRepository } from "@/lib/server/repositories/revenue";
import { apiError } from "@/lib/api-error";
import { requireUser } from "@/lib/server/authz";
import { SAMPLE_REVENUE } from "@/lib/data/catalog";
import type { RevenueEntry } from "@/lib/types";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = params.id.trim().slice(0, 64);
    const row = await revenueRepository.getById(id, user.id);
    if (row) return NextResponse.json(row);
    const sample = SAMPLE_REVENUE.find((item) => item.id === id);
    if (sample) return NextResponse.json(sample);
    return NextResponse.json({ error: "Revenue entry not found" }, { status: 404 });
  } catch (error) {
    return apiError(error, "Failed to load revenue entry");
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = params.id.trim().slice(0, 64);
    const existing = await revenueRepository.getById(id, user.id);
    if (!existing) return NextResponse.json({ error: "Revenue entry not found" }, { status: 404 });
    const updates = (await request.json()) as Partial<RevenueEntry>;
    const updated = await revenueRepository.update(id, updates);
    if (!updated) return NextResponse.json({ error: "Revenue entry not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error, "Failed to update revenue entry");
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = params.id.trim().slice(0, 64);
    const deleted = await revenueRepository.deleteForOwner(id, user.id);
    if (!deleted) return NextResponse.json({ error: "Revenue entry not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Failed to delete revenue entry");
  }
}
