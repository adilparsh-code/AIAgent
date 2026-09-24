"use client";

import { useEffect, useState } from "react";
import { Badge, Card, CardHeader, dataClassBadgeClass, dataClassLabel } from "@/components/ui";

type MissingEvidence = { area: string; reason: string; severity: string };
type Contradiction = { source: string; detail: string };

type Readiness = {
  readinessState: string;
  readinessScore: number;
  confidence: number;
  blockers: string[];
  missingEvidence: MissingEvidence[];
  contradictions: Contradiction[];
  staleResearch: boolean;
  researchFreshness: {
    kind: string;
    isStale: boolean;
    ageDays: number | null;
    thresholdDays: number;
    lastResearchAt: string | null;
  };
  experimentReadiness: {
    experimentCount: number;
    realMetricPeriods: number;
    estimatedMetricPeriods: number;
    dataClass: string;
    sufficient: boolean;
    decisions: string[];
    contradictsResearch: boolean;
  };
  handoffReadiness: { ready: boolean; reasons: string[]; handoffStatus: string | null };
  recommendedNextAction: { action: string; basis: string };
  explanation: string[];
  dataClass: string;
  generatedAt: string;
};

function stateBadgeClass(state: string): string {
  switch (state) {
    case "HANDOFF_READY":
    case "READY_FOR_EXECUTION":
      return "bg-emerald-100 text-emerald-800";
    case "BLOCKED":
      return "bg-red-100 text-red-800";
    case "HUMAN_REVIEW_REQUIRED":
    case "VALIDATION_CONFLICTED":
      return "bg-amber-100 text-amber-800";
    case "RESEARCH_IN_PROGRESS":
      return "bg-sky-100 text-sky-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export function OpportunityReadiness({ opportunityId }: { opportunityId: string }) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/opportunities/${encodeURIComponent(opportunityId)}/readiness`)
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return (await response.json()) as { readiness: Readiness };
      })
      .then((data) => {
        if (active) setReadiness(data.readiness);
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
  }, [opportunityId]);

  if (loading) return null;
  if (unavailable || !readiness) {
    // Missing data is stated explicitly — no placeholder success.
    return (
      <Card>
        <CardHeader
          title="Opportunity readiness"
          subtitle="Readiness is unavailable for this opportunity."
        />
        <p className="p-5 text-sm text-slate-500">
          No readiness data is available. It may not have research yet, or the panel could not be
          loaded.
        </p>
      </Card>
    );
  }

  const freshness = readiness.researchFreshness;
  const experiment = readiness.experimentReadiness;

  return (
    <Card>
      <CardHeader
        title="Opportunity readiness"
        subtitle="Deterministic decision state from persisted evidence only — no external API, no invented market data."
        action={
          <Badge className={dataClassBadgeClass(readiness.dataClass)}>
            {dataClassLabel(readiness.dataClass)}
          </Badge>
        }
      />
      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border p-3">
          <div className="text-xs text-slate-500">Readiness state</div>
          <div className="mt-1">
            <Badge className={stateBadgeClass(readiness.readinessState)}>
              {readiness.readinessState}
            </Badge>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            score {readiness.readinessScore}/100 (decision readiness, not quality)
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-slate-500">Confidence</div>
          <div className="text-lg font-semibold">{readiness.confidence}%</div>
          <div className="text-xs text-slate-500">from persisted validation confidence</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-slate-500">Research freshness</div>
          <div className="text-sm font-semibold">
            {freshness.kind === "NO_RESEARCH" ? "No research" : `${freshness.ageDays} day(s) old`}
          </div>
          <div className="text-xs text-slate-500">
            threshold {freshness.thresholdDays} days · {freshness.isStale ? "stale" : "current"}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-slate-500">Experiment status</div>
          <div className="text-sm font-semibold">
            {experiment.experimentCount === 0
              ? "No experiment"
              : `${experiment.realMetricPeriods} REAL_DATA period(s)`}
          </div>
          <div className="text-xs text-slate-500">
            {experiment.dataClass === "ESTIMATED_DATA"
              ? "estimated data only — not treated as real performance"
              : experiment.dataClass === "NONE"
                ? "no recorded metrics"
                : `${experiment.estimatedMetricPeriods} estimated period(s) excluded`}
          </div>
        </div>
      </div>

      <div className="grid gap-4 border-t p-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Evidence gaps</h3>
          {readiness.missingEvidence.length === 0 ? (
            <p className="text-sm text-slate-500">
              No evidence gaps detected in persisted validation.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {readiness.missingEvidence.map((gap) => (
                <li key={gap.area} className="rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <Badge
                      className={
                        gap.severity === "HIGH" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
                      }
                    >
                      {gap.severity}
                    </Badge>
                    <span className="font-medium">{gap.area.replace(/_/g, " ")}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{gap.reason}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Contradictions</h3>
          {readiness.contradictions.length === 0 ? (
            <p className="text-sm text-slate-500">No contradictory signals recorded.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {readiness.contradictions.map((contradiction, index) => (
                <li
                  key={`${contradiction.source}-${index}`}
                  className="rounded-md border border-amber-200 bg-amber-50 p-3"
                >
                  <div className="text-xs text-slate-500">{contradiction.source}</div>
                  <div>{contradiction.detail}</div>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mb-2 mt-4 text-sm font-semibold">Handoff readiness</h3>
          <div className="text-sm">
            <Badge
              className={
                readiness.handoffReadiness.ready
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-100 text-slate-700"
              }
            >
              {readiness.handoffReadiness.ready ? "READY" : "NOT READY"}
            </Badge>
            {readiness.handoffReadiness.handoffStatus && (
              <span className="ml-2 text-xs text-slate-500">
                persisted handoff: {readiness.handoffReadiness.handoffStatus}
              </span>
            )}
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {readiness.handoffReadiness.reasons.map((reason, index) => (
                <li key={index}>• {reason}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t p-5">
        <h3 className="mb-2 text-sm font-semibold">Recommended next action</h3>
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
          <div className="font-semibold text-blue-900">{readiness.recommendedNextAction.action}</div>
          <div className="mt-1 text-xs text-blue-800">
            Grounded in: {readiness.recommendedNextAction.basis}
          </div>
        </div>
        {readiness.blockers.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-1 text-sm font-semibold">Blockers</h3>
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
              {readiness.blockers.map((blocker, index) => (
                <li key={index}>{blocker}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="border-t p-5">
        <h3 className="mb-2 text-sm font-semibold">Why this state (explanations)</h3>
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
          {readiness.explanation.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-400">
          Computed {new Date(readiness.generatedAt).toLocaleString()} — this engine does not create
          market evidence; it interprets persisted application evidence.
        </p>
      </div>
    </Card>
  );
}
