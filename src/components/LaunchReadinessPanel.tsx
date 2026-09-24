"use client";

import { useEffect, useState } from "react";
import { Badge, Card, CardHeader } from "@/components/ui";

type Gate = { id: string; status: string; severity: string; reason: string; requiredAction: string };
type Readiness = {
  status: string;
  score: number;
  gates: Gate[];
  blockers: string[];
  warnings: string[];
  providerPending: boolean;
  liveTestPending: boolean;
  securityReady: boolean;
  dataReady: boolean;
  executionReady: boolean;
  observabilityReady: boolean;
  generatedAt: string;
};

function statusClass(status: string): string {
  if (status === "PASS") return "bg-emerald-100 text-emerald-800";
  if (status === "WARN") return "bg-amber-100 text-amber-800";
  if (status === "FAIL") return "bg-red-100 text-red-800";
  return "bg-sky-100 text-sky-800";
}

export function LaunchReadinessPanel() {
  const [data, setData] = useState<Readiness | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/system/launch-readiness")
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return response.json() as Promise<Readiness>;
      })
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (unavailable) {
    return <Card><CardHeader title="PRE-LIVE LAUNCH READINESS" subtitle="Readiness metadata is unavailable." /></Card>;
  }
  if (!data) return null;

  const providerGate = data.gates.find((gate) => gate.id === "GATE_14_PROVIDER_ACTIVATION");
  const liveTestGate = data.gates.find((gate) => gate.id === "GATE_15_LIVE_TEST");
  return (
    <Card>
      <CardHeader
        title="PRE-LIVE LAUNCH READINESS"
        subtitle="Internal engineering readiness only. This is not a revenue, market, or business-success score."
        action={<Badge className={statusClass(data.status)}>{data.status}</Badge>}
      />
      <div className="border-b border-slate-100 p-5">
        <div className="text-3xl font-semibold text-slate-900">{data.score}<span className="ml-1 text-sm font-normal text-slate-500">/ 100 internal readiness</span></div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
          <span>Security: {data.securityReady ? "ready" : "not ready"}</span>
          <span>Data classes: {data.dataReady ? "ready" : "not ready"}</span>
          <span>Execution: {data.executionReady ? "ready" : "not ready"}</span>
          <span>Observability: {data.observabilityReady ? "ready" : "not ready"}</span>
        </div>
      </div>
      <div className="grid gap-2 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {data.gates.map((gate) => (
          <div key={gate.id} className="rounded-md border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{gate.id.replace("GATE_", "").replaceAll("_", " ")}</span>
              <Badge className={statusClass(gate.status)}>{gate.status === "PASS" ? "✓" : gate.status}</Badge>
            </div>
            <p className="mt-1 text-xs text-slate-500">{gate.reason}</p>
            <p className="mt-2 text-xs text-slate-700">Next: {gate.requiredAction}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 border-t border-slate-100 p-5 lg:grid-cols-3">
        <div>
          <h4 className="text-xs font-semibold uppercase text-slate-500">PENDING</h4>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            <li>Provider activation: {providerGate?.status ?? "PENDING"}</li>
            <li>Live provider test: {liveTestGate?.status ?? "PENDING"}</li>
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-slate-500">BLOCKERS</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{data.blockers.length ? data.blockers.map((item) => <li key={item}>{item}</li>) : <li>None reported.</li>}</ul>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-slate-500">WARNINGS</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{data.warnings.length ? data.warnings.map((item) => <li key={item}>{item}</li>) : <li>None reported.</li>}</ul>
        </div>
      </div>
    </Card>
  );
}
