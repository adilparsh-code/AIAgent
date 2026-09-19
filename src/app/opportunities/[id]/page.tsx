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

export default function OpportunityDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [opp, setOpp] = useState<Opportunity | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSample, setIsSample] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Opportunity>>({});
  const [researchRun, setResearchRun] = useState<ResearchRun | null>(null);
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);

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
        const historyResponse = await fetch(`/api/research?opportunityId=${encodeURIComponent(params.id)}&latest=1`);
        if (historyResponse.ok) {
          const latest = await historyResponse.json();
          if (latest) setResearchRun(latest as ResearchRun);
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
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId: opp.id, title: opp.title }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? data?.errors?.join("; ") ?? "Research failed");
      setResearchRun(data as ResearchRun);
    } catch (error) {
      setResearchError(error instanceof Error ? error.message : "Research failed");
    } finally {
      setResearching(false);
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
            {researching ? "Researching..." : "Run Live Research"}
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
      </div>
      {researchError && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <strong>Research error:</strong> {researchError}
        </Card>
      )}
      {researchRun && (
        <Card>
          <CardHeader
            title={`Research result — ${researchRun.status}`}
            subtitle={`Confidence ${(researchRun.confidence * 100).toFixed(0)}% · ${researchRun.evidence.length} evidence items · ${researchRun.findings.length} findings`}
          />
          <div className="space-y-4 p-5 text-sm">
            {researchRun.errors.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800">
                <strong>Provider warnings:</strong> {researchRun.errors.join(" · ")}
              </div>
            )}
            <div>
              <h2 className="mb-2 font-semibold">Findings</h2>
              {researchRun.findings.length ? (
                <ul className="space-y-3">
                  {researchRun.findings.map((finding) => (
                    <li key={finding.id} className="rounded-md border p-3">
                      <p className="font-medium">{finding.claim}</p>
                      <p className="mt-1 text-slate-600">{finding.summary}</p>
                      <p className="mt-1 text-xs text-slate-500">Confidence {(finding.confidence * 100).toFixed(0)}% · {finding.evidenceIds.length} supporting result(s)</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-500">No evidence was returned. Do not treat the opportunity as validated.</p>
              )}
            </div>
            <div>
              <h2 className="mb-2 font-semibold">Evidence</h2>
              {researchRun.evidence.length ? (
                <ul className="space-y-2">
                  {researchRun.evidence.map((item) => (
                    <li key={item.id} className="rounded-md border p-3">
                      <a href={item.url} target="_blank" rel="noreferrer" className="font-medium text-blue-700 hover:underline">{item.title}</a>
                      <p className="mt-1 text-slate-600">{item.snippet}</p>
                      <p className="mt-1 text-xs text-slate-500">Source: {item.source} · Quality {(item.qualityScore * 100).toFixed(0)}%</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
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