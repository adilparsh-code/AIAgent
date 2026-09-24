"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, dataClassBadgeClass, statusBadgeClass } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/http";

type FeedbackBoundary = {
  provider: string;
  status: string;
  statusLabel: string;
  message: string;
  checkedAt: string | null;
  recordsAvailable: boolean;
};

type ClosedLoopResponse = {
  assessment: {
    measurementState: string;
    learningState: string;
    reassessmentState: string;
    prioritizationChanged: boolean;
    outcome: string;
    decision: string;
    confidence: number;
    contradiction: string;
    explanation: string[];
  };
};

export function ClosedLoopPanel({ experimentId }: { experimentId: string }) {
  const [boundary, setBoundary] = useState<FeedbackBoundary | null>(null);
  const [closedLoop, setClosedLoop] = useState<ClosedLoopResponse["assessment"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBoundary(await apiGet<FeedbackBoundary>(`/api/experiments/${experimentId}/feedback/ingest`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Feedback boundary unavailable");
    }
  }, [experimentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runClosedLoop() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiSend<ClosedLoopResponse>(`/api/experiments/${experimentId}/closed-loop`, "POST", {});
      setClosedLoop(result.assessment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Closed-loop assessment failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Execution feedback boundary"
          subtitle="External feedback is accepted only through a healthy, provider-agnostic adapter. No provider response is assumed."
          action={<Button variant="secondary" onClick={load}>Refresh status</Button>}
        />
        <div className="space-y-3 p-5 text-sm">
          {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
          {boundary ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={statusBadgeClass(boundary.status)}>{boundary.statusLabel}</Badge>
                <span className="text-slate-600">Provider: {boundary.provider}</span>
                {boundary.checkedAt && <span className="text-xs text-slate-400">Checked {new Date(boundary.checkedAt).toLocaleString()}</span>}
              </div>
              <p className={boundary.recordsAvailable ? "text-emerald-700" : "text-slate-600"}>{boundary.message}</p>
              {!boundary.recordsAvailable && <p className="text-xs text-slate-400">Feedback remains pending; no users, conversions, revenue, or execution outcome were inferred.</p>}
            </>
          ) : <p className="text-slate-500">Loading feedback boundary…</p>}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Closed-loop income intelligence"
          subtitle="Runs the existing metric → learning → reassessment → deterministic prioritization path. It does not invent revenue or success."
          action={<Button onClick={runClosedLoop} disabled={busy}>{busy ? "Assessing…" : "Run closed-loop pass"}</Button>}
        />
        <div className="space-y-3 p-5 text-sm">
          {closedLoop ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge className={closedLoop.measurementState === "MEASURED_REAL_DATA" ? dataClassBadgeClass("REAL_DATA") : "bg-slate-100 text-slate-700"}>{closedLoop.measurementState.replaceAll("_", " ")}</Badge>
                <Badge className={statusBadgeClass(closedLoop.learningState)}>{closedLoop.learningState.replaceAll("_", " ")}</Badge>
                <Badge className={statusBadgeClass(closedLoop.reassessmentState)}>{closedLoop.reassessmentState.replaceAll("_", " ")}</Badge>
                {closedLoop.prioritizationChanged && <Badge className="bg-blue-100 text-blue-800">PRIORITIZATION UPDATED</Badge>}
              </div>
              <p><strong>Outcome:</strong> {closedLoop.outcome} · <strong>Decision:</strong> {closedLoop.decision} · <strong>Confidence:</strong> {(closedLoop.confidence * 100).toFixed(0)}%</p>
              <p className={closedLoop.contradiction === "NONE" ? "text-slate-600" : "text-amber-700"}><strong>Contradiction:</strong> {closedLoop.contradiction.replaceAll("_", " ")}</p>
              <ul className="list-disc space-y-1 pl-5 text-slate-600">{closedLoop.explanation.map((line) => <li key={line}>{line}</li>)}</ul>
            </>
          ) : (
            <p className="text-slate-500">No closed-loop pass has been requested for this experiment yet. Run it after recording metrics.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
