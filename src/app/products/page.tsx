import { SAMPLE_PRODUCTS } from "@/lib/data";
import { formatCurrency } from "@/lib/utils";
import { Badge, Card, CardHeader, statusBadgeClass } from "@/components/ui";

export default function ProductsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Products</h1>
      <p className="text-sm text-slate-500">SAMPLE DATA — product catalog structure for Phase 1.</p>
      <Card>
        <CardHeader title="All products" subtitle={`${SAMPLE_PRODUCTS.length} items`} />
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
              {SAMPLE_PRODUCTS.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3 font-medium">{p.name}</td>
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
