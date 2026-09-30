"use client";

/**
 * Agent Runs (Phase 10).
 *
 * Owner-scoped execution records across all agents, from the read-only
 * /api/agent-runs endpoint. Sensitive run input/output payloads are
 * intentionally not exposed here — the per-agent surface already covers that.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/http";
import { Button, Card, CardHeader } from "@/components/ui";
import {
  AgentRunCard,
  DataTable,
  EmptyState,
  ErrorState,
  StatusBadge,
  type DataTableColumn,
} from "@/components/console";
import { formatRelativeTime } from "@/lib/format";

interface AgentRunRow {
  id: string;
  agentId: string;
  agentName: string;
  agentType: string;
  task: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  errors: string[];
}

export default function AgentRunsPage() {
  const [runs, setRuns] = useState<AgentRunRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRuns(await apiGet<AgentRunRow[]>("/api/agent-runs?limit=100"));
    } catch (err) {
      setRuns(null);
      setError(err instanceof Error ? err.message : "Agent runs unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const statuses = useMemo(() => {
    const set = new Set((runs ?? []).map((run) => run.status));
    return ["ALL", ...Array.from(set).sort()];
  }, [runs]);

  const filtered = useMemo(
    () => (runs ?? []).filter((run) => statusFilter === "ALL" || run.status === statusFilter),
    [runs, statusFilter],
  );

  const columns: Array<DataTableColumn<AgentRunRow>> = [
    { key: "agent", header: "Agent", render: (row) => <span className="font-medium text-slate-800">{row.agentName}</span> },
    {
      key: "runId",
      header: "Run ID",
      render: (row) => <span className="font-mono text-xs text-slate-400">{row.id.slice(0, 12)}…</span>,
    },
    {
      key: "task",
      header: "Task",
      render: (row) => <span className="block max-w-sm truncate text-xs text-slate-600" title={row.task}>{row.task}</span>,
    },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "started",
      header: "Started",
      render: (row) => <span className="text-xs text-slate-500">{formatRelativeTime(row.startedAt)}</span>,
    },
    {
      key: "duration",
      header: "Duration",
      render: (row) => {
        if (!row.completedAt) return <span className="text-xs text-sky-600">running…</span>;
        const ms = new Date(row.completedAt).getTime() - new Date(row.startedAt).getTime();
        return <span className="tabular-nums text-xs text-slate-600">{Number.isFinite(ms) && ms >= 0 ? `${(ms / 1000).toFixed(1)}s` : "—"}</span>;
      },
    },
    {
      key: "outcome",
      header: "Errors",
      render: (row) =>
        row.errors.length > 0 ? (
          <span className="block max-w-xs truncate text-xs text-red-600" title={row.errors.join(" · ")}>
            {row.errors.length} recorded
          </span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Agent Runs</h1>
          <p className="text-sm text-slate-500">
            Persisted execution records across your agents. Runtime payloads stay on the per-agent surfaces; this page
            shows the operational lifecycle.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
            aria-label="Filter by run status"
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader title="Execution records" subtitle="Newest first. Statuses are the runtime's own persisted verdicts." />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={load}
          empty={
            <EmptyState
              title="No agent runs recorded"
              description="Runs appear here when the agent runtime records executions for your account."
              action={
                <Link href="/agents" className="text-sm font-medium text-blue-700 hover:underline">
                  Open AI Agents →
                </Link>
              }
            />
          }
          mobileCard={(row) => (
            <AgentRunCard
              run={{
                id: row.id,
                agentName: row.agentName,
                task: row.task,
                status: row.status,
                startedAt: row.startedAt,
                completedAt: row.completedAt,
                errors: row.errors,
              }}
            />
          )}
        />
      </Card>
    </div>
  );
}
