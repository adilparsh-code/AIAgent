"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/http";
import { Card, CardHeader } from "@/components/ui";

interface IntegrationSummary {
  name: string;
  type: string;
  description: string;
  status: string;
  capabilities: string[];
  environment: string;
  requiredEnvVars: string[];
  presentEnvVars: string[];
  missingEnvVars: string[];
  lastCheckedAt: string | null;
  lastError: string | null;
  isScaffold: boolean;
}

const STATUS_META: Record<string, { label: string; dot: string; chip: string }> = {
  HEALTHY: { label: "Healthy", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CONFIGURED: { label: "Configured (not verified)", dot: "bg-sky-500", chip: "bg-sky-50 text-sky-700 border-sky-200" },
  DEGRADED: { label: "Degraded", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700 border-amber-200" },
  NOT_CONFIGURED: { label: "Not configured", dot: "bg-slate-400", chip: "bg-slate-100 text-slate-600 border-slate-200" },
  AUTH_FAILED: { label: "Auth failed", dot: "bg-red-500", chip: "bg-red-50 text-red-700 border-red-200" },
  FAILED: { label: "Failed", dot: "bg-red-500", chip: "bg-red-50 text-red-700 border-red-200" },
  DISABLED: { label: "Disabled", dot: "bg-slate-400", chip: "bg-slate-100 text-slate-600 border-slate-200" },
};

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ integrations: IntegrationSummary[] }>("/api/integrations");
      setIntegrations(data.integrations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runHealthCheck(name: string) {
    setChecking(name);
    try {
      const data = await apiSend<{ integration: IntegrationSummary }>(`/api/integrations/${name}/health`, "POST");
      setIntegrations((current) => current.map((item) => (item.name === name ? data.integration : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Health check failed");
    } finally {
      setChecking(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Integrations</h1>
        <p className="mt-1 text-sm text-slate-600">
          Real external service connections. A provider shows Healthy only after a real
          health/authentication check succeeds — never merely because a key exists. Secret values
          never leave the server; only variable names are shown.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {integrations.map((integration) => {
            const meta = STATUS_META[integration.status] ?? STATUS_META.FAILED;
            return (
              <Card key={integration.name}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${meta.dot}`} aria-hidden />
                      <Link href={`/integrations/${integration.name}`} className="hover:underline">
                        {integration.name}
                      </Link>
                      {integration.isScaffold && (
                        <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                          scaffold
                        </span>
                      )}
                    </span>
                  }
                  subtitle={integration.type}
                  action={
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.chip}`}>
                      {meta.label}
                    </span>
                  }
                />
                <div className="space-y-3 px-5 py-4">
                  <p className="text-sm text-slate-600">{integration.description}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {integration.capabilities.map((capability) => (
                      <span
                        key={capability}
                        className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600"
                      >
                        {capability}
                      </span>
                    ))}
                  </div>
                  {integration.missingEnvVars.length > 0 ? (
                    <p className="text-xs text-slate-500">
                      Requires:{" "}
                      {integration.missingEnvVars.map((name) => (
                        <code key={name} className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">
                          {name}
                        </code>
                      ))}{" "}
                      (server-side only)
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Environment: {integration.environment}
                      {integration.lastCheckedAt
                        ? ` · last check ${new Date(integration.lastCheckedAt).toLocaleString()}`
                        : " · not health-checked yet"}
                    </p>
                  )}
                  {integration.lastError && (
                    <p className="text-xs text-red-600">Last error: {integration.lastError}</p>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void runHealthCheck(integration.name)}
                      disabled={checking === integration.name}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {checking === integration.name ? "Checking…" : "Run health check"}
                    </button>
                    <Link
                      href={`/integrations/${integration.name}`}
                      className="text-xs font-medium text-blue-600 hover:underline"
                    >
                      Details →
                    </Link>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
