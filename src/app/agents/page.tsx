import { SAMPLE_AGENTS } from "@/lib/data";
import { Badge, Card } from "@/components/ui";

export default function AgentsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">AI Agents</h1>
      <p className="text-sm text-slate-500">Architecture placeholders only. None are connected to live AI APIs.</p>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {SAMPLE_AGENTS.map((a) => (
          <Card key={a.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{a.name}</div>
              <Badge className="bg-slate-100 text-slate-700">{a.status}</Badge>
            </div>
            <p className="mt-2 text-sm text-slate-600">{a.description}</p>
            <p className="mt-2 text-xs text-slate-500">PLANNED INTEGRATION</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
