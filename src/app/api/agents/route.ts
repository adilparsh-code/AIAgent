import { NextResponse } from "next/server";
import { agentRepository } from "@/lib/server/repositories/agents";
import { apiError } from "@/lib/api-error";
import type { Agent } from "@/lib/types";

export async function GET() {
  try {
    const rows = await agentRepository.getAll();
    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error, "Failed to load agents");
  }
}

export async function POST(request: Request) {
  try {
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
