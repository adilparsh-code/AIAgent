"use client";

import { useEffect, useState } from "react";
import { Badge, Card, CardHeader, dataClassBadgeClass, dataClassLabel } from "@/components/ui";

type DecisionGap = { layer: string; code: string; detail: string };

type Decision = {
  decision: string;
  decisionScore: number;
  readinessState: string;
  confidence: number;
  blockers: string[];
  evidenceGaps: DecisionGap[];
  validationGaps: DecisionGap[];
  experimentGaps: DecisionGap[];
  executionGaps: DecisionGap[];
  recommendedAction: { action: string; basis: string };
  explanation: string[];
  dataClass: string;
  generatedAt: string;
  lifecycleState: string;
};

function decisionBadgeClass(decision: string): string {
  switch (decision) {
    case "EXECUTION_READY":
    case "HANDOFF_READY":
      return "bg-emerald-100 text-emerald-800";
    case "BLOCKED":
      return "bg-red-100 text-red-800";
    case "HUMAN_REVIEW":
    case "REVIEW_CONFLICT":
      return "bg-amber-100 text-amber-800";
    case "VALIDATE":
    case "RUN_EXPERIMENT":
    case "IMPROVE_EXPERIMENT":
      return "bg-sky-100 text-sky-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function GapList({ title, gaps }: { title: string; gaps: DecisionGap[] }) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      {gaps.length === 0 ? (
        <p className="text-sm text-slate-500">None</p>
      ) : (
        <ul className="space-y-1.5">
          {gaps.map((item) => (
            <li key={`${item.layer}-${item.code}`} className="rounded-md border p-2 text-sm">
              <span className="font-medium text-slate-700">{item.code.replace(/_/g, " ")}</span>
              <span className="mt-0.5 block text-slate-600">{item.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OpportunityDecisionPanel({ opportunityId }: { opportunityId: string }) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/opportunities/${encodeURIComponent(opportunityId)}/decision`)
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return (await response.json()) as { decision: Decision };
      })
      .then((data) => {
        if (active) setDecision(data.decision);
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
  if (unavailable || !decision) {
    // Missing data is stated explicitly — no placeholder success.
    return (
      <Card>
        <CardHeader
          title="Opportunity decision"
          subtitle="The decision panel is unavailable for this opportunity."
        />
        <p className="p-5 text-sm text-slate-500">
          No decision data is available. It may not have research yet, or the panel could not be
          loaded.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Opportunity decision"
        subtitle="Deterministic next-step decision from persisted data only — not a profitability prediction."
        action={
          <Badge className={dataClassBadgeClass(decision.dataClass)}>
            {dataClassLabel(decision.dataClass)}
          </Badge>
        }
      />

      {/* Prominent next action */}
      <div className="border-b border-slate-100 bg-slate-50 p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next action</div>
        <p className="mt-1 text-base font-semibold text-slate-900">{decision.recommendedAction.action}</p>
        <p className="mt-0.5 text-xs text-slate-500">Basis: {decision.recommendedAction.basis}</p>
      </div>

      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border p-3">
          <div className="text-xs text-slate-500">Decision</div>
          <div className="mt-1">
            <Badge className={decisionBadgeClass(decision.decision)}>{decision.decision}</Badge>
          </div>
          <div className="mt-1 text-xs text-slate-500">score {decision.decisionScore}/100 (operational, not quality)</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-slate-500">Readiness</div>
          <div className="mt-1 text-sm font-semibold">{decision.readinessState}</div>
          <div className="mt-1 text-xs text-slate-500">lifecycle: {decision.lifecycleState}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-slate-500">Confidence</div>
          <div className="text-lg font-semibold">{decision.confidence}%</div>
          <div className="text-xs text-slate-500">from persisted validation confidence</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-slate-500">Blockers</div>
          {decision.blockers.length === 0 ? (
            <div className="text-sm text-slate-500">None</div>
          ) : (
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {decision.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-4 border-t border-slate-100 p-5 lg:grid-cols-2">
        <GapList title="Evidence gaps" gaps={decision.evidenceGaps} />
        <GapList title="Validation gaps" gaps={decision.validationGaps} />
        <GapList title="Experiment gaps" gaps={decision.experimentGaps} />
        <GapList title="Execution gaps" gaps={decision.executionGaps} />
      </div>

      <div className="border-t border-slate-100 p-5">
        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Explanation</h4>
        <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
          {decision.explanation.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
