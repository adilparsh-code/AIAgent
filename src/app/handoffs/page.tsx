"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { handoffRepository, opportunityRepository } from "@/lib/repositories";
import { apiGet, apiSend } from "@/lib/http";
import type { HandoffRecord, Opportunity } from "@/lib/types";
import { Badge, Button, Card, CardHeader, statusBadgeClass } from "@/components/ui";
import {
  ConfirmButton,
  DashboardCard,
  DataTable,
  EmptyState,
  HandoffDeliveryStatus,
  StatusBadge,
  type DataTableColumn,
} from "@/components/console";
import { formatRelativeTime } from "@/lib/format";

interface DeliveryRow {
  idempotencyKey: string;
  handoffId: string;
  handoffStatus: string;
  contractVersion: number;
  opportunityId: string;
  opportunityTitle: string;
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

export default function HandoffsPage() {
  const [handoffs, setHandoffs] = useState<HandoffRecord[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRow[] | null>(null);
  const [deliveriesError, setDeliveriesError] = useState<string | null>(null);
  const [delivering, setDelivering] = useState<string | null>(null);
  const [deliverMessage, setDeliverMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [rows, opps, deliveryRows] = await Promise.allSettled([
      handoffRepository.getAll(),
      opportunityRepository.getAll(),
      apiGet<DeliveryRow[]>("/api/handoffs/deliveries?limit=50"),
    ]);
    setHandoffs(rows.status === "fulfilled" ? rows.value : []);
    setOpportunities(opps.status === "fulfilled" ? opps.value : []);
    setDeliveries(deliveryRows.status === "fulfilled" ? deliveryRows.value : null);
    setDeliveriesError(
      deliveryRows.status === "rejected"
        ? deliveryRows.reason instanceof Error
          ? deliveryRows.reason.message
          : "Delivery audit unavailable"
        : null,
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!selectedOpportunityId) return;
    setCreating(true);
    setError(null);
    try {
      await handoffRepository.create({ opportunityId: selectedOpportunityId });
      setSelectedOpportunityId("");
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create handoff";
      try {
        const parsed = JSON.parse(message) as { reasons?: string[] };
        setError(parsed.reasons?.length ? `Not ready: ${parsed.reasons.join(", ")}` : message);
      } catch {
        setError(message);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleAction = async (id: string, action: "accept" | "reject" | "createExperiment") => {
    setActionError(null);
    try {
      await handoffRepository.act(id, { action });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    }
  };

  /**
   * Deliver through the EXISTING authenticated server-side delivery service
   * (`POST /api/handoffs/:id/deliver`). The browser never talks to AI Income
   * Lab directly; the server performs auth, adaptation and transport and
   * persists the honest outcome.
   */
  const handleDeliver = async (id: string) => {
    setDelivering(id);
    setDeliverMessage(null);
    try {
      await apiSend(`/api/handoffs/${encodeURIComponent(id)}/deliver`, "POST");
      setDeliverMessage({ tone: "ok", text: "Delivery attempt recorded. See the delivery table below for the persisted outcome." });
    } catch (err) {
      // NOT_CONFIGURED arrives as 503 — an honest outcome, not a UI bug.
      setDeliverMessage({
        tone: "warn",
        text: err instanceof Error ? err.message : "Delivery attempt failed; the persisted audit row has the exact outcome.",
      });
    } finally {
      setDelivering(null);
      await load();
    }
  };

  const deliveryColumns: Array<DataTableColumn<DeliveryRow>> = [
    {
      key: "opportunity",
      header: "Opportunity",
      render: (row) => (
        <Link href={`/opportunities/${row.opportunityId}`} className="font-medium text-blue-700 hover:underline">
          {row.opportunityTitle}
        </Link>
      ),
    },
    {
      key: "handoffId",
      header: "Handoff",
      render: (row) => (
        <Link href={`/handoffs/${row.handoffId}`} className="font-mono text-xs text-blue-700 hover:underline">
          {row.handoffId.slice(0, 12)}…
        </Link>
      ),
    },
    { key: "contractVersion", header: "Contract", render: (row) => <span className="text-xs text-slate-500">v{row.contractVersion} → &ldquo;1.0&rdquo;</span> },
    { key: "status", header: "Delivery status", render: (row) => <HandoffDeliveryStatus status={row.status} duplicate={row.duplicate} lastErrorCode={row.lastErrorCode} /> },
    {
      key: "idempotencyKey",
      header: "Idempotency key",
      render: (row) => <span className="font-mono text-[11px] text-slate-400" title={row.idempotencyKey}>{row.idempotencyKey}</span>,
    },
    { key: "attempts", header: "Attempts", render: (row) => <span className="tabular-nums text-slate-700">{row.attemptCount}</span> },
    {
      key: "lastAttempt",
      header: "Last attempt",
      render: (row) => <span className="text-xs text-slate-500">{formatRelativeTime(row.updatedAt)}</span>,
    },
    {
      key: "error",
      header: "Error",
      render: (row) =>
        row.lastErrorMessage ? (
          <span className="block max-w-xs truncate text-xs text-red-600" title={row.lastErrorMessage}>
            {row.lastErrorMessage}
          </span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        ),
    },
    {
      key: "detail",
      header: "",
      render: (row) => (
        <Link href={`/handoffs/${row.handoffId}`} className="text-xs font-medium text-blue-700 hover:underline">
          Lifecycle →
        </Link>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Handoffs</h1>
        <Card className="p-8 text-center text-sm text-slate-500">Loading handoffs…</Card>
      </div>
    );
  }
  const readyOpportunities = opportunities.filter((o) => o.status !== "REJECTED");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">AI Income Lab Handoffs</h1>
          <p className="text-sm text-slate-500">
            Hand a validated opportunity to execution as a structured, evidence-backed contract — then run it as an experiment.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Create handoff"
          subtitle="An opportunity must pass the evidence gate (validation, evidence, confidence, score, risks) before it can be handed off."
        />
        <div className="flex flex-wrap items-end gap-3 p-5">
          <div className="min-w-64 flex-1">
            <label className="mb-1 block text-sm font-medium">Opportunity</label>
            <select
              value={selectedOpportunityId}
              onChange={(e) => setSelectedOpportunityId(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-2"
            >
              <option value="">Select an opportunity</option>
              {readyOpportunities.map((opp) => (
                <option key={opp.id} value={opp.id}>
                  {opp.title} ({opp.status})
                </option>
              ))}
            </select>
          </div>
          <Button onClick={handleCreate} disabled={creating || !selectedOpportunityId}>
            {creating ? "Validating…" : "Create Handoff"}
          </Button>
        </div>
        {error && (
          <div className="border-t border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">{error}</div>
        )}
      </Card>

      {actionError && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{actionError}</Card>
      )}

      {deliverMessage && (
        <Card
          className={`p-4 text-sm ${deliverMessage.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
        >
          {deliverMessage.text}
        </Card>
      )}

      <DashboardCard
        title="Handoff deliveries — AIAgent → AI Income Lab"
        subtitle="Persisted delivery audit rows (HandoffDelivery). Outcomes are exactly what the transport observed: DELIVERED, REJECTED (with reason), FAILED, NOT_CONFIGURED, or DUPLICATE replay."
        action={
          <Button variant="secondary" onClick={load} disabled={loading}>
            Refresh
          </Button>
        }
      >
        <DataTable
          columns={deliveryColumns}
          rows={deliveries ?? []}
          rowKey={(row) => row.idempotencyKey}
          loading={loading && deliveries === null}
          error={deliveriesError}
          onRetry={load}
          empty={
            <EmptyState
              title="No delivery attempts recorded"
              description="Accept a handoff and deliver it — the outcome (including NOT_CONFIGURED) is recorded durably here."
            />
          }
          mobileCard={(row) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/handoffs/${row.handoffId}`} className="text-sm font-medium text-blue-700">
                  {row.opportunityTitle}
                </Link>
                <HandoffDeliveryStatus status={row.status} duplicate={row.duplicate} lastErrorCode={row.lastErrorCode} />
              </div>
              <p className="font-mono text-[11px] text-slate-400">{row.idempotencyKey}</p>
              <p className="text-xs text-slate-500">
                {row.attemptCount} attempt(s) · {formatRelativeTime(row.updatedAt)}
              </p>
              {row.lastErrorMessage ? <p className="text-xs text-red-600">{row.lastErrorMessage}</p> : null}
            </div>
          )}
        />
      </DashboardCard>

      {handoffs.length === 0 ? (
        <Card className="p-8 text-center text-slate-500">
          No handoffs yet. Validate an opportunity with research, then create a handoff above.
        </Card>
      ) : (
        handoffs.map((handoff) => (
          <Card key={handoff.id}>
            <CardHeader
              title={handoff.contract.title || handoff.opportunityId}
              subtitle={`${handoff.status} · created ${formatRelativeTime(handoff.createdAt)}${handoff.confidence !== null ? ` · confidence ${(handoff.confidence * 100).toFixed(0)}%` : ""}${handoff.score !== null ? ` · score ${handoff.score.toFixed(1)}` : ""}`}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={statusBadgeClass(handoff.status)}>{handoff.status}</Badge>
                  {handoff.status === "HANDOFF_READY" && (
                    <>
                      <Button onClick={() => handleAction(handoff.id, "accept")}>Accept</Button>
                      <Button variant="secondary" onClick={() => handleAction(handoff.id, "reject")}>
                        Reject
                      </Button>
                    </>
                  )}
                  {handoff.status === "ACCEPTED" && (
                    <>
                      <ConfirmButton
                        label={delivering === handoff.id ? "Delivering…" : "Deliver to AI Income Lab"}
                        confirmTitle="Attempt cross-repository delivery?"
                        confirmDescription="Calls the existing authenticated delivery service. The outcome — including NOT_CONFIGURED or an adapter refusal — is persisted to the audit trail. Nothing is fabricated."
                        confirmLabel="Deliver"
                        disabled={delivering === handoff.id}
                        onConfirm={() => handleDeliver(handoff.id)}
                      />
                      <Button onClick={() => handleAction(handoff.id, "createExperiment")}>
                        Create Experiment
                      </Button>
                    </>
                  )}
                  <Link
                    href={`/handoffs/${handoff.id}`}
                    className="inline-flex items-center rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Lifecycle →
                  </Link>
                </div>
              }
            />
            <div className="space-y-2 p-5 text-sm">
              <p><strong>Hypothesis:</strong> {handoff.experimentHypothesis}</p>
              <p>
                <strong>Validation:</strong>{" "}
                {handoff.validationConclusion ?? "No research run"}
              </p>
              <button
                type="button"
                className="text-blue-600 hover:underline"
                onClick={() => setExpanded(expanded === handoff.id ? null : handoff.id)}
              >
                {expanded === handoff.id ? "Hide contract" : "View contract"}
              </button>
              {expanded === handoff.id && (
                <pre className="max-h-96 overflow-auto rounded-md bg-slate-50 p-4 text-xs">
                  {JSON.stringify(handoff.contract, null, 2)}
                </pre>
              )}
              <div className="flex gap-3 text-xs text-slate-500">
                <Link href={`/opportunities/${handoff.opportunityId}`} className="text-blue-600 hover:underline">
                  View opportunity
                </Link>
                <Link href="/experiments" className="text-blue-600 hover:underline">
                  View experiments
                </Link>
              </div>
              {handoff.rejectionReason && (
                <p className="text-red-600"><strong>Rejection reason:</strong> {handoff.rejectionReason}</p>
              )}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
