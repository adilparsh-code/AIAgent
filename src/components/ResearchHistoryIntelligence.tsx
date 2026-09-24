"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, Badge } from "@/components/ui";

type Summary = {
  runCount: number;
  completedCount: number;
  partialCount: number;
  failedCount: number;
  latestRunId: string | null;
  latestVsPrevious: {
    confidenceDelta: number | null;
    evidenceDelta: number | null;
    sourceDiversityDelta: number | null;
    contradictionDelta: number | null;
  };
  trend: Array<{
    runId: string;
    date: string;
    confidence: number;
    evidenceCount: number;
    sourceDiversity: number;
    contradictionCount: number;
    status: string;
  }>;
  providers: Array<{
    provider: string;
    attempts: number;
    successes: number;
    failures: number;
    successRate: number;
    evidenceItems: number;
  }>;
  recurringEvidence: Array<{
    hash: string;
    appearances: number;
    runs: string[];
    title: string;
    source: string;
    url: string;
  }>;
  repeatedEvidenceCount: number;
  uniqueEvidenceCount: number;
};

function delta(value: number | null, suffix = "") {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(value % 1 === 0 ? 0 : 2)}${suffix}`;
}

export function ResearchHistoryIntelligence({ opportunityId }: { opportunityId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(`/api/opportunities/${encodeURIComponent(opportunityId)}/research-history`)
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return (await response.json()) as Summary;
      })
      .then((data) => { if (active) setSummary(data); })
      .catch(() => { if (active) setSummary(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [opportunityId]);

  if (loading || !summary || summary.runCount === 0) return null;

  const latest = summary.trend.at(-1);
  const previous = summary.trend.at(-2);

  return (
    <Card>
      <CardHeader
        title="Research intelligence"
        subtitle="Cross-run history from persisted evidence — no external provider is called by this panel."
      />
      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border p-3">
          <div className="text-xs text-slate-500">Runs</div>
          <div className="text-lg font-semibold">{summary.runCount}</div>
          <div className="text-xs text-slate-500">{summary.completedCount} complete · {summary.partialCount} partial · {summary.failedCount} failed</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-slate-500">Confidence change</div>
          <div className="text-lg font-semibold">{delta(summary.latestVsPrevious.confidenceDelta)}</div>
          <div className="text-xs text-slate-500">latest vs previous</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-slate-500">Evidence</div>
          <div className="text-lg font-semibold">{summary.uniqueEvidenceCount}</div>
          <div className="text-xs text-slate-500">{summary.repeatedEvidenceCount} recurring hashes across runs</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-slate-500">Source diversity</div>
          <div className="text-lg font-semibold">{delta(summary.latestVsPrevious.sourceDiversityDelta)}</div>
          <div className="text-xs text-slate-500">latest vs previous</div>
        </div>
      </div>

      <div className="grid gap-4 border-t p-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Provider reliability</h3>
          <ul className="space-y-2 text-sm">
            {summary.providers.map((provider) => (
              <li key={provider.provider} className="flex items-center justify-between gap-3">
                <span className="font-medium">{provider.provider}</span>
                <span className="text-slate-500">
                  {provider.successes}/{provider.attempts} successful · {Math.round(provider.successRate * 100)}% · {provider.evidenceItems} evidence
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Latest run</h3>
          {latest ? (
            <div className="text-sm text-slate-600">
              <Badge>{latest.status}</Badge>{" "}
              confidence {(latest.confidence * 100).toFixed(0)}% · {latest.evidenceCount} evidence · diversity {latest.sourceDiversity}
              {previous && (
                <div className="mt-1 text-xs text-slate-500">
                  Evidence {delta(summary.latestVsPrevious.evidenceDelta)} · contradictions {delta(summary.latestVsPrevious.contradictionDelta)}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {summary.recurringEvidence.length > 0 && (
        <div className="border-t p-5">
          <h3 className="mb-2 text-sm font-semibold">Recurring evidence</h3>
          <ul className="space-y-2 text-sm">
            {summary.recurringEvidence.slice(0, 5).map((item) => (
              <li key={item.hash} className="rounded-md border p-3">
                <div className="font-medium">{item.title || item.source}</div>
                <div className="text-xs text-slate-500">
                  Appears in {item.appearances} research runs · {item.source}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
