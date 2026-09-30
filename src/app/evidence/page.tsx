"use client";

/**
 * Evidence explorer (Phase 8).
 *
 * Evidence stays traceable to its originating research run: pick a run, and
 * every persisted evidence row is shown with provider, data class, support /
 * contradiction, and a link back to the opportunity. Data comes from the
 * existing `GET /api/research?id=…` endpoint — no new backend.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/http";
import { Card, CardHeader } from "@/components/ui";
import { DashboardCard, EvidenceList, EmptyState, ErrorState, LoadingState, StatusBadge } from "@/components/console";
import { formatRelativeTime } from "@/lib/format";
import type { ResearchRun, Evidence } from "@/lib/research-types";

interface RecentRunLite {
  id: string;
  opportunityId: string;
  opportunityTitle: string;
  status: string;
  startedAt: string;
  evidenceCount: number;
}

export default function EvidencePage() {
  const [initialRunId, setInitialRunId] = useState("");

  // Deep-link support (?runId=…) read from the URL on mount. Read from
  // window.location rather than useSearchParams so the page can prerender
  // without a Suspense boundary.
  useEffect(() => {
    const runId = new URLSearchParams(window.location.search).get("runId");
    if (runId) setInitialRunId(runId);
  }, []);

  const [runs, setRuns] = useState<RecentRunLite[] | null>(null);
  const [selectedRunId, setSelectedRunId] = useState(initialRunId);
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiGet<RecentRunLite[]>("/api/research/recent?limit=50")
      .then((rows) => {
        if (!active) return;
        setRuns(rows);
        setSelectedRunId((current) => current || rows[0]?.id || "");
      })
      .catch(() => {
        if (active) setRuns(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (initialRunId) setSelectedRunId(initialRunId);
  }, [initialRunId]);

  const loadRun = useCallback(async (runId: string) => {
    if (!runId) return;
    setRunLoading(true);
    setRunError(null);
    try {
      setRun(await apiGet<ResearchRun>(`/api/research?id=${encodeURIComponent(runId)}`));
    } catch (err) {
      setRun(null);
      setRunError(err instanceof Error ? err.message : "Research run unavailable");
    } finally {
      setRunLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRun(selectedRunId);
  }, [selectedRunId, loadRun]);

  const evidence: Evidence[] = useMemo(() => run?.evidence ?? [], [run]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Evidence</h1>
        <p className="text-sm text-slate-500">
          Persisted evidence rows, traceable to their originating research run and opportunity. Deduplicated by content hash
          and URL — repeated sources never inflate confidence.
        </p>
      </div>

      <DashboardCard
        title="Select a research run"
        subtitle="Evidence belongs to a run; pick one to explore its raw material."
      >
        <div className="p-5">
          {runs === null ? (
            <LoadingState label="Loading runs…" />
          ) : runs.length === 0 ? (
            <EmptyState
              title="No research runs yet"
              description="Evidence appears once research has been executed against real providers."
              action={
                <Link href="/research" className="text-sm font-medium text-blue-700 hover:underline">
                  Open Research Center →
                </Link>
              }
            />
          ) : (
            <select
              value={selectedRunId}
              onChange={(event) => setSelectedRunId(event.target.value)}
              className="w-full max-w-xl rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              aria-label="Research run"
            >
              {runs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.opportunityTitle} — {item.status} — {formatRelativeTime(item.startedAt)} — {item.evidenceCount} evidence
                </option>
              ))}
            </select>
          )}
        </div>
      </DashboardCard>

      {runLoading ? <LoadingState label="Loading evidence…" /> : null}
      {runError ? <ErrorState title="Evidence unavailable" message={runError} onRetry={() => loadRun(selectedRunId)} /> : null}

      {run && !runLoading ? (
        <Card>
          <CardHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                Evidence for run <span className="font-mono text-xs text-slate-400">{run.id.slice(0, 12)}</span>
                <StatusBadge status={run.status} />
              </span>
            }
            subtitle={`${evidence.length} evidence row(s) · opportunity: ${run.opportunityId}`}
            action={
              <Link href={`/opportunities/${run.opportunityId}`} className="text-xs font-medium text-blue-700 hover:underline">
                Open opportunity →
              </Link>
            }
          />
          <EvidenceList
            items={evidence.map((item) => ({
              id: item.id,
              source: item.source,
              title: item.title,
              url: item.url,
              href: /^https?:\/\//.test(item.url) ? item.url : null,
              snippet: item.snippet,
              supports: item.supports,
              contradicts: item.contradicts,
              dataClass: item.dataClass,
              collectedAt: item.collectedAt,
            }))}
          />
        </Card>
      ) : null}
    </div>
  );
}
