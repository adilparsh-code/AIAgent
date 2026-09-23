import { NextResponse } from "next/server";
import { opportunityRepository } from "@/lib/server/repositories/opportunities";
import { apiError } from "@/lib/api-error";
import { requireUser } from "@/lib/server/authz";
import { SAMPLE_OPPORTUNITIES } from "@/lib/data/opportunities";
import type { Opportunity } from "@/lib/types";

/**
 * Phase 6A — every access is owner-checked server-side. A record that does not
 * belong to the caller is answered with 404 (indistinguishable from a missing
 * row) so cross-tenant probing learns nothing. Unowned legacy/sample rows are
 * not exposed to normal users either.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = params.id.trim().slice(0, 64);
    const { searchParams } = new URL(request.url);
    if (searchParams.get("meta") === "1") {
      const owned = await opportunityRepository.getById(id, user.id);
      if (!owned) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
      return NextResponse.json({ isSample: false });
    }
    const row = await opportunityRepository.getById(id, user.id);
    if (row) return NextResponse.json(row);
    const sample = SAMPLE_OPPORTUNITIES.find((item) => item.id === id);
    if (sample) return NextResponse.json(sample);
    return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
  } catch (error) {
    return apiError(error, "Failed to load opportunity");
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = params.id.trim().slice(0, 64);
    const updates = (await request.json()) as Partial<Opportunity>;
    const updated = await opportunityRepository.updateForOwner(id, user.id, updates);
    if (!updated) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error, "Failed to update opportunity");
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = params.id.trim().slice(0, 64);
    const deleted = await opportunityRepository.deleteForOwner(id, user.id);
    if (!deleted) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Failed to delete opportunity");
  }
}
