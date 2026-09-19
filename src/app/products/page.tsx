"use client";

import { useEffect, useState } from "react";
import { productRepository } from "@/lib/repositories";
import { formatCurrency } from "@/lib/utils";
import type { Product } from "@/lib/types";
import { Badge, Card, CardHeader, statusBadgeClass } from "@/components/ui";

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const data = await productRepository.getAll();
      setProducts(data);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Products</h1>
      <p className="text-sm text-slate-500">Sample catalog items are labeled. User-created products persist in PostgreSQL.</p>
      <Card>
        <CardHeader title="All products" subtitle={loading ? "Loading..." : `${products.length} items`} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Price</th>
                <th className="px-5 py-3">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3 font-medium">
                    {p.name}
                    {p.id.startsWith("prod-00") && (
                      <Badge className="ml-2 bg-amber-100 text-amber-700">Sample</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3">{p.type}</td>
                  <td className="px-5 py-3"><Badge className={statusBadgeClass(p.status)}>{p.status}</Badge></td>
                  <td className="px-5 py-3">{formatCurrency(p.price)}</td>
                  <td className="px-5 py-3">{formatCurrency(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
