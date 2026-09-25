"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, CardHeader, Button, statusBadgeClass } from "@/components/ui";
import { apiGet } from "@/lib/http";

type GrowthResponse = {
  portfolioDecision: string;
  capacity: {
    state: string;
    activeExperiments: number;
    maxExperiments: number;
    activeExecutions: number;
    maxExecutions: number;
    activeResearchRuns: number;
    maxResearchRuns: number;
    starvationReason: string | null;
    explanation: string[];
  };
  runawaySignals: Array<{ kind: string; detail: string; affectedOpportunityIds: string[] }>;
  closedLoopSummary: {
    experimentsWithLearningSignal: number;
    experimentsWithRealData: number;
    experimentsNotMeasured: number;
    experimentsEstimatedOnly: number;
    reprioritizationActive: boolean;
    explanation: string[];
  };
  experiments: Array<{ experimentId: string; opportunityId: string; queue: string | null; stage: string | null }>;
  queues: Record<string, string[]>;
  selectedOpportunityIds: string[];
  deferredOpportunityIds: string[];
  controllerReasons: string[];
  explanation: string[];
  dataClass: string;
  generatedAt: string;
};

type RevenueResponse = {
  dataClass: string;
  portfolioTotals: {
    realRevenue: number | null;
    realCost: number | null;
    realConversions: number | null;
    currency: string | null;
    measuredExperiments: number;
    experimentsAwaitingMeasurement: number;
    experimentsNotMeasured: number;
    totalExperiments: number;
    provenanceNote: string;
  };
  experiments: Array<{
    experimentId: string;
    outcome: string;
    outcomeNote: string | null;
    measurementCompleteness: number;
    missingMetrics: string[];
    realRecordCount: number;
    estimatedRecordCount: number;
    financial: {
      currency: string | null;
      revenue: number | null;
      cost: number | null;
      profit: number | null;
      roi: number | null;
      conversions: number | null;
      dataClass: string;
      revenueProvenanceNote: string | null;
    };
  }>;
  recommendations: Array<{ experimentId: string; recommendation: string; evidence: string[] }>;
  explanation: string[];
  truncated: boolean;
  bounds: { MAX_METRIC_ROWS_PER_EXPERIMENT: number };
};

const OUTCOME_BADGE: Record<string, string> = {
  MEASURED_POSITIVE: "bg-emerald-100 text-emerald-800",
  MEASURED_NEGATIVE: "bg-red-100 text-red-800",
  UNCERTAIN: "bg-amber-100 text-amber-800",
  NOT_MEASURED: "bg-slate-100 text-slate-600",
  AWAITING_MEASUREMENT: "bg-blue-100 text-blue-800",
  REQUIRES_REVIEW: "bg-amber-100 text-amber-800",
  BLOCKED: "bg-red-100 text-red-800",
};

const RECOMMENDATION_BADGE: Record<string, string> = {
  SCALE_CANDIDATE: "bg-emerald-100 text-emerald-800",
  CONTINUE_EXPERIMENT: "bg-blue-100 text-blue-800",
  COLLECT_MORE_DATA: "bg-slate-100 text-slate-600",
  PAUSE: "bg-amber-100 text-amber-800",
  REASSESS: "bg-amber-100 text-amber-800",
  HUMAN_REVIEW: "bg-orange-100 text-orange-800",
  LOW_SIGNAL: "bg-slate-100 text-slate-600",
  INSUFFICIENT_DATA: "bg-slate-100 text-slate-600",
};

function money(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  const symbol = currency === "USD" ? "$" : currency ? `${currency} ` : "";
  return `${symbol}${value.toFixed(2)}`;
}

const CAPACITY_BADGE: Record<string, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-800",
  AT_CAPACITY: "bg-amber-100 text-amber-800",
  STARVED: "bg-orange-100 text-orange-800",
  BLOCKED: "bg-red-100 text-red-800",
};

export default function GrowthPage() {
  const [data, setData] = useState<GrowthResponse | null>(null);
  const [revenue, setRevenue] = useState<RevenueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [growth, revenueState] = await Promise.all([
        apiGet<GrowthResponse>("/api/growth/portfolio"),
        apiGet<RevenueResponse>("/api/growth/revenue").catch(() => null),
      ]);
      setData(growth);
      setRevenue(revenueState);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Growth portfolio unavailable");
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
          <h1 className="text-2xl font-bold">Growth Portfolio</h1>
          <p className="text-sm text-slate-500">
            Bounded, explainable portfolio growth state — reuses existing prioritization, capacity, and closed-loop contracts.
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {error && <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</Card>}

      {revenue && (
        <Card>
          <CardHeader
            title="Revenue intelligence (Phase 26)"
            subtitle="Read-model over existing ExperimentMetric aggregation; revenue is claimed only from REAL_DATA provenance."
            action={
              <Badge
                className={
                  revenue.dataClass === "REAL_DATA"
                    ? "bg-emerald-100 text-emerald-800"
                    : revenue.dataClass === "NOT_MEASURED"
                      ? "bg-slate-100 text-slate-600"
                      : "bg-amber-100 text-amber-800"
                }
              >
                {revenue.dataClass}
              </Badge>
            }
          />
          <div className="space-y-3 p-5 text-sm">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-md border p-3">
                <div className="text-xs text-slate-500">Real revenue (REAL_DATA only)</div>
                <div className="text-lg font-semibold">{money(revenue.portfolioTotals.realRevenue, revenue.portfolioTotals.currency)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-slate-500">Real cost</div>
                <div className="text-lg font-semibold">{money(revenue.portfolioTotals.realCost, revenue.portfolioTotals.currency)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-slate-500">Real conversions</div>
                <div className="text-lg font-semibold">{revenue.portfolioTotals.realConversions === null ? "—" : revenue.portfolioTotals.realConversions}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-slate-500">Measured / total experiments</div>
                <div className="text-lg font-semibold">{revenue.portfolioTotals.measuredExperiments} / {revenue.portfolioTotals.totalExperiments}</div>
              </div>
            </div>
            <p className="rounded-md bg-slate-50 px-3 py-2 text-slate-600">{revenue.portfolioTotals.provenanceNote}</p>
            {revenue.truncated && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
                Bounded read: one or more experiments exceed the per-experiment metric cap ({revenue.bounds.MAX_METRIC_ROWS_PER_EXPERIMENT} records); totals reflect the most recently recorded rows only.
              </p>
            )}

            {revenue.experiments.length > 0 && (
              <div className="space-y-2">
                <div className="grid gap-3 sm:grid-cols-2">
                  {revenue.experiments.map((experiment) => {
                    const recommendation = revenue.recommendations.find((r) => r.experimentId === experiment.experimentId);
                    return (
                      <div key={experiment.experimentId} className="rounded-md border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs text-slate-500">{experiment.experimentId.slice(0, 10)}…</span>
                          <Badge className={OUTCOME_BADGE[experiment.outcome] ?? "bg-slate-100 text-slate-600"}>
                            {experiment.outcome.replaceAll("_", " ")}
                          </Badge>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <Badge className={RECOMMENDATION_BADGE[recommendation?.recommendation ?? ""] ?? "bg-slate-100 text-slate-600"}>
                            {recommendation?.recommendation.replaceAll("_", " ") ?? "—"}
                          </Badge>
                          <span className="text-xs text-slate-500">completeness {(experiment.measurementCompleteness * 100).toFixed(0)}%</span>
                        </div>
                        <div className="mt-1.5 grid grid-cols-2 gap-x-3 text-xs text-slate-600">
                          <span>Real revenue: {money(experiment.financial.revenue, experiment.financial.currency)}</span>
                          <span>Real cost: {money(experiment.financial.cost, experiment.financial.currency)}</span>
                          <span>Conversions: {experiment.financial.conversions === null ? "—" : experiment.financial.conversions}</span>
                          <span>Financial data class: {experiment.financial.dataClass}</span>
                        </div>
                        {experiment.outcomeNote && <p className="mt-1 text-xs text-amber-700">{experiment.outcomeNote}</p>}
                        {recommendation && recommendation.evidence.length > 0 && (
                          <p className="mt-1 text-xs text-slate-500">Basis: {recommendation.evidence.join(" ")}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">
              {revenue.explanation.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {data && (
        <>
          <Card>
            <CardHeader
              title="Portfolio decision"
              subtitle="Derived by the existing portfolio intelligence; no new scoring system."
              action={<Badge className={statusBadgeClass(data.portfolioDecision)}>{data.portfolioDecision.replaceAll("_", " ")}</Badge>}
            />
            <div className="space-y-2 p-5 text-sm text-slate-600">
              <p>Data class: <Badge className={data.dataClass === "REAL_DATA" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>{data.dataClass}</Badge></p>
              <p>Generated {new Date(data.generatedAt).toLocaleString()}</p>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Experiment & execution capacity"
              subtitle="Observes the existing Phase 19/20 operating limits; the growth layer adds no second budget."
              action={<Badge className={CAPACITY_BADGE[data.capacity.state] ?? "bg-slate-100 text-slate-700"}>{data.capacity.state.replaceAll("_", " ")}</Badge>}
            />
            <div className="grid gap-3 p-5 sm:grid-cols-3">
              <div className="rounded-md border p-3">
                <div className="text-xs text-slate-500">Experiment slots</div>
                <div className="text-lg font-semibold">{data.capacity.activeExperiments} / {data.capacity.maxExperiments}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-slate-500">Execution slots</div>
                <div className="text-lg font-semibold">{data.capacity.activeExecutions} / {data.capacity.maxExecutions}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-slate-500">Research runs</div>
                <div className="text-lg font-semibold">{data.capacity.activeResearchRuns} / {data.capacity.maxResearchRuns}</div>
              </div>
            </div>
            <div className="space-y-2 border-t border-slate-100 p-5 text-sm">
              {data.capacity.starvationReason && (
                <p className="rounded-md bg-orange-50 px-3 py-2 text-orange-800">{data.capacity.starvationReason}</p>
              )}
              <ul className="list-disc space-y-1 pl-5 text-slate-600">
                {data.capacity.explanation.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Runaway prevention"
              subtitle="Advisory signals derived from persisted facts only; nothing is auto-paused."
              action={data.runawaySignals.length === 0 ? <Badge className="bg-emerald-100 text-emerald-800">CLEAR</Badge> : undefined}
            />
            <div className="space-y-3 p-5 text-sm">
              {data.runawaySignals.length === 0 ? (
                <p className="text-slate-500">No runaway pattern detected in the bounded portfolio state.</p>
              ) : (
                data.runawaySignals.map((signal) => (
                  <div key={signal.kind} className="rounded-md border border-amber-200 bg-amber-50 p-3">
                    <div className="font-medium text-amber-900">{signal.kind.replaceAll("_", " ")}</div>
                    <p className="mt-1 text-amber-800">{signal.detail}</p>
                    <p className="mt-1 text-xs text-amber-700">Affected opportunities: {signal.affectedOpportunityIds.join(", ")}</p>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Learning → reassessment → reprioritization"
              subtitle="Composition summary over the existing learning and closed-loop services; no metrics are invented."
            />
            <div className="space-y-3 p-5 text-sm">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md border p-3"><div className="text-xs text-slate-500">With learning signal</div><div className="text-lg font-semibold">{data.closedLoopSummary.experimentsWithLearningSignal}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs text-slate-500">With REAL_DATA</div><div className="text-lg font-semibold">{data.closedLoopSummary.experimentsWithRealData}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs text-slate-500">Not measured</div><div className="text-lg font-semibold">{data.closedLoopSummary.experimentsNotMeasured}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs text-slate-500">Estimated only</div><div className="text-lg font-semibold">{data.closedLoopSummary.experimentsEstimatedOnly}</div></div>
              </div>
              {data.closedLoopSummary.reprioritizationActive && (
                <Badge className="bg-blue-100 text-blue-800">REPRIORITIZATION ACTIVE (existing controller)</Badge>
              )}
              <ul className="list-disc space-y-1 pl-5 text-slate-600">
                {data.closedLoopSummary.explanation.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          </Card>

          <Card>
            <CardHeader title="Portfolio queues" subtitle="Existing deterministic buckets projected into the growth view." />
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(data.queues).map(([queue, ids]) => (
                <div key={queue} className="rounded-md border p-3">
                  <div className="text-xs text-slate-500">{queue.replaceAll("_", " ")}</div>
                  <div className="mt-1 text-sm font-medium">{ids.length === 0 ? "—" : ids.join(", ")}</div>
                </div>
              ))}
            </div>
            <div className="space-y-2 border-t border-slate-100 p-5 text-sm text-slate-600">
              <p><strong>Selected this cycle:</strong> {data.selectedOpportunityIds.length === 0 ? "none" : data.selectedOpportunityIds.join(", ")}</p>
              <p><strong>Deferred:</strong> {data.deferredOpportunityIds.length === 0 ? "none" : data.deferredOpportunityIds.join(", ")}</p>
              <ul className="list-disc space-y-1 pl-5">
                {data.controllerReasons.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          </Card>

          <Card>
            <CardHeader title="How this view stays honest" />
            <ul className="list-disc space-y-1 p-5 pl-10 text-sm text-slate-600">
              {data.explanation.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
