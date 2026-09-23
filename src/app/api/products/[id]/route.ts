import { NextResponse } from "next/server";
import { productRepository } from "@/lib/server/repositories/products";
import { apiError } from "@/lib/api-error";
import { requireUser } from "@/lib/server/authz";
import { SAMPLE_PRODUCTS } from "@/lib/data/catalog";
import type { Product } from "@/lib/types";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = params.id.trim().slice(0, 64);
    const row = await productRepository.getById(id, user.id);
    if (row) return NextResponse.json(row);
    const sample = SAMPLE_PRODUCTS.find((item) => item.id === id);
    if (sample) return NextResponse.json(sample);
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  } catch (error) {
    return apiError(error, "Failed to load product");
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = params.id.trim().slice(0, 64);
    const existing = await productRepository.getById(id, user.id);
    if (!existing) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    const updates = (await request.json()) as Partial<Product>;
    const updated = await productRepository.update(id, updates);
    if (!updated) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error, "Failed to update product");
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = params.id.trim().slice(0, 64);
    const deleted = await productRepository.deleteForOwner(id, user.id);
    if (!deleted) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Failed to delete product");
  }
}
