import "server-only";
import type { Prisma } from "@prisma/client";
import type { Product } from "../../types";
import type { Repository } from "../../repositories/base";
import { getPrisma } from "../../db";
import { mapProduct } from "../../db-mappers";

function metricsJson(metrics: Product["metrics"] | undefined): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(metrics ?? {})) as Prisma.InputJsonValue;
}

export class PrismaProductRepository implements Repository<Product> {
  async getAll(): Promise<Product[]> {
    const rows = await getPrisma().product.findMany({
      where: { isSample: false },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(mapProduct);
  }

  async getById(id: string): Promise<Product | null> {
    const row = await getPrisma().product.findFirst({
      where: { id, isSample: false },
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

  async create(item: Omit<Product, "id" | "createdAt" | "updatedAt">): Promise<Product> {
    const row = await getPrisma().product.create({
      data: {
        name: item.name,
        type: item.type,
        targetAudience: item.targetAudience,
        opportunityId: item.opportunityId,
        status: item.status,
        price: item.price,
        cost: item.cost,
        revenue: item.revenue,
        platform: item.platform,
        productUrl: item.productUrl,
        affiliateUrl: item.affiliateUrl,
        metrics: metricsJson(item.metrics),
        notes: item.notes,
        isSample: false,
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
}

export const productRepository = new PrismaProductRepository();
