import { NextResponse } from "next/server";
import { productRepository } from "@/lib/server/repositories/products";
import { apiError } from "@/lib/api-error";
import { requireUser } from "@/lib/server/authz";
import { opportunityRepository } from "@/lib/server/repositories/opportunities";
import { ForbiddenError } from "@/lib/authz-errors";
import type { Product } from "@/lib/types";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await productRepository.getAll(user.id);
    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error, "Failed to load products");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as Omit<Product, "id" | "createdAt" | "updatedAt">;
    if (!body?.name || !body?.type) {
      return NextResponse.json({ error: "name and type are required" }, { status: 400 });
    }
    if (body.opportunityId) {
      const owned = await opportunityRepository.getById(body.opportunityId, user.id);
      if (!owned) throw new ForbiddenError("Resource not found");
    }
    const created = await productRepository.create({ ...body, ownerId: user.id });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to create product");
  }
}
