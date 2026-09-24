"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/ui";

type Operations = { activeResearchRuns: number; failedResearchRuns: number; blockedOpportunities: number; validationGaps: number; experimentsRequiringRealData: number; pendingHandoffs: number; waitingApprovals: number; failedExecutions: number; retryableFailures: number; humanReviewItems: number; generatedAt: string };

export function OperationalStatusPanel() {
  const [data, setData] = useState<Operations | null>(null);
  useEffect(() => { let active = true; fetch("/api/system/operations").then(async (r) => { if (!r.ok) throw new Error("unavailable"); return r.json() as Promise<Operations>; }).then((value) => { if (active) setData(value); }).catch(() => undefined); return () => { active = false; }; }, []);
  if (!data) return null;
  const items: Array<[string, number, string]> = [["Active research", data.activeResearchRuns, "/opportunities"], ["Failed research", data.failedResearchRuns, "/opportunities"], ["Validation queue", data.validationGaps, "/opportunities"], ["Experiment queue", data.experimentsRequiringRealData, "/experiments"], ["Waiting approvals", data.waitingApprovals, "/agents"], ["Handoff queue", data.pendingHandoffs, "/handoffs"], ["Execution queue", data.failedExecutions, "/agents"], ["Failed executions", data.failedExecutions, "/agents"], ["Retryable failures", data.retryableFailures, "/agents"], ["Human review items", data.humanReviewItems, "/opportunities"]];
  return <Card><CardHeader title="OPERATIONAL STATUS" subtitle="Bounded owner-scoped queue summary. Counts are persisted state, not uptime or performance metrics." /><div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 lg:grid-cols-5">{items.map(([label, value, href]) => <Link key={label} href={href} className="rounded-md border p-3 transition hover:border-blue-300"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-lg font-semibold">{value}</div></Link>)}</div></Card>;
}
