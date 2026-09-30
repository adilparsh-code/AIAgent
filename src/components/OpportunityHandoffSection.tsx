"use client";

/**
 * Phase 4 — detail-page sections for one opportunity: Handoff (+ delivery
 * audit), Experiments, and Audit History.
 *
 * Read-only composition over existing owner-scoped APIs. All actions (accept,
 * reject, deliver) live in the Handoff Center; this section links there
 * instead of duplicating them. Business logic is not recomputed — every
 * status shown is the backend-persisted value.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/http";
import type { Experiment, HandoffRecord } from "@/lib/types";
import { Card, CardHeader } from "@/components/ui";
import { EmptyState, HandoffDeliveryStatus, StatusBadge } from "@/components/console";
import { formatRelativeTime } from "@/lib/format";

interface DeliveryAudit {
  idempotencyKey: string;
  status: string;
  attemptCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  httpStatus: number | null;
  duplicate: boolean;
  requestedAt: string;
  deliveredAt: string | null;
  updatedAt: string;
}

interface AuditEvent {
  id: string;
  timestamp: string;
  source: string;
  action: string;
  status: string;
  detail: string | null;
}

export function OpportunityHandoffSection({ opportunityId }: { opportunityId: string }) {
  const [handoffs, setHandoffs] = useState<HandoffRecord[] | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, DeliveryAudit | null>>({});
  const [experiments, setExperiments] = useState<Experiment[] | null>(null);
  const [audit, setAudit] = useState<AuditEvent[] | null>(null);

  const load = useCallback(async () => {
    const [handoffsR, experimentsR, auditR] = await Promise.allSettled([
      apiGet<HandoffRecord[]>("/api/handoffs"),
      apiGet<Experiment[]>("/api/experiments"),
      apiGet<{ events: AuditEvent[] }>("/api/system/audit-events?limit=100"),
    ]);
    const ownHandoffs = handoffsR.status === "fulfilled" ? handoffsR.value.filter((h) => h.opportunityId === opportunityId) : null;
    setHandoffs(ownHandoffs);
    setExperiments(experimentsR.status === "fulfilled" ? experimentsR.value.filter((e) => e.opportunityId === opportunityId) : null);
    setAudit(auditR.status === "fulfilled" ? auditR.value.events.filter((event) => event.id.includes(opportunityId) || event.source === "HANDOFF_DELIVERY") : null);

    if (ownHandoffs) {
      const results = await Promise.allSettled(
        ownHandoffs.map(async (handoff) => {
          const data = await apiGet<{ delivery: DeliveryAudit }>(`/api/handoffs/${encodeURIComponent(handoff.id)}/deliver`);
          return [handoff.id, data.delivery] as const;
        }),
      );
      const map: Record<string, DeliveryAudit | null> = {};
      for (const result of results) {
        if (result.status === "fulfilled") map[result.value[0]] = result.value[1];
      }
      setDeliveries(map);
    }
  }, [opportunityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Handoff"
          subtitle="Cross-repository handoff to AI Income Lab and its delivery audit trail."
          action={
            <Link href="/handoffs" className="text-xs font-medium text-blue-700 hover:underline">
              Handoff Center →
            </Link>
          }
        />
        {handoffs === null ? (
          <p className="p-5 text-sm text-slate-500">Data unavailable</p>
        ) : handoffs.length === 0 ? (
          <EmptyState
            title="No handoff for this opportunity yet"
            description="Create a handoff once validation permits implementation."
            action={
              <Link href="/handoffs" className="text-sm font-medium text-blue-700 hover:underline">
                Open Handoff Center →
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {handoffs.map((handoff) => {
              const delivery = deliveries[handoff.id];
              return (
                <li key={handoff.id} className="space-y-2 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/handoffs/${handoff.id}`} className="font-mono text-xs text-blue-700 hover:underline">
                      {handoff.id}
                    </Link>
                    <StatusBadge status={handoff.status} />
                    <span className="text-xs text-slate-400">contract v{handoff.contractVersion}</span>
                    <span className="text-xs text-slate-400">created {formatRelativeTime(handoff.createdAt)}</span>
                  </div>
                  {delivery ? (
                    <div className="rounded-md border border-slate-100 bg-slate-50/60 p-3 text-xs text-slate-600">
                      <div className="flex flex-wrap items-center gap-2">
                        <HandoffDeliveryStatus status={delivery.status} duplicate={delivery.duplicate} lastErrorCode={delivery.lastErrorCode} />
                        <span>· {delivery.attemptCount} attempt(s)</span>
                        {delivery.deliveredAt ? <span>· delivered {formatRelativeTime(delivery.deliveredAt)}</span> : null}
                      </div>
                      {delivery.lastErrorMessage ? <p className="mt-1 text-slate-500">{delivery.lastErrorMessage}</p> : null}
                      <p className="mt-1 font-mono text-[11px] text-slate-400">idempotencyKey: {delivery.idempotencyKey}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">Delivery audit: no attempt recorded yet.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Experiments" subtitle="Experiments attached to this opportunity." />
        {experiments === null ? (
          <p className="p-5 text-sm text-slate-500">Data unavailable</p>
        ) : experiments.length === 0 ? (
          <EmptyState title="No experiments yet" description="Experiments are created from an accepted handoff." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {experiments.map((experiment) => (
              <li key={experiment.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <Link href={`/experiments/${experiment.id}`} className="text-sm font-medium text-blue-700 hover:underline">
                    {experiment.id}
                  </Link>
                  <p className="truncate text-xs text-slate-500">{experiment.hypothesis ?? experiment.objective ?? "—"}</p>
                </div>
                <StatusBadge status={experiment.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Audit history"
          subtitle="Persisted operational events involving this opportunity."
          action={
            <Link href="/audit-logs" className="text-xs font-medium text-blue-700 hover:underline">
              All audit logs →
            </Link>
          }
        />
        {audit === null ? (
          <p className="p-5 text-sm text-slate-500">Data unavailable</p>
        ) : audit.length === 0 ? (
          <EmptyState title="No audit events recorded" description="Delivery attempts, research outcomes and handoff transitions appear here." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {audit.slice(0, 10).map((event) => (
              <li key={event.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-xs">
                <span className="text-slate-400">{new Date(event.timestamp).toLocaleString()}</span>
                <span className="font-medium text-slate-700">{event.action}</span>
                <StatusBadge status={event.status} />
                {event.detail ? <span className="text-slate-500">{event.detail}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
