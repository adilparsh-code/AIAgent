"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiGet, apiSend } from "@/lib/http";
import { Card, CardHeader, dataClassBadgeClass, dataClassLabel } from "@/components/ui";

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

interface IntegrationExecution {
  id: string;
  action: string;
  status: string;
  externalId: string | null;
  dataClass: string;
  durationMs: number;
  error: string | null;
  outputSummary: string | null;
  taskId: string | null;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  HEALTHY: "Healthy",
  CONFIGURED: "Configured (not verified)",
  DEGRADED: "Degraded",
  NOT_CONFIGURED: "Not configured",
  AUTH_FAILED: "Auth failed",
  FAILED: "Failed",
  DISABLED: "Disabled",
};

interface TestActionDescriptor {
  integration: string;
  action: string;
  capability: string;
  taskType: string;
  label: string;
  objective: string;
}

interface TestExecutionResult {
  integration: string;
  action: string;
  status: string;
  executionId: string | null;
  taskId: string;
  artifactId: string | null;
  dataClass: string | null;
  durationMs: number | null;
  error: string | null;
  outputExcerpt: string | null;
  message: string;
  configured: boolean;
  integrationStatus: string;
  missingEnvVars: string[];
}

const STATUS_DOT: Record<string, string> = {
  HEALTHY: "bg-emerald-500",
  CONFIGURED: "bg-sky-500",
  DEGRADED: "bg-amber-500",
  NOT_CONFIGURED: "bg-slate-400",
  AUTH_FAILED: "bg-red-500",
  FAILED: "bg-red-500",
  DISABLED: "bg-slate-400",
};

export default function IntegrationDetailPage() {
  const params = useParams<{ id: string }>();
  const name = params?.id;
  const [integration, setIntegration] = useState<IntegrationSummary | null>(null);
  const [executions, setExecutions] = useState<IntegrationExecution[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [testActions, setTestActions] = useState<TestActionDescriptor[]>([]);
  const [selectedAction, setSelectedAction] = useState<string>("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestExecutionResult | null>(null);

  const load = useCallback(async () => {
    if (!name) return;
    try {
      const data = await apiGet<{ integration: IntegrationSummary }>(`/api/integrations/${name}`);
      setIntegration(data.integration);
      const exec = await apiGet<{ executions: IntegrationExecution[] }>(`/api/integrations/${name}/executions`);
      setExecutions(exec.executions);
      const actions = await apiGet<{ actions: TestActionDescriptor[] }>(`/api/integrations/${name}/test-execution`);
      setTestActions(actions.actions);
      setSelectedAction((current) => current || (actions.actions[0]?.action ?? ""));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load integration";
      if (/not found/i.test(message)) setNotFound(true);
      else setError(message);
    }
  }, [name]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runHealthCheck() {
    if (!name) return;
    setChecking(true);
    setError(null);
    try {
      const data = await apiSend<{ integration: IntegrationSummary }>(`/api/integrations/${name}/health`, "POST");
      setIntegration(data.integration);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Health check failed");
    } finally {
      setChecking(false);
    }
  }

  async function runTestExecution() {
    if (!name) return;
    setTesting(true);
    setError(null);
    try {
      const requestId = `detail_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.slice(0, 64);
      const data = await apiSend<TestExecutionResult>(`/api/integrations/${name}/test-execution`, "POST", {
        action: selectedAction || undefined,
        requestId,
      });
      setTestResult(data);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test execution failed");
    } finally {
      setTesting(false);
    }
  }

  if (notFound) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Integration not found. <Link href="/integrations" className="text-blue-600 hover:underline">Back to integrations</Link>
      </div>
    );
  }
  if (!integration) {
    return <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">{error ?? "Loading…"}</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/integrations" className="text-xs text-slate-500 hover:text-slate-700">← Integrations</Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold text-slate-900">
          <span className={`inline-block h-3 w-3 rounded-full ${STATUS_DOT[integration.status] ?? "bg-slate-400"}`} aria-hidden />
          {integration.name}
          {integration.isScaffold && (
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-slate-500">
              scaffold
            </span>
          )}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{integration.description}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Status" subtitle={STATUS_LABELS[integration.status] ?? integration.status} />
          <div className="space-y-2 px-5 py-4 text-sm text-slate-600">
            <p>Type: <span className="font-medium text-slate-800">{integration.type}</span></p>
            <p>Environment: <span className="font-medium text-slate-800">{integration.environment}</span></p>
            <p>
              Last health check:{" "}
              <span className="font-medium text-slate-800">
                {integration.lastCheckedAt ? new Date(integration.lastCheckedAt).toLocaleString() : "never"}
              </span>
            </p>
            {integration.lastError && <p className="text-red-600">Last error: {integration.lastError}</p>}
            <button
              type="button"
              onClick={() => void runHealthCheck()}
              disabled={checking}
              className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {checking ? "Running…" : "Run health check"}
            </button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Configuration" subtitle="Variable names only — values stay server-side" />
          <div className="space-y-2 px-5 py-4 text-sm text-slate-600">
            {integration.requiredEnvVars.length === 0 ? (
              <p>No credentials required.</p>
            ) : (
              <ul className="space-y-1">
                {integration.requiredEnvVars.map((envVar) => (
                  <li key={envVar} className="flex items-center gap-2">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{envVar}</code>
                    {integration.presentEnvVars.includes(envVar) ? (
                      <span className="text-xs font-medium text-emerald-600">configured</span>
                    ) : (
                      <span className="text-xs font-medium text-slate-500">missing</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {integration.capabilities.map((capability) => (
                <span key={capability} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                  {capability}
                </span>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Test execution"
          subtitle="Runs one real, allowlisted, zero-cost action with strict time/output limits"
        />
        <div className="space-y-3 px-5 py-4">
          {testActions.length === 0 ? (
            <p className="text-sm text-slate-500">
              No safe test action is available for this integration.
              {integration.isScaffold
                ? " This is a scaffold — it has no real API integration yet, so no execution can succeed honestly."
                : " Configure the provider first; scaffold and approval-class actions can never be tested."}
            </p>
          ) : (
            <>
              <label className="block text-sm text-slate-600">
                Action
                <select
                  value={selectedAction}
                  onChange={(event) => setSelectedAction(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                >
                  {testActions.map((descriptor) => (
                    <option key={descriptor.action} value={descriptor.action}>
                      {descriptor.label} ({descriptor.action} · {descriptor.capability})
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-slate-500">
                The objective is a fixed deterministic probe — client input never becomes a provider
                instruction. Publishing, messaging, campaigns, uploads and spending are never testable.
              </p>
              <button
                type="button"
                onClick={() => void runTestExecution()}
                disabled={testing}
                className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
              >
                {testing ? "Running test execution…" : "Run test execution"}
              </button>
            </>
          )}

          {testResult && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Result: {testResult.status}</span>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${dataClassBadgeClass(testResult.dataClass)}`}
                >
                  {dataClassLabel(testResult.dataClass)}
                </span>
                {testResult.durationMs !== null && (
                  <span className="text-xs text-slate-500">{testResult.durationMs} ms</span>
                )}
                <span className="text-xs text-slate-500">{testResult.integrationStatus}</span>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {testResult.integration} · {testResult.action}
                {testResult.executionId ? ` · execution ${testResult.executionId}` : ""}
                {testResult.taskId ? ` · task ${testResult.taskId}` : ""}
                {testResult.artifactId ? ` · artifact ${testResult.artifactId}` : ""}
              </p>
              {testResult.missingEnvVars.length > 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  Missing configuration: {testResult.missingEnvVars.join(", ")} (names only)
                </p>
              )}
              {testResult.error && <p className="mt-1 text-xs text-red-600">{testResult.error}</p>}
              {testResult.outputExcerpt && (
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-xs text-slate-700">
                  {testResult.outputExcerpt}
                </pre>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Recent executions" subtitle="Your tenant's external actions through this integration" />
        <div className="px-5 py-4">
          {executions.length === 0 ? (
            <p className="text-sm text-slate-500">No executions recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-4">When</th>
                    <th className="py-2 pr-4">Action</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Data class</th>
                    <th className="py-2 pr-4">Duration</th>
                    <th className="py-2 pr-4">Task</th>
                    <th className="py-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((execution) => (
                    <tr key={execution.id} className="border-b border-slate-50">
                      <td className="py-2 pr-4 text-slate-600">{new Date(execution.createdAt).toLocaleString()}</td>
                      <td className="py-2 pr-4 font-medium text-slate-800">{execution.action}</td>
                      <td className="py-2 pr-4 text-slate-600">{execution.status}</td>
                      <td className="py-2 pr-4">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${dataClassBadgeClass(execution.dataClass)}`}
                        >
                          {dataClassLabel(execution.dataClass)}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-slate-600">{execution.durationMs} ms</td>
                      <td className="py-2 pr-4 font-mono text-[11px] text-slate-500">{execution.taskId ?? "—"}</td>
                      <td className="py-2 text-red-600">{execution.error ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
