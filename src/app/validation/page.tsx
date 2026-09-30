"use client";

/**
 * Validation view (Phase 5).
 *
 * Renders backend-persisted validation outcomes per research run — signals,
 * evidence coverage, confidence, conclusion, refusal reasons (errors) and the
 * human-review state. The UI invents no validation logic; it only makes the
 * four verdict classes easy to distinguish at a glance.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/http";
import { Card, CardHeader } from "@/components/ui";
import {
  DashboardCard,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
  statusTone,
} from "@/components/console";
import { formatRelativeTime } from "@/lib/format";

interface ValidationSummary {
  signals: {
    demand: string;
    painPoint: string;
    commercialIntent: string;
    trend: string;
    competition: string;
  };
  evidenceCoverage: number;
  sourceDiversity: number;
  contradictionCount: number;
  confidence: number;
  conclusion: string;
}

interface RecentRun {
  id: string;
  opportunityId: string;
  opportunityTitle: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  conclusion: string | null;
  conclusionBasis: string | null;
  errors: string[];
  validation: ValidationSummary | null;
  evidenceCount: number;
}

const SIGNAL_LABELS: Array<{ key: keyof ValidationSummary["signals"]; label: string }> = [
  { key: "demand", label: "Demand" },
  { key: "painPoint", label: "Pain point" },
  { key: "commercialIntent", label: "Commercial intent" },
  { key: "trend", label: "Trend" },
  { key: "competition", label: "Competition" },
];

const CONCLUSION_CLASSES = ["VALIDATED", "REQUIRES_HUMAN_REVIEW", "REJECTED", "PENDING"] as const;

function conclusionDisplay(run: RecentRun): string {
  if (run.validation?.conclusion) return run.validation.conclusion;
  if (run.conclusion) return run.conclusion;
  if (run.status === "RUNNING") return "PENDING";
  if (run.status === "FAILED") return "INSUFFICIENT_EVIDENCE";
  return "PENDING";
}

export default function ValidationPage() {
  const [runs, setRuns] = useState<RecentRun[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verdictFilter, setVerdictFilter] = useState("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRuns(await apiGet<RecentRun[]>("/api/research/recent?limit=50"));
    } catch (err) {
      setRuns(null);
      setError(err instanceof Error ? err.message : "Validation data unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      (runs ?? []).filter((run) => {
        if (verdictFilter === "ALL") return true;
        return conclusionDisplay(run) === verdictFilter;
      }),
    [runs, verdictFilter],
  );

  const verdictCounts = useMemo(() => {
    const counts: Record<string, number> = { VALIDATED: 0, REQUIRES_HUMAN_REVIEW: 0, REJECTED: 0, PENDING: 0 };
    for (const run of runs ?? []) {
      const verdict = conclusionDisplay(run);
      if (verdict in counts) counts[verdict] += 1;
      else counts[verdict] = (counts[verdict] ?? 0) + 1;
    }
    return counts;
  }, [runs]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Validation</h1>
          <p className="text-sm text-slate-500">
            Evidence-derived validation conclusions, per research run. Signals, coverage and confidence are computed by the
            backend from persisted evidence — never by the UI.
          </p>
        </div>
        <select
          value={verdictFilter}
          onChange={(event) => setVerdictFilter(event.target.value)}
          className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
          aria-label="Filter by validation verdict"
        >
          <option value="ALL">All verdicts</option>
          {CONCLUSION_CLASSES.map((verdict) => (
            <option key={verdict} value={verdict}>
              {verdict} ({verdictCounts[verdict] ?? 0})
            </option>
          ))}
        </select>
      </div>

      {loading ? <LoadingState label="Loading validation state…" /> : null}
      {error ? <ErrorState title="Validation unavailable" message={error} onRetry={load} /> : null}

      {runs !== null && runs.length === 0 ? (
        <DashboardCard title="Validation">
          <EmptyState
            title="Nothing to validate yet"
            description="Validation is derived from persisted research evidence. Run research first."
            action={
              <Link href="/research" className="text-sm font-medium text-blue-700 hover:underline">
                Open Research Center →
              </Link>
            }
          />
        </DashboardCard>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {filtered.map((run) => {
          const verdict = conclusionDisplay(run);
          const tone = statusTone(verdict);
          return (
            <Card key={run.id}>
              <CardHeader
                title={
                  <Link href={`/opportunities/${run.opportunityId}`} className="text-sm font-semibold text-blue-700 hover:underline">
                    {run.opportunityTitle}
                  </Link>
                }
                subtitle={`Run ${run.id.slice(0, 12)} · ${formatRelativeTime(run.completedAt ?? run.startedAt)}`}
                action={<StatusBadge status={verdict} />}
              />
              <div className="space-y-3 p-5 text-sm">
                {run.validation ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      {SIGNAL_LABELS.map(({ key, label }) => (
                        <div key={key} className="rounded-md border border-slate-100 p-2 text-center">
                          <div className="text-xs text-slate-400">{label}</div>
                          <div className="mt-0.5">
                            <StatusBadge status={run.validation!.signals[key]} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>Evidence coverage: {run.validation.evidenceCoverage}</span>
                      <span>Source diversity: {run.validation.sourceDiversity}</span>
                      <span className={run.validation.contradictionCount > 0 ? "text-amber-600" : ""}>
                        Contradictions: {run.validation.contradictionCount}
                      </span>
                      <span>Confidence: {(run.validation.confidence * 100).toFixed(0)}%</span>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">
                    No persisted validation row for this run — evidence requirements were not met or the run is still in
                    progress. This is shown as {verdict}, never as a validated state.
                  </p>
                )}

                {run.conclusionBasis ? <p className="text-xs text-slate-600">Basis: {run.conclusionBasis}</p> : null}

                {run.errors.length > 0 ? (
                  <div className="rounded-md border border-red-100 bg-red-50 p-3">
                    <p className="text-xs font-semibold text-red-700">Refusal / error reasons</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-red-600">
                      {run.errors.slice(0, 5).map((reason, index) => (
                        <li key={index}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{run.evidenceCount} evidence row(s) backing this state</span>
                  <Link href={`/evidence?runId=${encodeURIComponent(run.id)}`} className="font-medium text-blue-700 hover:underline">
                    Inspect evidence →
                  </Link>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {runs !== null && runs.length > 0 && filtered.length === 0 ? (
        <EmptyState title={`No runs with verdict ${verdictFilter}`} description="Adjust the verdict filter to see other runs." />
      ) : null}
    </div>
  );
}
