"use client";

import { useEffect, useState } from "react";
import { Badge, Card, CardHeader, dataClassBadgeClass, dataClassLabel } from "@/components/ui";

type LoopResponse = {
  cycleId: string;
  portfolioDecision: string;
  selectedOpportunity: {
    opportunityId: string;
    queue: string | null;
    reason: string;
    decision: { decision: string; readinessState: string; lifecycleState: string } | null;
    priorityFactors: number;
  } | null;
  currentStage: string;
  nextAction: string;
  blockers: string[];
  requiredApproval: boolean;
  executionEligible: boolean;
  explanation: string[];
  dataClass: string;
  queues: Record<string, string[]>;
  limits: Record<string, number>;
  observed: Record<string, number>;
  generatedAt: string;
};

function stageLabel(stage: string): string {
  return stage.replace(/_/g, " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

export function AutonomousOperatingLoopPanel() {
  const [data, setData] = useState<LoopResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/opportunities/operating-loop")
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return (await response.json()) as LoopResponse;
      })
      .then((payload) => {
        if (active) setData(payload);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) return null;
  if (unavailable || !data) {
    return (
      <Card>
        <CardHeader title="AUTONOMOUS OPERATING LOOP" subtitle="The current operating cycle is unavailable." />
        <p className="p-5 text-sm text-slate-500">No cycle data is available. This panel never executes an external action.</p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="AUTONOMOUS OPERATING LOOP"
        subtitle="Deterministic next-step planning from persisted owner data. This layer does not execute external actions."
        action={<Badge className={dataClassBadgeClass(data.dataClass)}>{dataClassLabel(data.dataClass)}</Badge>}
      />
      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border p-3"><div className="text-xs text-slate-500">Current Stage</div><div className="mt-1 font-semibold">{stageLabel(data.currentStage)}</div></div>
        <div className="rounded-md border p-3"><div className="text-xs text-slate-500">Portfolio Decision</div><div className="mt-1 text-sm font-semibold">{data.portfolioDecision}</div></div>
        <div className="rounded-md border p-3"><div className="text-xs text-slate-500">Execution Eligibility</div><div className={`mt-1 font-semibold ${data.executionEligible ? "text-emerald-700" : "text-slate-600"}`}>{data.executionEligible ? "Eligible" : "Not eligible"}</div></div>
        <div className="rounded-md border p-3"><div className="text-xs text-slate-500">Safety / Approval</div><div className="mt-1 text-sm font-semibold">{data.requiredApproval ? "Approval required" : "No additional approval reported"}</div></div>
      </div>
      <div className="border-t border-slate-100 bg-slate-50 p-5"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">NEXT ACTION</div><p className="mt-1 text-base font-semibold">{data.nextAction}</p></div>
      <div className="grid gap-3 border-t border-slate-100 p-5 sm:grid-cols-3 lg:grid-cols-6">
        {Object.entries(data.queues).map(([queue, ids]) => (
          <div key={queue} className="rounded-md border p-3">
            <div className="text-xs text-slate-500">{queue.replaceAll("_", " ")}</div>
            <div className="mt-1 text-lg font-semibold">{ids.length}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 border-t border-slate-100 p-5 lg:grid-cols-2">
        <div><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected Opportunity</h4>{data.selectedOpportunity ? <div className="mt-2 rounded-md border p-3"><p className="font-semibold">{data.selectedOpportunity.opportunityId}</p><p className="text-sm text-slate-600">Queue: {data.selectedOpportunity.queue ?? "—"}</p><p className="mt-1 text-sm">Why selected: {data.selectedOpportunity.reason}</p>{data.selectedOpportunity.decision ? <p className="mt-1 text-xs text-slate-500">Current decision: {data.selectedOpportunity.decision.decision} · lifecycle: {data.selectedOpportunity.decision.lifecycleState}</p> : null}</div> : <p className="mt-2 text-sm text-slate-500">No opportunity is selected for the next operational action.</p>}</div>
        <div><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Blockers</h4>{data.blockers.length === 0 ? <p className="mt-2 text-sm text-slate-500">None reported.</p> : <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-700">{data.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}</div>
      </div>
      <div className="border-t border-slate-100 bg-slate-50 p-5 text-xs text-slate-600">
        <span className="font-semibold uppercase tracking-wide text-slate-500">BOUNDED LIMITS</span>
        <span className="ml-2">max cycle {data.limits.maxOpportunitiesPerCycle} · experiments {data.limits.maxConcurrentExperiments} · executions {data.limits.maxConcurrentExecutions} · retries {data.limits.maxRetries}</span>
        <div className="mt-1">Observed: {Object.entries(data.observed).map(([key, value]) => `${key} ${value}`).join(" · ")}</div>
      </div>
      <div className="border-t border-slate-100 p-5"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">NEXT CYCLE</h4><p className="mt-1 text-sm text-slate-700">After this action, recompute the persisted decision and portfolio position. The loop only reports the next step.</p><ul className="mt-2 list-inside list-disc space-y-1 text-xs text-slate-500">{data.explanation.map((line) => <li key={line}>{line}</li>)}</ul></div>
    </Card>
  );
}
