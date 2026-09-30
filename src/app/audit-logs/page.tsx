"use client";

/**
 * Audit Logs (Phase 11).
 *
 * Queryable, owner-scoped operational audit feed from
 * /api/system/audit-events — persisted handoff deliveries, terminal research
 * runs, and handoff transitions. The endpoint returns only sanitized, safe
 * diagnostic content; no secrets, tokens or payloads are rendered. The feed
 * states its own coverage honestly instead of pretending to be complete.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/http";
import { Button, Card, CardHeader } from "@/components/ui";
import { DataTable, EmptyState, StatusBadge, type DataTableColumn } from "@/components/console";
import { formatRelativeTime } from "@/lib/format";

interface AuditEvent {
  id: string;
  timestamp: string;
  source: string;
  action: string;
  entity: string;
  entityLabel: string;
  opportunityId: string | null;
  status: string;
  detail: string | null;
}

interface AuditResponse {
  coverage: string;
  generatedAt: string;
  events: AuditEvent[];
}

export default function AuditLogsPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiGet<AuditResponse>("/api/system/audit-events?limit=150"));
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Audit events unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sources = useMemo(() => {
    const set = new Set((data?.events ?? []).map((event) => event.source));
    return ["ALL", ...Array.from(set).sort()];
  }, [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.events ?? []).filter((event) => {
      if (sourceFilter !== "ALL" && event.source !== sourceFilter) return false;
      if (!q) return true;
      return `${event.action} ${event.entityLabel} ${event.status} ${event.detail ?? ""}`.toLowerCase().includes(q);
    });
  }, [data, sourceFilter, query]);

  const columns: Array<DataTableColumn<AuditEvent>> = [
    {
      key: "timestamp",
      header: "Timestamp",
      render: (event) => (
        <span className="whitespace-nowrap text-xs text-slate-500" title={new Date(event.timestamp).toLocaleString()}>
          {formatRelativeTime(event.timestamp)}
        </span>
      ),
    },
    { key: "source", header: "Source", render: (event) => <span className="text-xs text-slate-500">{event.source}</span> },
    { key: "action", header: "Action", render: (event) => <span className="font-medium text-slate-700">{event.action}</span> },
    {
      key: "entity",
      header: "Entity",
      render: (event) => (
        <span className="block max-w-xs truncate text-xs text-slate-600" title={event.entityLabel}>
          {event.entity}: {event.entityLabel}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (event) => <StatusBadge status={event.status} /> },
    {
      key: "detail",
      header: "Detail (safe)",
      render: (event) =>
        event.detail ? (
          <span className="block max-w-md truncate text-xs text-slate-500" title={event.detail}>
            {event.detail}
          </span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        ),
    },
    {
      key: "link",
      header: "",
      render: (event) =>
        event.opportunityId ? (
          <Link href={`/opportunities/${event.opportunityId}`} className="text-xs font-medium text-blue-700 hover:underline">
            Open →
          </Link>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Audit Logs</h1>
          <p className="text-sm text-slate-500">Persisted operational events for your account, newest first.</p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      <Card>
        <CardHeader
          title="Coverage"
          subtitle={data?.coverage ?? "Coverage description appears with the feed."}
        />
        <div className="flex flex-wrap items-center gap-2 p-5">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search action, entity, status, detail…"
            className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm"
            aria-label="Search audit events"
          />
          <select
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
            className="rounded-md border border-slate-200 bg-white px-2 py-2 text-xs"
            aria-label="Filter by source"
          >
            {sources.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(event) => event.id}
          loading={loading}
          error={error}
          onRetry={load}
          empty={
            <EmptyState
              title="No audit events recorded"
              description="Persisted delivery attempts, terminal research runs, and handoff transitions appear here."
            />
          }
          mobileCard={(event) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-700">{event.action}</span>
                <StatusBadge status={event.status} />
              </div>
              <p className="text-xs text-slate-500">
                {event.source} · {formatRelativeTime(event.timestamp)}
              </p>
              {event.detail ? <p className="text-xs text-slate-500">{event.detail}</p> : null}
            </div>
          )}
        />
      </Card>

      <Card>
        <CardHeader title="What is intentionally absent" subtitle="No secrets, no fabricated completeness." />
        <p className="p-5 text-xs text-slate-500">
          Security-event and operational log streams are sanitized and written to the server log sink; a queryable
          database audit trail for them does not exist yet, so they are not shown here. Credentials, tokens and
          connection strings are redacted at the logging layer and never enter this feed.
        </p>
      </Card>
    </div>
  );
}
