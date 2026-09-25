"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, CardHeader, Button, statusBadgeClass } from "@/components/ui";
import { apiGet } from "@/lib/http";

type Snapshot = {
  version: number;
  lifecycle: Array<{ stage: string; state: string; basis: string; reason: string; observed: number | null }>;
  stagesHealthy: number;
  stagesDegraded: number;
  stagesPending: number;
  stagesBlocked: number;
  findings: Array<{ kind: string; severity: string; detail: string }>;
  gates: Array<{ id: string; area: string; state: string; reason: string }>;
  overallState: string;
  unverifiedInProduction: string[];
  explanation: string[];
  dataClass: string;
  generatedAt: string;
};

const STATE_BADGE: Record<string, string> = {
  HEALTHY: "bg-emerald-100 text-emerald-800",
  PASS: "bg-emerald-100 text-emerald-800",
  DEGRADED: "bg-amber-100 text-amber-800",
  WARN: "bg-amber-100 text-amber-800",
  PENDING: "bg-slate-100 text-slate-700",
  BLOCKED: "bg-red-100 text-red-800",
  FAIL: "bg-red-100 text-red-800",
};

const SEVERITY_BADGE: Record<string, string> = {
  INFO: "bg-slate-100 text-slate-700",
  WARNING: "bg-amber-100 text-amber-800",
  CRITICAL: "bg-red-100 text-red-800",
};

export default function PlatformPage() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiGet<Snapshot>("/api/system/platform"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Platform snapshot unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Platform Integration</h1>
          <p className="text-sm text-slate-500">
            Production lifecycle consistency across the full pipeline — composed from existing health and portfolio read-models.
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {error && <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</Card>}

      {data && (
        <>
          <Card>
            <CardHeader
              title="Overall integration state"
              subtitle="Fails closed: WARN/FAIL until every composed gate passes on persisted facts."
              action={<Badge className={STATE_BADGE[data.overallState] ?? "bg-slate-100 text-slate-700"}>{data.overallState}</Badge>}
            />
            <div className="grid gap-3 p-5 sm:grid-cols-4">
              <div className="rounded-md border p-3"><div className="text-xs text-slate-500">Stages healthy</div><div className="text-lg font-semibold">{data.stagesHealthy}</div></div>
              <div className="rounded-md border p-3"><div className="text-xs text-slate-500">Stages degraded</div><div className="text-lg font-semibold">{data.stagesDegraded}</div></div>
              <div className="rounded-md border p-3"><div className="text-xs text-slate-500">Stages pending</div><div className="text-lg font-semibold">{data.stagesPending}</div></div>
              <div className="rounded-md border p-3"><div className="text-xs text-slate-500">Stages blocked</div><div className="text-lg font-semibold">{data.stagesBlocked}</div></div>
            </div>
            <p className="border-t border-slate-100 p-5 text-xs text-slate-400">Snapshot generated {new Date(data.generatedAt).toLocaleString()}</p>
          </Card>

          <Card>
            <CardHeader title="Lifecycle consistency" subtitle="DISCOVER → … → FEEDBACK, each mapped to its existing authority." />
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {data.lifecycle.map((stage) => (
                <div key={stage.stage} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{stage.stage}</div>
                    <Badge className={STATE_BADGE[stage.state] ?? "bg-slate-100 text-slate-700"}>{stage.state}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{stage.basis}</p>
                  <p className="mt-1 text-xs text-slate-600">{stage.reason}</p>
                  {stage.observed !== null && <p className="mt-1 text-xs text-slate-400">Observed: {stage.observed}</p>}
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Cross-component findings" subtitle="Derived only from persisted facts; INFO when nothing is inconsistent." />
            <div className="space-y-3 p-5 text-sm">
              {data.findings.map((finding) => (
                <div key={`${finding.kind}:${finding.detail}`} className="rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <Badge className={SEVERITY_BADGE[finding.severity] ?? "bg-slate-100 text-slate-700"}>{finding.severity}</Badge>
                    <span className="font-medium">{finding.kind.replaceAll("_", " ")}</span>
                  </div>
                  <p className="mt-1 text-slate-600">{finding.detail}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Production gates" subtitle="Composition of existing health components and persisted facts." />
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              {data.gates.map((gate) => (
                <div key={gate.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">{gate.area}</div>
                    <p className="mt-1 text-xs text-slate-500">{gate.reason}</p>
                  </div>
                  <Badge className={STATE_BADGE[gate.state] ?? "bg-slate-100 text-slate-700"}>{gate.state}</Badge>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Unverified in production" subtitle="What this snapshot deliberately does not claim." />
            <ul className="list-disc space-y-1 p-5 pl-10 text-sm text-slate-600">
              {data.unverifiedInProduction.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </Card>

          <Card>
            <CardHeader title="How this snapshot stays honest" />
            <ul className="list-disc space-y-1 p-5 pl-10 text-sm text-slate-600">
              {data.explanation.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
