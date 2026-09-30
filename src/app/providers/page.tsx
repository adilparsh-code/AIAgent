"use client";

/**
 * Providers (Phase 9).
 *
 * Provider health/status from the authenticated integrations registry. Only
 * backend-safe summaries are rendered: status, configuration state, and safe
 * reasons. Env-var NAMES may be shown; secret VALUES never leave the server
 * and are never requested by this page.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/http";
import { Button, Card, CardHeader } from "@/components/ui";
import {
  DataTable,
  EmptyState,
  HealthCard,
  LoadingState,
  StatusBadge,
  type DataTableColumn,
} from "@/components/console";

interface IntegrationSummary {
  id: string;
  provider: string;
  status: string;
  configured: boolean;
  healthCheckRequired: boolean;
  safeReason: string;
  /** Env var NAMES only, when the backend includes them. */
  requiredEnvVars?: string[];
}

export default function ProvidersPage() {
  const [integrations, setIntegrations] = useState<IntegrationSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ integrations: IntegrationSummary[] }>("/api/integrations");
      setIntegrations(data.integrations);
    } catch (err) {
      setIntegrations(null);
      setError(err instanceof Error ? err.message : "Provider registry unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runHealthCheck = useCallback(
    async (id: string) => {
      setChecking(id);
      setCheckMessage(null);
      try {
        // Real probe through the existing authenticated endpoint; the result
        // is persisted by the backend and shown honestly, whatever it is.
        await apiSendVoid(`/api/integrations/${encodeURIComponent(id)}/health`);
        setCheckMessage("Health check completed — the persisted result is shown below.");
        await load();
      } catch (err) {
        setCheckMessage(err instanceof Error ? err.message : "Health check failed");
      } finally {
        setChecking(null);
      }
    },
    [load],
  );

  const columns: Array<DataTableColumn<IntegrationSummary>> = [
    { key: "provider", header: "Provider", render: (row) => <span className="font-medium text-slate-800">{row.provider}</span> },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "configured",
      header: "Configured",
      render: (row) =>
        row.configured ? (
          <StatusBadge status="READY" label="YES" />
        ) : (
          <StatusBadge status="NOT_CONFIGURED" label="NO" />
        ),
    },
    {
      key: "reason",
      header: "Detail (safe)",
      render: (row) => <span className="block max-w-md text-xs text-slate-500">{row.safeReason}</span>,
    },
    {
      key: "health",
      header: "Health check",
      render: (row) =>
        row.healthCheckRequired ? (
          <Button variant="secondary" disabled={checking === row.id} onClick={() => runHealthCheck(row.id)}>
            {checking === row.id ? "Probing…" : "Run health check"}
          </Button>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        ),
    },
    {
      key: "open",
      header: "",
      render: (row) => (
        <Link href={`/integrations/${row.id}`} className="text-xs font-medium text-blue-700 hover:underline">
          Details →
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Providers</h1>
          <p className="text-sm text-slate-500">
            Provider configuration and health from the integration registry. Configuration is not health — unverified
            providers are shown as such, never as working.
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {error ? (
        <Card>
          <ErrorStateInline message={error} onRetry={load} />
        </Card>
      ) : null}
      {checkMessage ? (
        <Card className="border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{checkMessage}</Card>
      ) : null}

      {loading && integrations === null ? (
        <Card>
          <LoadingState label="Loading providers…" />
        </Card>
      ) : null}

      {integrations !== null ? (
        <Card>
          <CardHeader title="Registry" subtitle={`${integrations.length} provider adapter(s) registered.`} />
          {integrations.length === 0 ? (
            <EmptyState title="No providers registered" description="The integration registry is empty." />
          ) : (
            <DataTable
              columns={columns}
              rows={integrations}
              rowKey={(row) => row.id}
              empty={<EmptyState title="No providers registered" />}
              mobileCard={(row) => (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{row.provider}</span>
                    <StatusBadge status={row.status} />
                  </div>
                  <p className="text-xs text-slate-500">{row.safeReason}</p>
                  {row.healthCheckRequired ? (
                    <Button variant="secondary" disabled={checking === row.id} onClick={() => runHealthCheck(row.id)}>
                      {checking === row.id ? "Probing…" : "Run health check"}
                    </Button>
                  ) : null}
                </div>
              )}
            />
          )}
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(integrations ?? []).slice(0, 6).map((row) => (
          <HealthCard key={row.id} name={row.provider} status={row.status} message={row.safeReason} />
        ))}
      </div>

      <Card>
        <CardHeader title="Secret handling" subtitle="What this page will never show." />
        <p className="p-5 text-xs text-slate-500">
          API keys, tokens and credentials are read only inside server code and are never returned by the integrations
          API. This page renders status and safe diagnostic reasons only; env-var names (never values) may appear in
          setup guidance.
        </p>
      </Card>
    </div>
  );
}

async function apiSendVoid(url: string): Promise<void> {
  const response = await fetch(url, { method: "POST", cache: "no-store" });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: unknown };
    throw new Error(typeof data?.error === "string" ? data.error : `Request failed (${response.status})`);
  }
}

function ErrorStateInline({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 p-6 text-center">
      <p className="text-sm font-medium text-red-700">{message}</p>
      <Button variant="secondary" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
