"use client";

import { useEffect, useState } from "react";
import { Badge, Card, CardHeader, dataClassBadgeClass, dataClassLabel } from "@/components/ui";

type QueueKey =
  | "RESEARCH_QUEUE"
  | "VALIDATION_QUEUE"
  | "EXPERIMENT_QUEUE"
  | "LEARNING_QUEUE"
  | "HANDOFF_QUEUE"
  | "EXECUTION_QUEUE"
  | "HUMAN_REVIEW_QUEUE"
  | "BLOCKED_QUEUE"
  | "MONITOR_QUEUE";

type ConcentrationWarning = { code: string; detail: string; affected: number; kind: string };
type Recommendation = { opportunityId: string; label: string; reason: string; priorityScore: number };

type PortfolioResponse = {
  summary: {
    totalOpportunities: number;
    activeOpportunities: number;
    blockedOpportunities: number;
    researchRequired: number;
    validationRequired: number;
    experimentsRequired: number;
    handoffReady: number;
    executionReady: number;
    humanReviewRequired: number;
    portfolioConfidence: number;
    staleOpportunityCount: number;
    bounds: { maxOpportunities: number; truncated: boolean };
  };
  queues: Record<QueueKey, string[]>;
  portfolioDecision: string;
  recommendedNextActions: string[];
  recommendations: Recommendation[];
  concentrationWarnings: ConcentrationWarning[];
  evidenceQualitySummary: {
    opportunitiesWithValidationConfidence: number;
    averageConfidence: number;
    realDataOpportunities: number;
    aiEstimateOpportunities: number;
    nonRealDataLimitations: string[];
  };
  experimentCoverageSummary: {
    opportunitiesWithExperiments: number;
    withSufficientRealData: number;
    withInsufficientRealData: number;
    estimatedOnly: number;
    withNoData: number;
    averageRealMetricPeriods: number;
  };
  explanation: string[];
  dataClass: string;
  generatedAt: string;
};

const QUEUE_LABELS: Array<{ key: QueueKey; label: string }> = [
  { key: "RESEARCH_QUEUE", label: "Research" },
  { key: "VALIDATION_QUEUE", label: "Validation" },
  { key: "EXPERIMENT_QUEUE", label: "Experiments" },
  { key: "LEARNING_QUEUE", label: "Learning" },
  { key: "HANDOFF_QUEUE", label: "Handoff" },
  { key: "EXECUTION_QUEUE", label: "Execution" },
  { key: "HUMAN_REVIEW_QUEUE", label: "Human Review" },
  { key: "BLOCKED_QUEUE", label: "Blocked" },
  { key: "MONITOR_QUEUE", label: "Monitor" },
];

function decisionBadgeClass(decision: string): string {
  switch (decision) {
    case "EXECUTE_APPROVED_WORK":
    case "COMPLETE_HANDOFFS":
      return "bg-emerald-100 text-emerald-800";
    case "HUMAN_REVIEW_REQUIRED":
    case "REVIEW_CONFLICTS":
      return "bg-amber-100 text-amber-800";
    case "FILL_RESEARCH_GAPS":
    case "VALIDATE_OPPORTUNITIES":
    case "RUN_EXPERIMENTS":
    case "IMPROVE_EXPERIMENTS":
      return "bg-sky-100 text-sky-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export function OpportunityPortfolioPanel() {
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/opportunities/portfolio")
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return (await response.json()) as PortfolioResponse;
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
        <CardHeader
          title="Portfolio intelligence"
          subtitle="Portfolio intelligence is unavailable."
        />
        <p className="p-5 text-sm text-slate-500">
          No portfolio data is available. It may not be loaded yet, or the panel could not be
          loaded.
        </p>
      </Card>
    );
  }

  const s = data.summary;
  const stats: Array<{ label: string; value: number | string }> = [
    { label: "Total opportunities", value: s.totalOpportunities },
    { label: "Active", value: s.activeOpportunities },
    { label: "Blocked", value: s.blockedOpportunities },
    { label: "Research required", value: s.researchRequired },
    { label: "Validation required", value: s.validationRequired },
    { label: "Experiments required", value: s.experimentsRequired },
    { label: "Handoff ready", value: s.handoffReady },
    { label: "Execution ready", value: s.executionReady },
  ];

  return (
    <Card>
      <CardHeader
        title="Portfolio intelligence"
        subtitle="Collective operational view of your opportunities — deterministic, from persisted data only. Not a profitability prediction."
        action={
          <Badge className={dataClassBadgeClass(data.dataClass)}>
            {dataClassLabel(data.dataClass)}
          </Badge>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-md border p-3">
            <div className="text-xs text-slate-500">{stat.label}</div>
            <div className="mt-1 text-lg font-semibold">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Current portfolio action — exactly one */}
      <div className="border-y border-slate-100 bg-slate-50 p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Current portfolio action
        </div>
        <div className="mt-1">
          <Badge className={decisionBadgeClass(data.portfolioDecision)}>
            {data.portfolioDecision}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-slate-700">{data.recommendedNextActions.length > 0 ? data.recommendedNextActions[0] : data.explanation[0]}</p>
      </div>

      {/* Operational queues */}
      <div className="border-b border-slate-100 p-5">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Operational queues
        </h4>
        <div className="grid gap-2 sm:grid-cols-3">
          {QUEUE_LABELS.map(({ key, label }) => {
            const ids = data.queues[key] ?? [];
            return (
              <div key={key} className="rounded-md border p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700">{label}</span>
                  <span className="text-xs text-slate-500">{ids.length}</span>
                </div>
                {ids.length > 0 ? (
                  <p className="mt-1 truncate text-xs text-slate-500" title={ids.join(", ")}>
                    {ids.length === 1 ? ids[0] : `${ids.slice(0, 3).join(", ")}${ids.length > 3 ? "…" : ""}`}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">—</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Recommendations (neutral operational labels) */}
      {data.recommendations.length > 0 && (
        <div className="border-b border-slate-100 p-5">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Opportunities requiring attention
          </h4>
          <ul className="space-y-1.5 text-sm">
            {data.recommendations.map((item) => (
              <li key={item.opportunityId} className="rounded-md border p-2">
                <span className="font-medium text-slate-700">{item.label}</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {item.reason} ({item.opportunityId})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Concentration warnings */}
      <div className="border-b border-slate-100 p-5">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Concentration warnings
        </h4>
        {data.concentrationWarnings.length === 0 ? (
          <p className="text-sm text-slate-500">No concentration warnings.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data.concentrationWarnings.map((warning) => (
              <li key={warning.code} className="rounded-md border border-amber-200 bg-amber-50 p-2">
                <span className="font-medium text-amber-800">{warning.code.replace(/_/g, " ")}</span>
                <span className="mt-0.5 block text-amber-700">{warning.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Data quality */}
      <div className="p-5">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Data quality
        </h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border p-3 text-sm">
            <div className="text-xs text-slate-500">REAL_DATA coverage</div>
            <p className="mt-1">
              {data.evidenceQualitySummary.realDataOpportunities} opportunity(ies) backed by real
              validation or REAL_DATA metrics;{" "}
              {data.experimentCoverageSummary.withSufficientRealData} experiment(ies) have sufficient
              REAL_DATA coverage.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {data.experimentCoverageSummary.averageRealMetricPeriods} average REAL_DATA period(s)
              per experimented opportunity.
            </p>
          </div>
          <div className="rounded-md border p-3 text-sm">
            <div className="text-xs text-slate-500">Non-real data limitations</div>
            <ul className="mt-1 list-inside list-disc text-xs text-slate-600">
              {data.evidenceQualitySummary.nonRealDataLimitations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-slate-500">
              {s.staleOpportunityCount} opportunity(ies) hold research older than the freshness
              threshold.
            </p>
          </div>
        </div>
        {s.bounds.truncated && (
          <p className="mt-2 text-xs text-slate-500">
            Bounded view: at most {s.bounds.maxOpportunities} opportunities are aggregated per read.
          </p>
        )}
      </div>
    </Card>
  );
}
