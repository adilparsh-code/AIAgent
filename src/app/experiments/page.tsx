"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { experimentRepository, opportunityRepository } from "@/lib/repositories";
import type { Experiment } from "@/lib/types";
import { Badge, Card, CardHeader, Button, statusBadgeClass } from "@/components/ui";

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [opportunityNames, setOpportunityNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    async function loadExperiments() {
      const data = await experimentRepository.getAll();
      setExperiments(data);
      
      // Load opportunity names
      const names = new Map<string, string>();
      const allOpportunities = await opportunityRepository.getAll();
      allOpportunities.forEach(opp => {
        names.set(opp.id, opp.title);
      });
      setOpportunityNames(names);
      
      setLoading(false);
    }
    loadExperiments();
  }, []);

  if (loading) {
    return <div className="p-8 text-center">Loading experiments...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Experiments</h1>
        <Link href="/experiments/new">
          <Button>Create New Experiment</Button>
        </Link>
      </div>
      {experiments.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-slate-500">No experiments yet. Create your first experiment to start testing your opportunities.</p>
        </Card>
      ) : (
        experiments.map((e) => {
          const oppTitle = opportunityNames.get(e.opportunityId);
          const isSample = e.id.startsWith('exp-00');
          
          return (
            <Link href={`/experiments/${e.id}`} key={e.id}>
              <Card className="cursor-pointer hover:border-blue-300 transition-colors">
                <CardHeader 
                  title={e.hypothesis} 
                  subtitle={`Target: ${e.target}`} 
                  action={
                    <div className="flex items-center gap-2">
                      {isSample && <Badge className="bg-amber-100 text-amber-700">Sample</Badge>}
                      <Badge className={statusBadgeClass(e.decision ?? e.status)}>
                        {e.decision ?? e.status}
                      </Badge>
                    </div>
                  } 
                />
                <div className="grid gap-2 p-5 text-sm md:grid-cols-4">
                  <div>
                    <div className="text-xs text-slate-500">Opportunity</div>
                    <div className="font-medium">{oppTitle || "Unknown"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Sales</div>
                    <div className="font-medium">{e.sales}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Revenue</div>
                    <div className="font-medium">{formatCurrency(e.revenue)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Profit</div>
                    <div className="font-medium">{formatCurrency(e.profit)}</div>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })
      )}
    </div>
  );
}