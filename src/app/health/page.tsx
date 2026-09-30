"use client";

/**
 * System Health page (Phase 12).
 *
 * Composes the EXISTING authenticated health surfaces into one console view:
 *   - /api/system/health (component checks + provider states)
 *   - /api/system/operations (persisted operational counters)
 *   - /api/handoffs/deliveries (handoff transport state, persisted)
 *   - /api/integrations (provider registry)
 *
 * States map to HEALTHY / DEGRADED / NOT_CONFIGURED / FAILED / UNKNOWN.
 * NOT_CONFIGURED is never converted into HEALTHY — unconfigured components
 * stay explicitly unconfigured.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/http";
import { Card, CardHeader } from "@/components/ui";
import { DashboardCard, HealthCard, LoadingState, ErrorState, StatusBadge, StatusDot } from "@/components/console";

interface HealthCheck {
  component: string;
  status: string;
  message: string;
  dataClass: string;
}

interface HealthResponse {
  status: string;
  checks: HealthCheck[];
  criticalFailures: string[];
  warnings: string[];
  degradedComponents: string[];
  healthyComponents: string[];
  generatedAt: string;
}

interface OperationsStatus {
  activeResearchRuns: number;
  failedResearchRuns: number;
  pendingHandoffs: number;
  failedExecutions: number;
  generatedAt: string;
}

interface ProviderState {
  provider: string;
  status: string;
  configured: boolean;
  healthCheckRequired: boolean;
  safeReason: string;
}

interface DeliveryRow {
  idempotencyKey: string;
  status: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  updatedAt: string;
}

const COMPONENT_LABELS: Record<string, string> = {
  DATABASE: "Database",
  AUTHENTICATION: "Authentication",
  RESEARCH: "Research engine",
  EVIDENCE_VALIDATION: "Evidence validation",
  OPPORTUNITY_VALIDATION: "Opportunity validation",
  READINESS: "Readiness",
  EXPERIMENT_READINESS: "Experiment readiness",
  DECISION_ENGINE: "Decision engine",
  PORTFOLIO_INTELLIGENCE: "Portfolio intelligence",
  LEARNING_PIPELINE: "Learning pipeline",
  EXPERIMENT_METRICS: "Experiment metrics",
  HANDOFF: "Handoff pipeline",
  EXECUTION: "Execution",
  AGENT_RUNTIME: "Agent runtime",
  PORTFOLIO_OPERATIONS: "Portfolio operations",
  INTEGRATION_REGISTRY: "Providers",
};

const DATA_UNAVAILABLE = "Data unavailable";

export default function SystemHealthPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [ops, setOps] = useState<OperationsStatus | null>(null);
  const [providers, setProviders] = useState<ProviderState[] | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      apiGet<HealthResponse>("/api/system/health"),
      apiGet<OperationsStatus>("/api/system/operations"),
      apiGet<{ integrations: Array<{ id: string; provider: string; status: string; configured: boolean; healthCheckRequired: boolean; safeReason: string }> }>("/api/integrations"),
      apiGet<DeliveryRow[]>("/api/handoffs/deliveries?limit=25"),
    ]);
    setHealth(results[0].status === "fulfilled" ? results[0].value : null);
    setHealthError(
      results[0].status === "rejected"
        ? results[0].reason instanceof Error
          ? (results[0].reason as Error).message
          : "Health endpoint unavailable"
        : null,
    );
    setOps(results[1].status === "fulfilled" ? results[1].value : null);
    setProviders(results[2].status === "fulfilled" ? results[2].value.integrations : null);
    setDeliveries(results[3].status === "fulfilled" ? results[3].value : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const transportStatus = deliveries
    ? deliveries.some((row) => row.status === "DELIVERED")
      ? "HEALTHY"
      : deliveries.some((row) => row.status === "NOT_CONFIGURED")
        ? "NOT_CONFIGURED"
        : deliveries.length > 0
          ? "DEGRADED"
          : "UNKNOWN"
    : DATA_UNAVAILABLE;

  const lastDelivery = deliveries?.[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">System Health</h1>
          <p className="text-sm text-slate-500">
            Authenticated, owner-scoped health snapshot. States are the backend&rsquo;s own: HEALTHY, DEGRADED, NOT_CONFIGURED,
            FAILED, UNKNOWN — never upgraded to look better than they are.
          </p>
        </div>
        <StatusBadge status={health?.status ?? DATA_UNAVAILABLE} />
      </div>

      {loading && !health ? <LoadingState label="Loading health snapshot…" /> : null}
      {healthError ? <ErrorState title="Health snapshot unavailable" message={healthError} onRetry={load} /> : null}

      {health ? (
        <DashboardCard
          title="Components"
          subtitle={`Snapshot ${new Date(health.generatedAt).toLocaleString()}`}
          action={
            <Link href="/platform" className="text-xs font-medium text-blue-700 hover:underline">
              Platform integration →
            </Link>
          }
        >
          <div className="grid gap-2 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {health.checks.map((check) => (
              <HealthCard
                key={check.component}
                name={COMPONENT_LABELS[check.component] ?? check.component}
                status={check.status}
                message={check.message}
              />
            ))}
          </div>
        </DashboardCard>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardCard
          title="Handoff transport → AI Income Lab"
          subtitle="Derived from persisted delivery audit rows."
          action={
            <Link href="/handoffs" className="text-xs font-medium text-blue-700 hover:underline">
              Handoff Center →
            </Link>
          }
        >
          <div className="space-y-3 p-5">
            <HealthCard
              name="AI Income Lab connectivity"
              status={transportStatus}
              message={
                lastDelivery
                  ? `Last delivery ${lastDelivery.status}${lastDelivery.lastErrorCode ? ` (${lastDelivery.lastErrorCode})` : ""} at ${new Date(lastDelivery.updatedAt).toLocaleString()}.`
                  : "No delivery attempts recorded — transport state is UNKNOWN until a handoff delivery is attempted."
              }
            />
            {ops ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-slate-400">Pending handoffs</div>
                  <div className="text-lg font-semibold tabular-nums">{ops.pendingHandoffs}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-slate-400">Failed executions</div>
                  <div className="text-lg font-semibold tabular-nums">{ops.failedExecutions}</div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">{DATA_UNAVAILABLE} (operational counters)</p>
            )}
          </div>
        </DashboardCard>

        <DashboardCard
          title="Providers"
          subtitle="Configuration is not health. Unverified providers stay unverified."
          action={
            <Link href="/providers" className="text-xs font-medium text-blue-700 hover:underline">
              Provider console →
            </Link>
          }
        >
          <div className="space-y-2 p-5">
            {providers === null ? (
              <p className="text-sm text-slate-500">{DATA_UNAVAILABLE}</p>
            ) : providers.length === 0 ? (
              <p className="text-sm text-slate-500">No provider adapters registered.</p>
            ) : (
              providers.map((provider) => (
                <div key={provider.provider} className="flex items-center justify-between gap-2 rounded-md border p-2.5">
                  <StatusDot status={provider.status} label={provider.provider} />
                  <StatusBadge status={provider.status} />
                </div>
              ))
            )}
          </div>
        </DashboardCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Warnings" subtitle="From the health engine." />
          <ul className="list-disc space-y-1 p-5 pl-9 text-sm text-slate-600">
            {(health?.warnings ?? []).length > 0 ? (
              health!.warnings.map((warning) => <li key={warning}>{warning}</li>)
            ) : (
              <li>{health ? "None reported." : DATA_UNAVAILABLE}</li>
            )}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Critical issues" subtitle="Blocking problems reported by the health engine." />
          <ul className="list-disc space-y-1 p-5 pl-9 text-sm text-slate-600">
            {(health?.criticalFailures ?? []).length > 0 ? (
              health!.criticalFailures.map((failure) => <li key={failure} className="text-red-700">{failure}</li>)
            ) : (
              <li>{health ? "None reported." : DATA_UNAVAILABLE}</li>
            )}
          </ul>
        </Card>
      </div>
    </div>
  );
}
