"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { handoffRepository, opportunityRepository } from "@/lib/repositories";
import type { HandoffRecord, Opportunity } from "@/lib/types";
import { Badge, Button, Card, CardHeader, statusBadgeClass } from "@/components/ui";
import { formatRelativeTime } from "@/lib/format";

export default function HandoffsPage() {
  const [handoffs, setHandoffs] = useState<HandoffRecord[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [rows, opps] = await Promise.all([
      handoffRepository.getAll(),
      opportunityRepository.getAll(),
    ]);
    setHandoffs(rows);
    setOpportunities(opps);
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

  if (loading) return <div className="p-8 text-center">Loading handoffs...</div>;

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
                    <Button onClick={() => handleAction(handoff.id, "createExperiment")}>
                      Create Experiment
                    </Button>
                  )}
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
