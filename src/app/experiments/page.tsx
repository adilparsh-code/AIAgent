import { SAMPLE_EXPERIMENTS, SAMPLE_OPPORTUNITIES } from "@/lib/data";
import { formatCurrency } from "@/lib/utils";
import { Badge, Card, CardHeader, statusBadgeClass } from "@/components/ui";

export default function ExperimentsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Experiments</h1>
      <p className="text-sm text-slate-500">SAMPLE DATA — DISCOVER → VALIDATE → BUILD → PUBLISH → MEASURE → EARN → SCALE.</p>
      {SAMPLE_EXPERIMENTS.map((e) => {
        const opp = SAMPLE_OPPORTUNITIES.find((o) => o.id === e.opportunityId);
        return (
          <Card key={e.id}>
            <CardHeader title={e.hypothesis} subtitle={`Target: ${e.target}`} action={<Badge className={statusBadgeClass(e.decision ?? e.status)}>{e.decision ?? e.status}</Badge>} />
            <div className="grid gap-2 p-5 text-sm md:grid-cols-4">
              <div><div className="text-xs text-slate-500">Opportunity</div><div className="font-medium">{opp?.title}</div></div>
              <div><div className="text-xs text-slate-500">Sales</div><div className="font-medium">{e.sales}</div></div>
              <div><div className="text-xs text-slate-500">Revenue</div><div className="font-medium">{formatCurrency(e.revenue)}</div></div>
              <div><div className="text-xs text-slate-500">Profit</div><div className="font-medium">{formatCurrency(e.profit)}</div></div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
