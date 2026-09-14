"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { revenueRepository } from "@/lib/repositories";
import type { RevenueEntry } from "@/lib/types";
import { Card, CardHeader, Button, Badge } from "@/components/ui";

export default function RevenuePage() {
  const [revenueEntries, setRevenueEntries] = useState<RevenueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalNet, setTotalNet] = useState(0);
  const [monthlyRevenue, setMonthlyRevenue] = useState(0);

  useEffect(() => {
    async function loadRevenue() {
      const data = await revenueRepository.getAll();
      setRevenueEntries(data);
      
      // Calculate totals
      const net = await revenueRepository.getTotalNetRevenue();
      setTotalNet(net);
      
      const monthly = await revenueRepository.getMonthlyRevenue();
      setMonthlyRevenue(monthly);
      
      setLoading(false);
    }
    loadRevenue();
  }, []);

  if (loading) {
    return <div className="p-8 text-center">Loading revenue data...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Revenue</h1>
        <Link href="/revenue/new">
          <Button>Add Revenue Entry</Button>
        </Link>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title={`Total Net Revenue: ${formatCurrency(totalNet)}`} subtitle={`${revenueEntries.length} total entries`} />
        </Card>
        <Card>
          <CardHeader title={`This Month: ${formatCurrency(monthlyRevenue)}`} subtitle="Current calendar month" />
        </Card>
      </div>

      <Card>
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
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {revenueEntries.map((r) => {
                const isSample = r.id.startsWith('rev-00');
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">{r.date.slice(0, 10)}</td>
                    <td className="px-5 py-3">{r.revenueSource}{isSample && <Badge className="ml-2 bg-amber-100 text-amber-700">Sample</Badge>}</td>
                    <td className="px-5 py-3">{formatCurrency(r.grossRevenue)}</td>
                    <td className="px-5 py-3">{formatCurrency(r.fees)}</td>
                    <td className="px-5 py-3 font-medium">{formatCurrency(r.netRevenue)}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{r.referenceNote}</td>
                    <td className="px-5 py-3">
                      <Link href={`/revenue/${r.id}`} className="text-blue-600 hover:underline text-xs">
                        View/Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}