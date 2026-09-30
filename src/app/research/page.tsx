"use client";

/**
 * Research Center (Phase 3).
 *
 * Lists persisted research runs from the owner-scoped recent-runs API and
 * offers a "Start Research" action that goes through the EXISTING
 * authenticated `POST /api/research` endpoint. The UI never re-implements the
 * research engine — providers, evidence normalization and validation remain
 * backend-owned.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/http";
import { Button, Card, CardHeader } from "@/components/ui";
import {
  ConfirmButton,
  DashboardCard,
  DataTable,
  EmptyState,
  ErrorState,
  StatusBadge,
  type DataTableColumn,
} from "@/components/console";
import { formatRelativeTime } from "@/lib/format";

interface RecentRun {
  id: string;
  opportunityId: string;
  opportunityTitle: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  confidence: number | null;
  conclusion: string | null;
  providersAttempted: string[];
  providersSucceeded: string[];
  errors: string[];
  evidenceCount: number;
  sourceCount: number;
  queryCount: number;
}

interface OpportunityLite {
  id: string;
  title: string;
  status: string;
}

export default function ResearchPage() {
  const [runs, setRuns] = useState<RecentRun[] | null>(null);
  const [opportunities, setOpportunities] = useState<OpportunityLite[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedOpportunityId, setSelectedOpportunityId] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [runsR, oppsR] = await Promise.allSettled([
      apiGet<RecentRun[]>("/api/research/recent?limit=50"),
      apiGet<OpportunityLite[]>("/api/opportunities"),
    ]);
    setRuns(runsR.status === "fulfilled" ? runsR.value : null);
    setOpportunities(oppsR.status === "fulfilled" ? oppsR.value : null);
    if (runsR.status === "rejected") {
      setError(runsR.reason instanceof Error ? runsR.reason.message : "Research history unavailable");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startResearch = useCallback(async () => {
    if (!selectedOpportunityId) return;
    const opportunity = (opportunities ?? []).find((o) => o.id === selectedOpportunityId);
    if (!opportunity) return;
    setStarting(true);
    setStartError(null);
    try {
      // Existing authenticated research endpoint — same path the opportunity
      // page uses. The backend owns providers, evidence, and persistence.
      const response = await apiSend<unknown>("/api/research", "POST", {
        opportunityId: opportunity.id,
        title: opportunity.title,
      });
      void response;
      setSelectedOpportunityId("");
      await load();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Research run failed");
    } finally {
      setStarting(false);
    }
  }, [selectedOpportunityId, opportunities, load]);

  const statuses = useMemo(() => {
    const set = new Set((runs ?? []).map((run) => run.status));
    return ["ALL", ...Array.from(set).sort()];
  }, [runs]);

  const filtered = useMemo(
    () => (runs ?? []).filter((run) => statusFilter === "ALL" || run.status === statusFilter),
    [runs, statusFilter],
  );

  const columns: Array<DataTableColumn<RecentRun>> = [
    {
      key: "opportunity",
      header: "Opportunity",
      render: (run) => (
        <Link href={`/opportunities/${run.opportunityId}`} className="font-medium text-blue-700 hover:underline">
          {run.opportunityTitle}
        </Link>
      ),
    },
    { key: "status", header: "Status", render: (run) => <StatusBadge status={run.status} /> },
    {
      key: "conclusion",
      header: "Conclusion",
      render: (run) => (run.conclusion ? <span className="text-xs text-slate-600">{run.conclusion}</span> : <span className="text-xs text-slate-400">—</span>),
    },
    {
      key: "providers",
      header: "Providers",
      render: (run) => (
        <span className="text-xs text-slate-500">
          {run.providersSucceeded.length}/{run.providersAttempted.length} succeeded
        </span>
      ),
    },
    { key: "evidence", header: "Evidence", render: (run) => <span className="tabular-nums text-slate-700">{run.evidenceCount}</span> },
    {
      key: "started",
      header: "Started",
      render: (run) => <span className="text-xs text-slate-500">{formatRelativeTime(run.startedAt)}</span>,
    },
    {
      key: "completed",
      header: "Completed",
      render: (run) => (
        <span className="text-xs text-slate-500">
          {run.completedAt ? formatRelativeTime(run.completedAt) : "—"}
        </span>
      ),
    },
    {
      key: "errors",
      header: "Errors",
      render: (run) =>
        run.errors.length > 0 ? (
          <span title={run.errors.join(" · ")} className="cursor-help text-xs text-red-600">
            {run.errors.length} recorded
          </span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        ),
    },
    {
      key: "trace",
      header: "Evidence trace",
      render: (run) => (
        <Link href={`/evidence?runId=${encodeURIComponent(run.id)}`} className="text-xs text-blue-700 hover:underline">
          View evidence
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Research Center</h1>
          <p className="text-sm text-slate-500">
            Persisted research runs across your opportunities. Execution, providers and validation stay in the backend engine.
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      <DashboardCard
        title="Start Research"
        subtitle="Runs the existing research orchestrator for one of your opportunities. Real providers; missing configuration is reported honestly."
      >
        <div className="space-y-3 p-5">
          {opportunities && opportunities.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedOpportunityId}
                onChange={(event) => setSelectedOpportunityId(event.target.value)}
                className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                aria-label="Opportunity to research"
              >
                <option value="">Select an opportunity…</option>
                {opportunities.map((opportunity) => (
                  <option key={opportunity.id} value={opportunity.id}>
                    {opportunity.title} ({opportunity.status})
                  </option>
                ))}
              </select>
              <ConfirmButton
                label="Start Research"
                confirmTitle="Run research now?"
                confirmDescription="Calls the research orchestrator with real providers. This can take up to a minute and persists a new run."
                confirmLabel="Run research"
                onConfirm={startResearch}
                disabled={!selectedOpportunityId || starting}
              />
            </div>
          ) : opportunities ? (
            <EmptyState
              title="No opportunities to research"
              description="Create an opportunity first — research runs are attached to opportunities."
              action={
                <Link href="/opportunities/new" className="text-sm font-medium text-blue-700 hover:underline">
                  Create opportunity →
                </Link>
              }
            />
          ) : (
            <p className="text-sm text-slate-500">Data unavailable</p>
          )}
          {starting ? <p className="text-xs text-slate-500">Research run in progress…</p> : null}
          {startError ? <ErrorState title="Research run failed" message={startError} onRetry={() => setStartError(null)} /> : null}
        </div>
      </DashboardCard>

      <DashboardCard
        title="Research runs"
        subtitle="Owner-scoped persisted runs, newest first."
        action={
          <div className="flex items-center gap-2">
            <label htmlFor="research-status-filter" className="text-xs text-slate-400">
              Status
            </label>
            <select
              id="research-status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
            >
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(run) => run.id}
          loading={loading}
          error={error}
          onRetry={load}
          empty={
            <EmptyState
              title="No research runs recorded"
              description="Persisted runs appear here after a research execution completes (or fails) — never invented."
            />
          }
          mobileCard={(run) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/opportunities/${run.opportunityId}`} className="text-sm font-medium text-blue-700">
                  {run.opportunityTitle}
                </Link>
                <StatusBadge status={run.status} />
              </div>
              <p className="text-xs text-slate-500">
                {run.evidenceCount} evidence · {run.providersSucceeded.length}/{run.providersAttempted.length} providers ·{" "}
                {formatRelativeTime(run.startedAt)}
              </p>
              {run.errors.length > 0 ? <p className="text-xs text-red-600">{run.errors[0]}</p> : null}
              <Link href={`/evidence?runId=${encodeURIComponent(run.id)}`} className="text-xs text-blue-700">
                Evidence →
              </Link>
            </div>
          )}
        />
      </DashboardCard>

      <Card>
        <CardHeader
          title="How to read this table"
          subtitle="Status and conclusion are backend decisions — the console never recomputes them."
        />
        <div className="grid gap-2 p-5 text-xs text-slate-500 sm:grid-cols-3">
          <p>
            <strong className="text-slate-700">FAILED / PARTIAL</strong> — provider failures are recorded, never hidden.
            A failed run is a real outcome, not a silent retry.
          </p>
          <p>
            <strong className="text-slate-700">Evidence count</strong> — deduplicated, hash-verified evidence rows persisted
            for that run.
          </p>
          <p>
            <strong className="text-slate-700">Errors</strong> — sanitized provider diagnostics stored with the run.
          </p>
        </div>
      </Card>
    </div>
  );
}
