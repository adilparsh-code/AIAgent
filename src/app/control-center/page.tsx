"use client";

import { useEffect, useState } from "react";

type Dashboard = {
  generatedAt: string;
  runtime: { provider: { name: string; status: string; reason?: string } };
  tasks: Record<string, number>;
  runs: Record<string, number>;
  handoffs: Record<string, number>;
  experiments: Record<string, number>;
  agents: Record<string, number>;
  income: { netRevenue: string; entries: number };
  recentTasks: Array<{ id: string; taskType: string; objective: string; status: string; requiresApproval: boolean; approvalState: string | null }>;
};

export default function ControlCenterPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/control-center").then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Failed to load");
      setData(body);
    }).catch((e) => setError(e.message));
  }, []);

  if (error) return <main className="mx-auto max-w-6xl p-8"><h1 className="text-2xl font-bold">Control Center</h1><p className="mt-4 text-red-600">{error}</p></main>;
  if (!data) return <main className="mx-auto max-w-6xl p-8"><h1 className="text-2xl font-bold">Control Center</h1><p className="mt-4">Loading runtime state…</p></main>;

  const cards = [
    ["Agent Tasks", Object.values(data.tasks).reduce((a,b)=>a+b,0)],
    ["Running", data.tasks.RUNNING || 0],
    ["Approvals", data.tasks.WAITING_APPROVAL || 0],
    ["Experiments", Object.values(data.experiments).reduce((a,b)=>a+b,0)],
    ["Handoffs", Object.values(data.handoffs).reduce((a,b)=>a+b,0)],
    ["Net Revenue", data.income.netRevenue],
  ];

  return <main className="mx-auto max-w-6xl space-y-8 p-8">
    <header>
      <p className="text-sm font-medium text-slate-500">AI Income Lab + AIAgent</p>
      <h1 className="text-3xl font-bold">Control Center</h1>
      <p className="mt-2 text-slate-600">Runtime, approvals, experiments and income in one owner-scoped view.</p>
    </header>
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map(([label,value]) => <div key={label} className="rounded-xl border p-5"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>)}
    </section>
    <section className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border p-6">
        <h2 className="font-semibold">AI Provider</h2>
        <p className="mt-2">{data.runtime.provider.name}: <strong>{data.runtime.provider.status}</strong></p>
        {data.runtime.provider.reason && <p className="mt-2 text-sm text-slate-500">{data.runtime.provider.reason}</p>}
      </div>
      <div className="rounded-xl border p-6">
        <h2 className="font-semibold">Pending approvals</h2>
        <p className="mt-2">{data.tasks.WAITING_APPROVAL || 0} task(s) waiting for explicit approval.</p>
      </div>
    </section>
    <section className="rounded-xl border p-6">
      <h2 className="font-semibold">Recent Agent Tasks</h2>
      <div className="mt-4 space-y-3">
        {data.recentTasks.length === 0 ? <p className="text-sm text-slate-500">No tasks yet.</p> :
          data.recentTasks.map((task) => <div key={task.id} className="rounded-lg bg-slate-50 p-4"><div className="flex justify-between gap-4"><strong>{task.taskType}</strong><span>{task.status}</span></div><p className="mt-1 text-sm">{task.objective}</p>{task.requiresApproval && <p className="mt-1 text-xs text-slate-500">Approval: {task.approvalState || "pending"}</p>}</div>)}
      </div>
    </section>
  </main>;
}
