import { NextResponse } from "next/server";
import { agentRepository } from "@/lib/server/repositories/agents";
import { apiError } from "@/lib/api-error";
import { requireAdmin, requireUser } from "@/lib/server/authz";
import type { Agent } from "@/lib/types";

/**
 * The agent catalog is shared infrastructure (readable by any authenticated
 * user); mutating it is an admin-only operation (Phase 6A Step 10).
 */
export async function GET() {
  try {
    await requireUser();
    const rows = await agentRepository.getAll();
    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error, "Failed to load agents");
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = (await request.json()) as Omit<Agent, "id">;
    if (!body?.name || !body?.type) {
      return NextResponse.json({ error: "name and type are required" }, { status: 400 });
    }
    const created = await agentRepository.create(body);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to create agent");
  }
}
