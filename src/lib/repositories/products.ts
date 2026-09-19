import type { Product } from "../types";
import type { Repository } from "./base";
import { SAMPLE_PRODUCTS } from "../data/catalog";
import { apiGet, apiSend } from "../http";

function sampleById(id: string) {
  return SAMPLE_PRODUCTS.find((item) => item.id === id) ?? null;
}

class HttpProductRepository implements Repository<Product> {
  async getAll(): Promise<Product[]> {
    let persisted: Product[] = [];
    try {
      persisted = await apiGet<Product[]>("/api/products");
    } catch {
      persisted = [];
    }
    const persistedIds = new Set(persisted.map((item) => item.id));
    const samples = SAMPLE_PRODUCTS.filter((item) => !persistedIds.has(item.id));
    return [...persisted, ...samples].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  async getById(id: string): Promise<Product | null> {
    try {
      return await apiGet<Product>(`/api/products/${id}`);
    } catch {
      return sampleById(id);
    }
  }

  async isSample(id: string): Promise<boolean> {
    return Boolean(sampleById(id));
  }

  async create(item: Omit<Product, "id" | "createdAt" | "updatedAt">): Promise<Product> {
    return apiSend<Product>("/api/products", "POST", item);
  }

  async update(id: string, updates: Partial<Product>): Promise<Product | null> {
    if (sampleById(id)) return null;
    try {
      return await apiSend<Product>(`/api/products/${id}`, "PATCH", updates);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    if (sampleById(id)) return false;
    try {
      await apiSend(`/api/products/${id}`, "DELETE");
      return true;
    } catch {
      return false;
    }
  }
}

export const productRepository = new HttpProductRepository();
