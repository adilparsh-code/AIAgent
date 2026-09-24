"use client";

import { useEffect, useState } from "react";
import { agentRepository } from "@/lib/repositories";
import type { Agent, AgentRunRecord } from "@/lib/types";
import { Badge, Card, CardHeader, Button, statusBadgeClass } from "@/components/ui";
import { formatRelativeTime } from "@/lib/format";
import { SystemHealthPanel } from "@/components/SystemHealthPanel";
import { OperationalStatusPanel } from "@/components/OperationalStatusPanel";
import { LaunchReadinessPanel } from "@/components/LaunchReadinessPanel";

function runStatusBadgeClass(status: AgentRunRecord["status"]): string {
  switch (status) {
    case "COMPLETED":
      return "bg-emerald-100 text-emerald-800";
    case "FAILED":
      return "bg-red-100 text-red-800";
    case "CANCELLED":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-sky-100 text-sky-800";
  }
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);
  const [runs, setRuns] = useState<AgentRunRecord[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const data = await agentRepository.getAll();
      setAgents(data);
      setLoading(false);
    }
    load();
  }, []);

  const toggleRuns = async (agentId: string) => {
    if (openAgentId === agentId) {
      setOpenAgentId(null);
      setRuns([]);
      return;
    }
    setOpenAgentId(agentId);
    setRunsLoading(true);
    setRunsError(null);
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/runs?limit=20`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to load runs");
      }
      setRuns(Array.isArray(data?.runs) ? (data.runs as AgentRunRecord[]) : []);
    } catch (error) {
      setRunsError(error instanceof Error ? error.message : "Failed to load runs");
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">AI Agents</h1>
      <SystemHealthPanel />
      <OperationalStatusPanel />
      <LaunchReadinessPanel />
      <p className="text-sm text-slate-500">
        Architecture placeholders only. None are connected to live AI APIs. Persisted execution records
        (AgentRun) are shown per agent — recorded via the runs API, never invented.
      </p>
      {loading ? <p className="text-sm text-slate-500">Loading agents...</p> : null}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => (
          <Card key={a.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{a.name}</div>
              <Badge className={statusBadgeClass(a.status)}>{a.status}</Badge>
            </div>
            <p className="mt-2 text-sm text-slate-600">{a.description}</p>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-slate-500">PLANNED INTEGRATION</p>
              <Button variant="secondary" onClick={() => toggleRuns(a.id)}>
                {openAgentId === a.id ? "Hide runs" : "View runs"}
              </Button>
            </div>
            {openAgentId === a.id && (
              <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
                {runsLoading ? <p className="text-slate-500">Loading runs...</p> : null}
                {runsError ? <p className="text-red-700">{runsError}</p> : null}
                {!runsLoading && !runsError && runs.length === 0 ? (
                  <p className="text-slate-500">No persisted runs for this agent.</p>
                ) : null}
                {runs.length > 0 && (
                  <ul className="space-y-2">
                    {runs.map((run) => (
                      <li key={run.id} className="rounded-md border border-slate-100 p-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={runStatusBadgeClass(run.status)}>{run.status}</Badge>
                          <span className="text-xs text-slate-500">
                            {formatRelativeTime(run.startedAt)}
                            {run.completedAt ? ` → ${formatRelativeTime(run.completedAt)}` : ""}
                          </span>
                        </div>
                        <p className="mt-1 text-slate-700">{run.task}</p>
                        {run.errors.length > 0 && (
                          <p className="mt-1 text-xs text-red-700">{run.errors.join(" · ")}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
