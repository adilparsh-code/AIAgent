import { NextResponse } from "next/server";
import { agentRepository } from "@/lib/server/repositories/agents";
import { apiError } from "@/lib/api-error";
import { requireAdmin, requireUser } from "@/lib/server/authz";
import { SAMPLE_AGENTS } from "@/lib/data/catalog";
import type { Agent } from "@/lib/types";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const row = await agentRepository.getById(params.id);
    if (row) return NextResponse.json(row);
    const sample = SAMPLE_AGENTS.find((item) => item.id === params.id);
    if (sample) return NextResponse.json(sample);
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  } catch (error) {
    return apiError(error, "Failed to load agent");
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const updates = (await request.json()) as Partial<Agent>;
    const updated = await agentRepository.update(params.id, updates);
    if (!updated) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error, "Failed to update agent");
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const deleted = await agentRepository.delete(params.id);
    if (!deleted) return NextResponse.json({ error: "Agent not found or is sample data" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Failed to delete agent");
  }
}
