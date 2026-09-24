"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notFound } from "next/navigation";
import { opportunityRepository } from "@/lib/repositories";
import { getScoreContributions, calculateOverallScore } from "@/lib/scoring";
import type { Opportunity } from "@/lib/types";
import type { ResearchRun } from "@/lib/research-types";
import { Badge, Card, CardHeader, ScoreBar, Button, statusBadgeClass } from "@/components/ui";
import { ResearchResultCard } from "@/components/ResearchResultCard";
import { OpportunityLearning } from "@/components/OpportunityLearning";
import { ResearchHistoryIntelligence } from "@/components/ResearchHistoryIntelligence";
import { OpportunityReadiness } from "@/components/OpportunityReadiness";
import { OpportunityDecisionPanel } from "@/components/OpportunityDecisionPanel";
import { OpportunityValidationPanel } from "@/components/OpportunityValidationPanel";
import { formatRelativeTime } from "@/lib/format";

export default function OpportunityDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [opp, setOpp] = useState<Opportunity | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSample, setIsSample] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Opportunity>>({});
  const [researchRun, setResearchRun] = useState<ResearchRun | null>(null);
  const [researchHistory, setResearchHistory] = useState<ResearchRun[]>([]);
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [handoffState, setHandoffState] = useState<"idle" | "creating" | "created" | "error">("idle");
  const [handoffMessage, setHandoffMessage] = useState<string | null>(null);

  useEffect(() => {
    async function loadOpportunity() {
      const data = await opportunityRepository.getById(params.id);
      if (!data) {
        setLoading(false);
        return;
      }
      setOpp(data);
      setEditForm(data);
      const sample = await opportunityRepository.isSample(params.id);
      setIsSample(sample);
      try {
        const historyResponse = await fetch(`/api/research?opportunityId=${encodeURIComponent(params.id)}&limit=10`);
        if (historyResponse.ok) {
          const history = (await historyResponse.json()) as ResearchRun[];
          setResearchHistory(Array.isArray(history) ? history : []);
          setResearchRun(Array.isArray(history) && history.length ? history[0]! : null);
        }
      } catch {
        // History is optional when the database is not configured.
      }
      setLoading(false);
    }
    loadOpportunity();
  }, [params.id]);

  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (!opp) return notFound();

  const breakdown = {
    demand: editForm.demandScore ?? opp.demandScore,
    commercialIntent: editForm.commercialIntentScore ?? opp.commercialIntentScore,
    competitionOpportunity: 100 - (editForm.competitionScore ?? opp.competitionScore),
    startupCost: Math.max(0, 100 - (editForm.estimatedStartupCost ?? opp.estimatedStartupCost) / 2),
    automationPotential: editForm.automationScore ?? opp.automationScore,
    differentiation: editForm.differentiationScore ?? opp.differentiationScore,
    monetizationStrength: editForm.monetizationStrengthScore ?? opp.monetizationStrengthScore,
    halalCompliance: editForm.halalScore ?? opp.halalScore,
  };
  const parts = getScoreContributions(breakdown);
  const currentScore = calculateOverallScore(breakdown);

  const statuses: Opportunity["status"][] = [
    "IDEA", "RESEARCHING", "VALIDATING", "VALIDATED", "BUILDING", 
    "PUBLISHED", "EARNING", "SCALING", "PAUSED", "REJECTED"
  ];

  const handleResearch = async () => {
    setResearching(true);
    setResearchError(null);
    try {
      const controlled = !isSample;
      const response = await fetch(controlled ? "/api/research/live-cycle" : "/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId: opp.id,
          title: opp.title,
          ...(controlled ? { requestId: `ui_${opp.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.slice(0, 64) } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        const detail = typeof data?.error === "string" ? data.error : typeof data?.safeMessage === "string" ? data.safeMessage : "Research failed";
        throw new Error(detail);
      }
      const run = (controlled ? data.researchRun : data) as ResearchRun | null;
      if (!run) throw new Error("No provider passed the real health gate; no research run was created.");
      setResearchRun(run);
      setSelectedRunId(run.id);
      setResearchHistory((prev) => [run, ...prev].filter((item) => item.id !== run.id).slice(0, 10));
    } catch (error) {
      setResearchError(error instanceof Error ? error.message : "Research failed");
    } finally {
      setResearching(false);
    }
  };

  const handleCreateHandoff = async () => {
    setHandoffState("creating");
    setHandoffMessage(null);
    try {
      const response = await fetch("/api/handoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId: opp.id }),
      });
      const data = (await response.json()) as { error?: string; reasons?: string[] };
      if (!response.ok) {
        const reasons = Array.isArray(data?.reasons) ? data.reasons.join(", ") : "";
        throw new Error(reasons ? `Not ready for handoff: ${reasons}` : data?.error || "Handoff failed");
      }
      setHandoffMessage("Handoff created and marked HANDOFF_READY. Open the Handoffs page to accept it.");
      setHandoffState("created");
    } catch (error) {
      setHandoffMessage(error instanceof Error ? error.message : "Handoff failed");
      setHandoffState("error");
    }
  };

  const handleSave = async () => {
    await opportunityRepository.update(params.id, editForm);
    setOpp({ ...opp, ...editForm });
    setIsEditing(false);
    router.refresh();
  };

  const handleArchive = async () => {
    await opportunityRepository.update(params.id, { status: "PAUSED" });
    router.push("/opportunities");
  };

  const handleDelete = async () => {
    if (isSample) {
      alert("Sample opportunities cannot be deleted.");
      return;
    }
    if (confirm("Are you sure you want to delete this opportunity? This action cannot be undone.")) {
      await opportunityRepository.delete(params.id);
      router.push("/opportunities");
    }
  };

  return (
    <div className="space-y-4">
      <Link href="/opportunities" className="text-sm text-blue-600">← Back to opportunities</Link>
      <div className="flex flex-wrap items-center gap-2">
        {isEditing ? (
          <input
            type="text"
            value={editForm.title || ""}
            onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
            className="text-2xl font-bold border-b border-blue-600 focus:outline-none"
          />
        ) : (
          <h1 className="text-2xl font-bold">{opp.title}</h1>
        )}
        {isEditing ? (
          <select
            value={editForm.status || opp.status}
            onChange={(e) => setEditForm({ ...editForm, status: e.target.value as Opportunity["status"] })}
            className="rounded-md border border-slate-200 px-2 py-1 text-sm"
          >
            {statuses.map(status => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        ) : (
          <Badge className={statusBadgeClass(opp.status)}>{opp.status}</Badge>
        )}
        <Badge className={statusBadgeClass(opp.halalStatus)}>{opp.halalStatus}</Badge>
        {isSample && <Badge className="bg-amber-100 text-amber-700">Sample Data</Badge>}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {!isEditing && (
          <Button onClick={handleResearch} disabled={researching}>
            {researching ? "Researching..." : isSample ? "Run Demo Research" : "Run Controlled Live Cycle"}
          </Button>
        )}
        {!isEditing && !isSample && (
          <>
            <Button onClick={() => setIsEditing(true)}>Edit</Button>
            <Button variant="secondary" onClick={handleArchive}>Archive</Button>
            {!isSample && <Button variant="danger" onClick={handleDelete}>Delete</Button>}
          </>
        )}
        {isEditing && (
          <>
            <Button onClick={handleSave}>Save Changes</Button>
            <Button variant="secondary" onClick={() => { setIsEditing(false); setEditForm(opp); }}>Cancel</Button>
          </>
        )}
        {!isEditing && !isSample && (
          <Button onClick={handleCreateHandoff} disabled={handoffState === "creating"}>
            {handoffState === "creating" ? "Validating…" : "Create Handoff"}
          </Button>
        )}
      </div>
      {handoffMessage && (
        <Card
          className={`p-4 text-sm ${
            handoffState === "created"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {handoffMessage}{" "}
          {handoffState === "created" && <Link href="/handoffs" className="underline">Open Handoffs →</Link>}
        </Card>
      )}
      {researchError && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <strong>Research error:</strong> {researchError}
        </Card>
      )}
      <Card>
        <CardHeader
          title="Research"
          subtitle={isSample ? "Sample opportunities retain the existing demo research path." : "Owned opportunities require real provider health checks before bounded read/search calls. REAL_DATA provenance is enforced."}
          action={
            <Button onClick={handleResearch} disabled={researching}>
              {researching ? "Researching…" : isSample ? "Run Research" : "Run Controlled Live Cycle"}
            </Button>
          }
        />
        <div className="p-5 text-sm">
          {researchRun ? (
            <p className="text-slate-600">
              Last run: <strong>{researchRun.conclusion}</strong> · {formatRelativeTime(researchRun.completedAt ?? researchRun.startedAt)} ·{" "}
              confidence {(researchRun.confidence * 100).toFixed(0)}% · {researchRun.evidence.length} evidence items
            </p>
          ) : (
            <p className="text-slate-500">
              No research run yet. Research success does not mean an opportunity is validated — validation is evidence-based
              and shown below after a run.
            </p>
          )}
        </div>
      </Card>
      {researchRun && <ResearchResultCard run={researchRun} />}
      {!isSample && <OpportunityReadiness opportunityId={params.id} />}
      {!isSample && <OpportunityDecisionPanel opportunityId={params.id} />}
      {!isSample && <OpportunityValidationPanel opportunityId={params.id} />}
      {!isSample && <ResearchHistoryIntelligence opportunityId={params.id} />}
      {!isSample && <OpportunityLearning opportunityId={params.id} />}
      {researchHistory.length > 1 && (
          <Card>
            <CardHeader title="Research run history" subtitle={`${researchHistory.length} recent runs — click a run to inspect it`} />
            <ul className="divide-y divide-slate-100 p-5 text-sm">
              {researchHistory.map((run) => (
                <li key={run.id} className="py-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedRunId(run.id);
                      setResearchRun(run);
                    }}
                    className={`flex w-full flex-wrap items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-slate-50 ${
                      selectedRunId === run.id ? "bg-slate-50 ring-1 ring-slate-200" : ""
                    }`}
                  >
                    <Badge className={statusBadgeClass(run.status)}>{run.status}</Badge>
                    <span className="font-mono text-xs text-slate-500">{run.id}</span>
                    <span className="text-slate-600">{run.conclusion}</span>
                    <span className="text-xs text-slate-500">
                      {formatRelativeTime(run.completedAt ?? run.startedAt)} · {(run.confidence * 100).toFixed(0)}% · {run.evidence.length} evidence
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Overview" />
          <div className="space-y-3 p-5 text-sm">
            {isEditing ? (
              <>
                <div>
                  <label className="block font-medium mb-1">Target Audience</label>
                  <textarea
                    value={editForm.targetAudience || opp.targetAudience}
                    onChange={(e) => setEditForm({ ...editForm, targetAudience: e.target.value })}
                    className="w-full rounded-md border border-slate-200 px-3 py-2"
                    rows={2}
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Problem Solved</label>
                  <textarea
                    value={editForm.problemSolved || opp.problemSolved}
                    onChange={(e) => setEditForm({ ...editForm, problemSolved: e.target.value })}
                    className="w-full rounded-md border border-slate-200 px-3 py-2"
                    rows={2}
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Monetization Method</label>
                  <textarea
                    value={editForm.monetizationMethod || opp.monetizationMethod}
                    onChange={(e) => setEditForm({ ...editForm, monetizationMethod: e.target.value })}
                    className="w-full rounded-md border border-slate-200 px-3 py-2"
                    rows={2}
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Next Action</label>
                  <input
                    type="text"
                    value={editForm.nextAction || opp.nextAction}
                    onChange={(e) => setEditForm({ ...editForm, nextAction: e.target.value })}
                    className="w-full rounded-md border border-slate-200 px-3 py-2"
                  />
                </div>
              </>
            ) : (
              <>
                <p><strong>Audience:</strong> {opp.targetAudience}</p>
                <p><strong>Problem:</strong> {opp.problemSolved}</p>
                <p><strong>Monetization:</strong> {opp.monetizationMethod}</p>
                <p><strong>Next action:</strong> {opp.nextAction}</p>
              </>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title={`Score breakdown — ${currentScore.toFixed(1)}/100`} subtitle="Weights: Demand 20%, Commercial Intent 20%, Competition 15%, Cost 10%, Automation 10%, Differentiation 10%, Monetization 10%, Halal 5%" />
          <ul className="space-y-2 p-5">
            {parts.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-3 text-sm">
                <span>{p.label} · {Math.round(p.weight * 100)}%</span>
                <ScoreBar value={p.rawScore} />
              </li>
            ))}
          </ul>
          {isEditing && (
            <div className="border-t p-5 space-y-4">
              <p className="text-xs text-slate-500">Edit scores to recalculate overall score</p>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium mb-1">Demand: {editForm.demandScore ?? opp.demandScore}</label>
                  <input
                    type="range"
                    value={editForm.demandScore ?? opp.demandScore}
                    onChange={(e) => setEditForm({ ...editForm, demandScore: Number(e.target.value) })}
                    min="0"
                    max="100"
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Competition: {editForm.competitionScore ?? opp.competitionScore}</label>
                  <input
                    type="range"
                    value={editForm.competitionScore ?? opp.competitionScore}
                    onChange={(e) => setEditForm({ ...editForm, competitionScore: Number(e.target.value) })}
                    min="0"
                    max="100"
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Evidence and risks" subtitle="SAMPLE / AI ESTIMATE — verify before spending money" />
          <div className="grid gap-4 p-5 text-sm md:grid-cols-2">
            <ul className="list-disc space-y-1 pl-5">{opp.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
            <ul className="list-disc space-y-1 pl-5">{opp.risks.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        </Card>
        <Card>
          <CardHeader title="Halal status" />
          <p className="p-5 text-sm text-slate-600">
            {opp.halalStatus === "REVIEW_REQUIRED"
              ? "REVIEW_REQUIRED means a human must review this model before launch. Automated screening is not a religious ruling."
              : "Automated screening is only a first filter. Confirm compliance manually before launch."}
          </p>
        </Card>
      </div>
    </div>
  );
}