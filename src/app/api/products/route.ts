import { NextResponse } from "next/server";
import { productRepository } from "@/lib/server/repositories/products";
import { apiError } from "@/lib/api-error";
import { ensureOpportunityExists } from "@/lib/server/ensure-opportunity";
import type { Product } from "@/lib/types";

export async function GET() {
  try {
    const rows = await productRepository.getAll();
    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error, "Failed to load products");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Omit<Product, "id" | "createdAt" | "updatedAt">;
    if (!body?.name || !body?.type) {
      return NextResponse.json({ error: "name and type are required" }, { status: 400 });
    }
    if (body.opportunityId) await ensureOpportunityExists(body.opportunityId);
    const created = await productRepository.create(body);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to create product");
  }
}
