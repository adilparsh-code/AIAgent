"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getRecommendation } from "@/lib/scoring";
import { formatCurrency } from "@/lib/utils";
import { opportunityRepository, experimentRepository, revenueRepository } from "@/lib/repositories";
import type { Opportunity, Experiment, RevenueEntry } from "@/lib/types";
import { Badge, Card, CardHeader, statusBadgeClass } from "@/components/ui";

export default function DashboardPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [revenueEntries, setRevenueEntries] = useState<RevenueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    totalOpportunities: 0,
    validatedOpportunities: 0,
    activeExperiments: 0,
    totalRevenue: 0,
    monthlyRevenue: 0,
  });

  useEffect(() => {
    async function loadDashboardData() {
      // Load all data from repositories
      const [opps, exps, revenues] = await Promise.all([
        opportunityRepository.getAll(),
        experimentRepository.getAll(),
        revenueRepository.getAll(),
      ]);

      setOpportunities(opps);
      setExperiments(exps);
      setRevenueEntries(revenues);

      // Calculate metrics
      const totalOpportunities = opps.length;
      const validated = opps.filter((o) =>
        ["VALIDATED", "BUILDING", "PUBLISHED", "EARNING", "SCALING"].includes(o.status)
      ).length;
      const activeExps = exps.filter((e) => e.status === "ACTIVE").length;
      const totalNet = await revenueRepository.getTotalNetRevenue();
      const monthly = await revenueRepository.getMonthlyRevenue();

      setMetrics({
        totalOpportunities,
        validatedOpportunities: validated,
        activeExperiments: activeExps,
        totalRevenue: totalNet,
        monthlyRevenue: monthly,
      });

      setLoading(false);
    }

    loadDashboardData();
  }, []);

  if (loading) return <div className="p-8 text-center">Loading dashboard data...</div>;

  const opps = [...opportunities].sort((a, b) => b.overallScore - a.overallScore);
  const activeExperiments = experiments.filter((e) => e.status === "ACTIVE");

  // Next Best Action: highest scoring HALAL opportunity; NOT_ALLOWED can never be recommended.
  const eligible = opps.filter((o) => o.halalStatus !== "NOT_ALLOWED");
  const top = eligible[0] ?? opps[0];
  const recommendation = getRecommendation(top.halalStatus, top.title, top.overallScore);

  const displayMetrics = [
    { label: "Total Opportunities", value: String(metrics.totalOpportunities) },
    { label: "Validated Opportunities", value: String(metrics.validatedOpportunities) },
    { label: "Active Experiments", value: String(metrics.activeExperiments) },
    { label: "Total Revenue", value: formatCurrency(metrics.totalRevenue) },
    { label: "Monthly Revenue", value: formatCurrency(metrics.monthlyRevenue) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-slate-500">Track and manage your income-generating opportunities, experiments, and revenue.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {displayMetrics.map((m) => (
          <Card key={m.label} className="p-4">
            <div className="text-xs text-slate-500">{m.label}</div>
            <div className="mt-1 text-xl font-bold">{m.value}</div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Next Best Action" subtitle="Transparent recommendation from your opportunity scores" />
        <div className="space-y-2 p-5">
          {top ? (
            <>
              <div className="text-lg font-semibold">Next: {top.title}</div>
              <p className="text-sm text-slate-600">{recommendation}</p>
              <p className="text-sm text-slate-600">
                Overall score {top.overallScore.toFixed(1)}/100 · Status {top.status} · Halal {top.halalStatus}.
                Planned objective: {top.nextAction}.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/opportunities/${top.id}`} className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">
                  Open opportunity
                </Link>
                <Link href="/experiments" className="inline-block rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium">
                  View experiments
                </Link>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-600">Create your first opportunity to get personalized recommendations.</p>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Opportunity overview" subtitle="Your highest scoring opportunities" action={<Link className="text-sm text-blue-600" href="/opportunities">View all</Link>} />
          <ul className="divide-y divide-slate-100">
            {opps.slice(0, 4).map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <Link href={`/opportunities/${o.id}`} className="truncate text-sm font-medium text-blue-700">{o.title}</Link>
                  <div className="mt-1 flex gap-2">
                    <Badge className={statusBadgeClass(o.status)}>{o.status}</Badge>
                    <Badge className={statusBadgeClass(o.halalStatus)}>{o.halalStatus}</Badge>
                    {o.id.startsWith('opp-00') && <Badge className="bg-amber-100 text-amber-700">Sample</Badge>}
                  </div>
                </div>
                <div className="text-sm font-bold">{o.overallScore.toFixed(1)}</div>
              </li>
            ))}
            {opps.length === 0 && (
              <li className="px-5 py-3 text-sm text-slate-500">No opportunities created yet. Add your first opportunity to get started.</li>
            )}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Revenue overview" action={<Link className="text-sm text-blue-600" href="/revenue">View revenue</Link>} />
          <div className="space-y-2 p-5 text-sm">
            <div className="flex justify-between"><span>Total net revenue</span><strong>{formatCurrency(metrics.totalRevenue)}</strong></div>
            <div className="flex justify-between"><span>Entries</span><strong>{revenueEntries.length}</strong></div>
            <p className="text-xs text-slate-500">Revenue is hand-entered from your income streams.</p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Experiment overview"
          subtitle="Your active experiments"
          action={<Link className="text-sm text-blue-600" href="/experiments">View experiments</Link>}
        />
        {activeExperiments.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">
            No active experiments. Create your first experiment to start validating your opportunities.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {activeExperiments.map((e) => (
              <li key={e.id} className="px-5 py-3 text-sm">
                <span className="font-medium">{e.hypothesis}</span>
                <span className="ml-2"><Badge className={statusBadgeClass(e.status)}>{e.status}</Badge></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}