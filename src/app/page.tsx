"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/http";
import type { Opportunity, Experiment, HandoffRecord } from "@/lib/types";
import { Card, CardHeader } from "@/components/ui";
import {
  DashboardCard,
  HealthCard,
  MetricCard,
  StatusBadge,
  statusTone,
} from "@/components/console";
import { SystemHealthPanel } from "@/components/SystemHealthPanel";
import { AgentRunCard } from "@/components/console";

/**
 * Operational dashboard (Phase 2).
 *
 * Every number comes from an existing owner-scoped read API; nothing is
 * computed differently from the backend and nothing is fabricated. When an
 * API is unavailable the card shows "Data unavailable" — never a zero that
 * could be mistaken for a real count.
 */

interface OperationsStatus {
  activeResearchRuns: number;
  failedResearchRuns: number;
  pendingHandoffs: number;
  waitingApprovals: number;
  failedExecutions: number;
  humanReviewItems: number;
  generatedAt: string;
}

interface RecentResearchRun {
  id: string;
  opportunityTitle: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  conclusion: string | null;
  evidenceCount: number;
}

interface RecentAgentRun {
  id: string;
  agentName: string;
  task: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  errors: string[];
}

interface DeliveryRow {
  idempotencyKey: string;
  status: string;
  lastErrorCode: string | null;
  duplicate: boolean;
}

const DATA_UNAVAILABLE = "Data unavailable";

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [ops, setOps] = useState<OperationsStatus | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[] | null>(null);
  const [experiments, setExperiments] = useState<Experiment[] | null>(null);
  const [handoffs, setHandoffs] = useState<HandoffRecord[] | null>(null);
  const [research, setResearch] = useState<RecentResearchRun[] | null>(null);
  const [agentRuns, setAgentRuns] = useState<RecentAgentRun[] | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRow[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const settled = await Promise.allSettled([
      apiGet<OperationsStatus>("/api/system/operations"),
      apiGet<Opportunity[]>("/api/opportunities"),
      apiGet<Experiment[]>("/api/experiments"),
      apiGet<HandoffRecord[]>("/api/handoffs"),
      apiGet<RecentResearchRun[]>("/api/research/recent?limit=10"),
      apiGet<RecentAgentRun[]>("/api/agent-runs?limit=5"),
      apiGet<DeliveryRow[]>("/api/handoffs/deliveries?limit=25"),
    ]);
    const [opsR, oppsR, expsR, handoffsR, researchR, runsR, deliveriesR] = settled;
    setOps(opsR.status === "fulfilled" ? opsR.value : null);
    setOpportunities(oppsR.status === "fulfilled" ? oppsR.value : null);
    setExperiments(expsR.status === "fulfilled" ? expsR.value : null);
    setHandoffs(handoffsR.status === "fulfilled" ? handoffsR.value : null);
    setResearch(researchR.status === "fulfilled" ? researchR.value : null);
    setAgentRuns(runsR.status === "fulfilled" ? runsR.value : null);
    setDeliveries(deliveriesR.status === "fulfilled" ? deliveriesR.value : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Counts are computed ONLY from successfully fetched, persisted rows.
  const persistedOpportunities = opportunities ?? [];
  const validatedCount = persistedOpportunities.filter((o) =>
    ["VALIDATED", "BUILDING", "PUBLISHED", "EARNING", "SCALING"].includes(o.status),
  ).length;
  const handoffList = handoffs ?? [];
  const handoffsAccepted = handoffList.filter((h) => h.status === "ACCEPTED").length;
  const handoffsRejected = handoffList.filter((h) => h.status === "REJECTED").length;
  const deliveryList = deliveries ?? [];
  const notConfiguredDelivery = deliveryList.find((row) => row.status === "NOT_CONFIGURED");
  const runningExperiments = (experiments ?? []).filter((e) =>
    ["ACTIVE", "RUNNING", "READY", "ITERATING"].includes(e.status),
  ).length;

  const transportStatus = notConfiguredDelivery
    ? "NOT_CONFIGURED"
    : deliveryList.some((row) => row.status === "DELIVERED")
      ? "HEALTHY"
      : deliveryList.length > 0
        ? "DEGRADED"
        : "UNKNOWN";

  const metrics: Array<{ label: string; value: string | null; hint: string; href: string }> = [
    {
      label: "Research runs (recent)",
      value: research ? String(research.length) : null,
      hint: ops ? `${ops.activeResearchRuns} active · ${ops.failedResearchRuns} failed` : "Owner-scoped persisted runs",
      href: "/research",
    },
    {
      label: "Opportunities discovered",
      value: opportunities ? String(persistedOpportunities.length) : null,
      hint: "Persisted opportunities",
      href: "/opportunities",
    },
    {
      label: "Opportunities validated",
      value: opportunities ? String(validatedCount) : null,
      hint: "VALIDATED or further along the lifecycle",
      href: "/validation",
    },
    {
      label: "Ready for handoff",
      value: ops ? String(ops.pendingHandoffs) : null,
      hint: "DRAFT / HANDOFF_READY handoffs",
      href: "/handoffs",
    },
    {
      label: "Handoffs accepted",
      value: handoffs ? String(handoffsAccepted) : null,
      hint: "Human-accepted handoffs",
      href: "/handoffs",
    },
    {
      label: "Handoffs rejected",
      value: handoffs ? String(handoffsRejected) : null,
      hint: "Human-rejected handoffs",
      href: "/handoffs",
    },
    {
      label: "Experiments running",
      value: experiments ? String(runningExperiments) : null,
      hint: "ACTIVE / RUNNING / READY / ITERATING",
      href: "/experiments",
    },
    {
      label: "Agent runs (recent)",
      value: agentRuns ? String(agentRuns.length) : null,
      hint: ops ? `${ops.failedExecutions} failed executions` : "Persisted execution records",
      href: "/agent-runs",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Operations</h1>
          <p className="text-sm text-slate-500">
            Owner-scoped operational view of the research → validation → handoff pipeline. Only persisted data is shown.
          </p>
        </div>
        {ops ? (
          <span className="text-xs text-slate-400">Snapshot {new Date(ops.generatedAt).toLocaleTimeString()}</span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} loading={loading} />
        ))}
      </div>

      <DashboardCard
        title="System health"
        subtitle="From the authenticated system-health endpoint. NOT_CONFIGURED is never reported as HEALTHY."
        action={
          <Link href="/health" className="text-xs font-medium text-blue-700 hover:underline">
            Open full health →
          </Link>
        }
      >
        <div className="p-5">
          <SystemHealthPanel />
        </div>
      </DashboardCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardCard title="Handoff transport" subtitle="AIAgent → AI Income Lab delivery, derived from persisted delivery rows.">
          <div className="space-y-3 p-5">
            <HealthCard
              name="AI Income Lab connectivity"
              status={deliveries ? transportStatus : DATA_UNAVAILABLE}
              message={
                notConfiguredDelivery
                  ? notConfiguredDelivery.lastErrorCode
                    ? `Last delivery was NOT_CONFIGURED (${notConfiguredDelivery.lastErrorCode}). Configure the handoff endpoint and credential, then deliver a handoff to verify.`
                    : "Last delivery was NOT_CONFIGURED. Configure the handoff endpoint and credential, then deliver a handoff to verify."
                  : deliveryList.length === 0
                    ? "No delivery attempts recorded yet. Transport state is UNKNOWN until a handoff delivery is attempted."
                    : "Delivery attempts have been recorded. See the Handoff Center for per-delivery outcomes."
              }
              detail={
                <Link href="/handoffs" className="mt-2 inline-block text-xs font-medium text-blue-700 hover:underline">
                  Open Handoff Center →
                </Link>
              }
            />
            <HealthCard
              name="Human review queue"
              status={ops ? (ops.humanReviewItems > 0 ? "DEGRADED" : "HEALTHY") : DATA_UNAVAILABLE}
              message={
                ops
                  ? `${ops.humanReviewItems} item(s) require human review · ${ops.waitingApprovals} agent task approval(s) waiting.`
                  : "Operational status unavailable."
              }
            />
          </div>
        </DashboardCard>

        <DashboardCard
          title="Recent agent runs"
          subtitle="Persisted execution records via the owner-scoped runs API."
          action={
            <Link href="/agent-runs" className="text-xs font-medium text-blue-700 hover:underline">
              All runs →
            </Link>
          }
        >
          <div className="space-y-2 p-5">
            {agentRuns && agentRuns.length > 0 ? (
              agentRuns.map((run) => <AgentRunCard key={run.id} run={run} />)
            ) : agentRuns ? (
              <p className="text-sm text-slate-500">No agent runs recorded yet. Runs appear here when the agent runtime records executions.</p>
            ) : (
              <p className="text-sm text-slate-500">{DATA_UNAVAILABLE}</p>
            )}
          </div>
        </DashboardCard>
      </div>

      <DashboardCard
        title="Recent research runs"
        subtitle="Latest owner-scoped research executions with evidence counts."
        action={
          <Link href="/research" className="text-xs font-medium text-blue-700 hover:underline">
            Research Center →
          </Link>
        }
      >
        <div className="divide-y divide-slate-100">
          {research && research.length > 0 ? (
            research.map((run) => (
              <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{run.opportunityTitle}</p>
                  <p className="text-xs text-slate-400">
                    {new Date(run.startedAt).toLocaleString()} · {run.evidenceCount} evidence ·{" "}
                    {run.conclusion ?? "no conclusion yet"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={run.status} />
                  {run.conclusion ? (
                    <span className={`text-xs font-medium ${statusTone(run.conclusion) === "danger" ? "text-red-700" : "text-slate-500"}`}>
                      {run.conclusion}
                    </span>
                  ) : null}
                </div>
              </div>
            ))
          ) : research ? (
            <div className="px-5 py-6 text-sm text-slate-500">
              No persisted research runs yet. Start one from the{" "}
              <Link href="/research" className="text-blue-700 hover:underline">
                Research Center
              </Link>
              .
            </div>
          ) : (
            <div className="px-5 py-6 text-sm text-slate-500">{DATA_UNAVAILABLE}</div>
          )}
        </div>
      </DashboardCard>

      <Card>
        <CardHeader
          title="Where to operate next"
          subtitle="Quick paths into the console sections."
        />
        <div className="grid gap-2 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { href: "/research", label: "Research Center", hint: "Runs, providers, evidence" },
            { href: "/handoffs", label: "Handoff Center", hint: "Delivery lifecycle + audit" },
            { href: "/providers", label: "Providers", hint: "Configuration and health" },
            { href: "/audit-logs", label: "Audit Logs", hint: "Persisted operational events" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg border border-slate-200 p-3 transition-colors hover:border-blue-300 hover:bg-blue-50/40"
            >
              <div className="text-sm font-semibold text-slate-800">{item.label}</div>
              <div className="mt-0.5 text-xs text-slate-500">{item.hint}</div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
