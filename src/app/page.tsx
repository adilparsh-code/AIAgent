import Link from "next/link";
import { SAMPLE_OPPORTUNITIES, SAMPLE_PRODUCTS, SAMPLE_EXPERIMENTS, SAMPLE_REVENUE } from "@/lib/data";
import { formatCurrency } from "@/lib/utils";
import { Badge, Card, CardHeader, statusBadgeClass } from "@/components/ui";

export default function DashboardPage() {
  const opps = [...SAMPLE_OPPORTUNITIES].sort((a, b) => b.overallScore - a.overallScore);
  const totalOpportunities = SAMPLE_OPPORTUNITIES.length;
  const validated = SAMPLE_OPPORTUNITIES.filter((o) => ["VALIDATED", "BUILDING", "PUBLISHED", "EARNING", "SCALING"].includes(o.status)).length;
  const activeExperiments = SAMPLE_EXPERIMENTS.filter((e) => e.status === "ACTIVE").length + 1;
  const totalProducts = SAMPLE_PRODUCTS.length;
  const publishedProducts = SAMPLE_PRODUCTS.filter((p) => p.status === "PUBLISHED").length;
  const totalRevenue = SAMPLE_REVENUE.reduce((sum, r) => sum + r.netRevenue, 0);
  const monthlyRevenue = totalRevenue;
  const top = opps[0];

  const metrics = [
    { label: "Total Opportunities", value: String(totalOpportunities) },
    { label: "Validated Opportunities", value: String(validated) },
    { label: "Active Experiments", value: String(activeExperiments) },
    { label: "Products", value: String(totalProducts) },
    { label: "Published Products", value: String(publishedProducts) },
    { label: "Total Revenue", value: formatCurrency(totalRevenue) },
    { label: "Monthly Revenue", value: formatCurrency(monthlyRevenue) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-slate-500">SAMPLE DATA — illustrative only, not live business metrics.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => (
          <Card key={m.label} className="p-4">
            <div className="text-xs text-slate-500">{m.label}</div>
            <div className="mt-1 text-xl font-bold">{m.value}</div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Next Best Action" subtitle="Transparent recommendation from SAMPLE DATA scores" />
        <div className="space-y-2 p-5">
          <div className="text-lg font-semibold">Continue scaling: {top.title}</div>
          <p className="text-sm text-slate-600">
            It has the highest overall score ({top.overallScore.toFixed(1)}/100) among HALAL opportunities,
            an existing published product, and a completed SCALE experiment. Next: {top.nextAction}.
          </p>
          <Link href={`/opportunities/${top.id}`} className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">
            Open opportunity
          </Link>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top opportunities" subtitle="Sorted by overall score" action={<Link className="text-sm text-blue-600" href="/opportunities">View all</Link>} />
          <ul className="divide-y divide-slate-100">
            {opps.slice(0, 4).map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <Link href={`/opportunities/${o.id}`} className="truncate text-sm font-medium text-blue-700">{o.title}</Link>
                  <div className="mt-1 flex gap-2">
                    <Badge className={statusBadgeClass(o.status)}>{o.status}</Badge>
                    <Badge className={statusBadgeClass(o.halalStatus)}>{o.halalStatus}</Badge>
                  </div>
                </div>
                <div className="text-sm font-bold">{o.overallScore.toFixed(1)}</div>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Revenue overview" subtitle="SAMPLE DATA — not real income" action={<Link className="text-sm text-blue-600" href="/revenue">View revenue</Link>} />
          <div className="space-y-2 p-5 text-sm">
            <div className="flex justify-between"><span>Total net revenue</span><strong>{formatCurrency(totalRevenue)}</strong></div>
            <div className="flex justify-between"><span>Entries</span><strong>{SAMPLE_REVENUE.length}</strong></div>
            <p className="text-xs text-slate-500">Revenue is hand-entered SAMPLE DATA for workflow testing.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
