import { NextResponse } from "next/server";
import { opportunityRepository } from "@/lib/server/repositories/opportunities";
import { apiError } from "@/lib/api-error";
import type { Opportunity } from "@/lib/types";

export async function GET() {
  try {
    const rows = await opportunityRepository.getAll();
    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error, "Failed to load opportunities");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Omit<Opportunity, "id" | "createdAt" | "updatedAt">;
    if (!body?.title || !body?.category || !body?.businessModel) {
      return NextResponse.json({ error: "title, category, and businessModel are required" }, { status: 400 });
    }
    const created = await opportunityRepository.create(body);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to create opportunity");
  }
}
