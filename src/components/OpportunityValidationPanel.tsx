"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, Button } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/http";

interface ValidationData {
  opportunityId: string;
  validation: {
    state: string;
    dataClass: string;
    reasons: string[];
    missing: string[];
    blockers: string[];
    nextAction: string;
    considered: {
      decision: string;
      readiness: string;
      researchFreshness: string;
      evidenceCoverage: number;
      sourceDiversity: number;
      contradictionCount: number;
      realMetricPeriods: number;
      estimatedMetricPeriods: number;
      measurementStatus: string;
    };
  };
}

export function OpportunityValidationPanel({ opportunityId }: { opportunityId: string }) {
  const [data, setData] = useState<ValidationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<ValidationData>(`/api/opportunities/${opportunityId}/validation`));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Validation unavailable");
    }
  }, [opportunityId]);

  useEffect(() => { void load(); }, [load]);

  async function recheck() {
    setBusy(true);
    try {
      setData(await apiSend<ValidationData>(`/api/opportunities/${opportunityId}/validation`, "POST", {}));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Validation check failed");
    } finally {
      setBusy(false);
    }
  }

  const v = data?.validation;
  return (
    <Card>
      <CardHeader
        title="Controlled opportunity validation"
        subtitle="Deterministic read model: research and evidence are checked before progression; no provider call or fabricated result occurs."
        action={<Button onClick={recheck} disabled={busy}>{busy ? "Checking…" : "Re-check validation"}</Button>}
      />
      <div className="space-y-3 p-5 text-sm">
        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        {!v ? <p className="text-slate-500">Validation is unavailable until the opportunity is persisted.</p> : <>
          <p><strong>State:</strong> {v.state.replace(/_/g, " ")} · <strong>Evidence class:</strong> {v.dataClass}</p>
          <p><strong>Decision/readiness:</strong> {v.considered.decision} / {v.considered.readiness} · research {v.considered.researchFreshness.replace(/_/g, " ")}</p>
          <p><strong>Measurement:</strong> {v.considered.measurementStatus} · {v.considered.realMetricPeriods} real period(s), {v.considered.estimatedMetricPeriods} estimated period(s)</p>
          {v.reasons.length > 0 && <ul className="list-disc pl-5 text-slate-600">{v.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
          {v.missing.length > 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">Missing: {v.missing.join("; ")}</p>}
          {v.blockers.length > 0 && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">Blockers: {v.blockers.join("; ")}</p>}
          <p className="font-medium">Next action: {v.nextAction.replace(/_/g, " ")}</p>
        </>}
      </div>
    </Card>
  );
}
