import "server-only";
import type { Prisma } from "@prisma/client";
import type { Product } from "../../types";
import type { Repository } from "../../repositories/base";
import { getPrisma } from "../../db";
import { mapProduct } from "../../db-mappers";
import { boundedListRows } from "./list-limits";

function metricsJson(metrics: Product["metrics"] | undefined): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(metrics ?? {})) as Prisma.InputJsonValue;
}

export class PrismaProductRepository implements Repository<Product> {
  async getAll(ownerId?: string, limit?: number): Promise<Product[]> {
    const rows = await getPrisma().product.findMany({
      where: ownerId ? { isSample: false, ownerId } : { isSample: false },
      orderBy: { updatedAt: "desc" },
      // MEDIUM-3: bounded read; a full-table read must not be reachable.
      take: boundedListRows(limit),
    });
    return rows.map(mapProduct);
  }

  async getById(id: string, ownerId?: string): Promise<Product | null> {
    const row = await getPrisma().product.findFirst({
      where: ownerId ? { id, isSample: false, ownerId } : { id, isSample: false },
    });
    return row ? mapProduct(row) : null;
  }

  async isSample(id: string): Promise<boolean> {
    const row = await getPrisma().product.findUnique({
      where: { id },
      select: { isSample: true },
    });
    return row?.isSample ?? false;
  }

  async create(
    item: Omit<Product, "id" | "createdAt" | "updatedAt"> & { ownerId?: string | null },
  ): Promise<Product> {
    const { ownerId, ...rest } = item;
    const row = await getPrisma().product.create({
      data: {
        name: rest.name,
        type: rest.type,
        targetAudience: rest.targetAudience,
        opportunityId: rest.opportunityId,
        status: rest.status,
        price: rest.price,
        cost: rest.cost,
        revenue: rest.revenue,
        platform: rest.platform,
        productUrl: rest.productUrl,
        affiliateUrl: rest.affiliateUrl,
        metrics: metricsJson(rest.metrics),
        notes: rest.notes,
        isSample: false,
        ownerId: ownerId ?? null,
      },
    });
    return mapProduct(row);
  }

  async update(id: string, updates: Partial<Product>): Promise<Product | null> {
    const existing = await getPrisma().product.findFirst({
      where: { id, isSample: false },
    });
    if (!existing) return null;
    const mapped = mapProduct(existing);
    const merged = { ...mapped, ...updates };
    const row = await getPrisma().product.update({
      where: { id },
      data: {
        name: merged.name,
        type: merged.type,
        targetAudience: merged.targetAudience,
        opportunityId: merged.opportunityId,
        status: merged.status,
        price: merged.price,
        cost: merged.cost,
        revenue: merged.revenue,
        platform: merged.platform,
        productUrl: merged.productUrl,
        affiliateUrl: merged.affiliateUrl,
        metrics: metricsJson(merged.metrics),
        notes: merged.notes,
      },
    });
    return mapProduct(row);
  }

  async delete(id: string): Promise<boolean> {
    const existing = await getPrisma().product.findUnique({ where: { id } });
    if (!existing || existing.isSample) return false;
    await getPrisma().product.delete({ where: { id } });
    return true;
  }

  /** Owner-scoped delete used by protected routes. */
  async deleteForOwner(id: string, ownerId: string): Promise<boolean> {
    const result = await getPrisma().product.deleteMany({
      where: { id, ownerId, isSample: false },
    });
    return result.count > 0;
  }
}

export const productRepository = new PrismaProductRepository();
