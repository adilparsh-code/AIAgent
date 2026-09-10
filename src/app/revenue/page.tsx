import { SAMPLE_REVENUE } from "@/lib/data";
import { formatCurrency } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui";

export default function RevenuePage() {
  const net = SAMPLE_REVENUE.reduce((s, r) => s + r.netRevenue, 0);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Revenue</h1>
      <p className="text-sm text-slate-500">SAMPLE DATA — not real income. All entries are hand-entered examples.</p>
      <Card>
        <CardHeader title={`Net revenue: ${formatCurrency(net)}`} subtitle={`${SAMPLE_REVENUE.length} sample entries`} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Source</th>
                <th className="px-5 py-3">Gross</th>
                <th className="px-5 py-3">Fees</th>
                <th className="px-5 py-3">Net</th>
                <th className="px-5 py-3">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {SAMPLE_REVENUE.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-3">{r.date.slice(0, 10)}</td>
                  <td className="px-5 py-3">{r.revenueSource}</td>
                  <td className="px-5 py-3">{formatCurrency(r.grossRevenue)}</td>
                  <td className="px-5 py-3">{formatCurrency(r.fees)}</td>
                  <td className="px-5 py-3 font-medium">{formatCurrency(r.netRevenue)}</td>
                  <td className="px-5 py-3 text-xs text-slate-500">{r.referenceNote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
