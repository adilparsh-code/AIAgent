"use client";

/**
 * Handoff detail — lifecycle view (Phase 6).
 *
 * Shows the full AIAgent → AI Income Lab lifecycle for one handoff:
 * Opportunity → Eligibility → Adapter → Wire Envelope → Transport →
 * AI Income Lab Receiver → Job Run.
 *
 * Every stage state is derived from persisted backend facts (the handoff row
 * and the HandoffDelivery audit row). Nothing is guessed: stages the backend
 * has not reached are shown honestly as pending/not-applicable with a reason.
 * The only action is the existing authenticated `POST /api/handoffs/:id/deliver`
 * — the UI never calls AI Income Lab directly.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiGet, apiSend } from "@/lib/http";
import type { HandoffRecord } from "@/lib/types";
import { Button, Card, CardHeader } from "@/components/ui";
import {
  ConfirmButton,
  EmptyState,
  ErrorState,
  HandoffTimeline,
  LoadingState,
  StatusBadge,
  type HandoffLifecycleStep,
} from "@/components/console";
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

interface Capability {
  status: "NOT_CONFIGURED" | "CONFIGURED";
  detail: string;
  endpointConfigured: boolean;
  credentialConfigured: boolean;
  requiredEnvironmentVariables: readonly string[];
}

/** Producer wire contract version the adapter emits (see income-lab-adapter). */
const RECEIVER_CONTRACT_VERSION = "1.0";

export default function HandoffDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";

  const [handoff, setHandoff] = useState<HandoffRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<DeliveryAudit | null>(null);
  const [capability, setCapability] = useState<Capability | null>(null);
  const [delivering, setDelivering] = useState(false);
  const [deliverMessage, setDeliverMessage] = useState<string | null>(null);
  const [showContract, setShowContract] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [handoffR, deliveryR] = await Promise.allSettled([
      apiGet<HandoffRecord>(`/api/handoffs/${encodeURIComponent(id)}`),
      apiGet<{ capability: Capability; delivery: DeliveryAudit }>(`/api/handoffs/${encodeURIComponent(id)}/deliver`),
    ]);
    if (handoffR.status === "rejected") {
      setHandoff(null);
      setNotFound(true);
    } else {
      setHandoff(handoffR.value);
      setNotFound(false);
    }
    if (deliveryR.status === "fulfilled") {
      setDelivery(deliveryR.value.delivery ?? null);
      setCapability(deliveryR.value.capability ?? null);
    } else {
      setDelivery(null);
      setCapability(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDeliver = useCallback(async () => {
    setDelivering(true);
    setDeliverMessage(null);
    try {
      await apiSend(`/api/handoffs/${encodeURIComponent(id)}/deliver`, "POST");
      setDeliverMessage("Delivery attempt completed. The persisted outcome below is authoritative.");
    } catch (err) {
      // NOT_CONFIGURED arrives as HTTP 503 — an honest outcome, not a bug.
      setDeliverMessage(err instanceof Error ? err.message : "Delivery attempt failed; see the audit row.");
    } finally {
      setDelivering(false);
      await load();
    }
  }, [id, load]);

  if (loading) return <LoadingState label="Loading handoff…" />;

  if (notFound || !handoff) {
    return (
      <div className="space-y-4">
        <Link href="/handoffs" className="text-sm text-blue-600 hover:underline">
          ← Back to Handoff Center
        </Link>
        <Card>
          <EmptyState
            title="Handoff not found"
            description="It may not exist, or it may belong to another user. A foreign handoff is indistinguishable from a missing one."
            action={
              <Link href="/handoffs" className="text-sm font-medium text-blue-700 hover:underline">
                Open Handoff Center →
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const status = delivery?.status ?? null;
  const refused = delivery?.lastErrorCode === "ADAPTATION_REFUSED";

  // Lifecycle states, derived ONLY from persisted rows.
  const steps: HandoffLifecycleStep[] = [
    {
      name: "Opportunity",
      status: handoff.opportunityId ? "READY" : "PENDING",
      detail: `Opportunity ${handoff.opportunityId} · contract v${handoff.contractVersion}`,
    },
    {
      name: "Eligibility",
      status: handoff.validationConclusion ?? "PENDING",
      detail:
        handoff.validationConclusion
          ? `Backend conclusion ${handoff.validationConclusion} · confidence ${handoff.confidence !== null ? `${(handoff.confidence * 100).toFixed(0)}%` : "n/a"} · score ${handoff.score !== null ? handoff.score.toFixed(1) : "n/a"}`
          : "No validation conclusion recorded — the evidence gate has not produced a decision.",
    },
    {
      name: "Adapter",
      status: refused ? "ADAPTATION_REFUSED" : status ? (refused ? "ADAPTATION_REFUSED" : "READY") : "PENDING",
      detail: refused
        ? (delivery?.lastErrorMessage ?? "The producer adapter refused to map this handoff onto the receiver contract; nothing was sent.")
        : `Maps the nested producer envelope onto the flat receiver contract (contractVersion "${RECEIVER_CONTRACT_VERSION}"). Refusals happen here, before any network call.`,
      current: refused,
    },
    {
      name: "Wire Envelope",
      status: status && !refused ? "READY" : "PENDING",
      detail:
        status && !refused
          ? `Flat envelope serialized for dispatch · idempotencyKey ${delivery?.idempotencyKey ?? "—"}`
          : "Serialized immediately before dispatch; an adapter refusal means no wire envelope is produced.",
    },
    {
      name: "Transport",
      status: status ?? "NOT_CONFIGURED",
      detail: !status
        ? (capability?.detail ?? "No delivery attempt recorded yet.")
        : `${delivery?.attemptCount ?? 0} attempt(s)${delivery?.httpStatus ? ` · last HTTP ${delivery.httpStatus}` : ""}${delivery?.deliveredAt ? ` · last delivered ${formatRelativeTime(delivery.deliveredAt)}` : ""}`,
      current: !refused && Boolean(status) && status !== "DELIVERED",
    },
    {
      name: "AI Income Lab Receiver",
      status:
        status === "DELIVERED"
          ? delivery?.duplicate
            ? "DUPLICATE"
            : "ACCEPTED"
          : status === "REJECTED" || status === "FAILED"
            ? (delivery?.lastErrorCode ?? status)
            : "NOT_CONFIGURED",
      detail:
        status === "DELIVERED"
          ? delivery?.duplicate
            ? "The receiver reported this delivery as a duplicate replay (same idempotencyKey) — no second JobRun was created."
            : `The receiver authenticated and accepted the envelope (HTTP ${delivery?.httpStatus ?? "—"}).`
          : (delivery?.lastErrorMessage ?? "The receiver has not processed an envelope for this handoff."),
      current: status === "DELIVERED",
    },
    {
      name: "Job Run",
      status: status === "DELIVERED" ? (delivery?.duplicate ? "DUPLICATE" : "PENDING") : "PENDING",
      detail:
        status === "DELIVERED"
          ? delivery?.duplicate
            ? "Replay deduplicated: exactly one JobRun exists for this idempotencyKey."
            : "The receiver maps OPPORTUNITY_PROPOSED to its own RESEARCH job. Job Run progress lives in AI Income Lab; AIAgent intentionally does not execute jobs."
          : "Reached only after the receiver accepts an envelope and passes its own eligibility gate.",
    },
  ];

  return (
    <div className="space-y-4">
      <Link href="/handoffs" className="text-sm text-blue-600 hover:underline">
        ← Back to Handoff Center
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">Handoff {handoff.id.slice(0, 12)}…</h1>
        <StatusBadge status={handoff.status} />
        {delivery ? <HandoffDeliveryInline delivery={delivery} /> : null}
      </div>
      <p className="text-sm text-slate-500">
        Opportunity{" "}
        <Link href={`/opportunities/${handoff.opportunityId}`} className="text-blue-700 hover:underline">
          {handoff.contract.title || handoff.opportunityId}
        </Link>{" "}
        · contract v{handoff.contractVersion} · created {formatRelativeTime(handoff.createdAt)}
      </p>

      {deliverMessage ? (
        <Card className={`p-4 text-sm ${deliverMessage.startsWith("Delivery attempt completed") ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
          {deliverMessage}
        </Card>
      ) : null}
      {error ? <ErrorState title="Handoff unavailable" message={error} onRetry={load} /> : null}

      <Card>
        <CardHeader
          title="Lifecycle"
          subtitle="Each stage reflects persisted backend state — the console never assumes progress the transport did not record."
          action={
            handoff.status === "ACCEPTED" ? (
              <ConfirmButton
                label={delivering ? "Delivering…" : "Deliver to AI Income Lab"}
                confirmTitle="Attempt cross-repository delivery?"
                confirmDescription="Uses the existing authenticated delivery service. The honest outcome (delivered, refused, rejected, failed, or NOT_CONFIGURED) is persisted and shown below."
                confirmLabel="Deliver"
                disabled={delivering}
                onConfirm={handleDeliver}
              />
            ) : (
              <span className="text-xs text-slate-400">Delivery requires an ACCEPTED handoff</span>
            )
          }
        />
        <div className="p-5">
          <HandoffTimeline steps={steps} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Transport configuration"
          subtitle="Capability reported by the delivery service itself. NOT_CONFIGURED is never displayed as healthy."
        />
        <div className="space-y-2 p-5 text-sm">
          {capability ? (
            <>
              <div className="flex items-center gap-2">
                <StatusBadge status={capability.status === "CONFIGURED" ? "READY" : "NOT_CONFIGURED"} />
                <span className="text-slate-600">{capability.detail}</span>
              </div>
              {capability.status !== "CONFIGURED" ? (
                <p className="text-xs text-slate-500">
                  Required server-side variables: {capability.requiredEnvironmentVariables.join(", ")}
                  {!capability.endpointConfigured ? " · endpoint missing" : ""}
                  {!capability.credentialConfigured ? " · credential missing" : ""}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-slate-500">Delivery capability unavailable (no attempt recorded yet).</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Delivery audit"
          subtitle="The durable HandoffDelivery row — exactly what the transport observed, including nothing."
        />
        {delivery ? (
          <dl className="grid gap-x-6 gap-y-2 p-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-400">Status</dt>
              <dd>
                <StatusBadge status={delivery.duplicate && delivery.status === "DELIVERED" ? "DUPLICATE" : delivery.status} />
                {delivery.lastErrorCode ? <span className="ml-2 text-xs text-slate-400">{delivery.lastErrorCode}</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Idempotency key</dt>
              <dd className="font-mono text-xs text-slate-600">{delivery.idempotencyKey}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Attempts</dt>
              <dd className="tabular-nums">{delivery.attemptCount}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">HTTP status</dt>
              <dd>{delivery.httpStatus ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Requested</dt>
              <dd>{new Date(delivery.requestedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Delivered</dt>
              <dd>{delivery.deliveredAt ? new Date(delivery.deliveredAt).toLocaleString() : "—"}</dd>
            </div>
            {delivery.lastErrorMessage ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-400">Last diagnostic (sanitized, credential-free)</dt>
                <dd className="text-xs text-slate-600">{delivery.lastErrorMessage}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <EmptyState
            title="No delivery attempt recorded"
            description="The audit row appears once a delivery is attempted — including NOT_CONFIGURED outcomes."
          />
        )}
      </Card>

      <Card>
        <CardHeader
          title="Handoff contract"
          subtitle="The versioned producer contract snapshot accepted by a human. The wire envelope is derived from this at dispatch time."
          action={
            <Button variant="secondary" onClick={() => setShowContract((v) => !v)}>
              {showContract ? "Hide contract" : "View contract"}
            </Button>
          }
        />
        {showContract ? (
          <pre className="m-5 max-h-96 overflow-auto rounded-md bg-slate-50 p-4 text-xs">{JSON.stringify(handoff.contract, null, 2)}</pre>
        ) : (
          <div className="grid gap-x-6 gap-y-2 p-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-400">Experiment hypothesis</dt>
              <dd className="text-slate-600">{handoff.experimentHypothesis}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Recommended experiment</dt>
              <dd>{handoff.recommendedExperiment}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Budget / time limits</dt>
              <dd>
                {handoff.budgetLimit ?? "—"} · {handoff.timeLimitDays ?? "—"} days
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Success criteria</dt>
              <dd className="text-slate-600">{handoff.successCriteria.join("; ") || "—"}</dd>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function HandoffDeliveryInline({ delivery }: { delivery: DeliveryAudit }) {
  const derived = delivery.status === "DELIVERED" && delivery.duplicate ? "DUPLICATE" : delivery.status;
  return (
    <span className="inline-flex items-center gap-2">
      <StatusBadge status={derived} />
      {delivery.lastErrorCode ? <span className="text-xs text-slate-400">{delivery.lastErrorCode}</span> : null}
    </span>
  );
}
