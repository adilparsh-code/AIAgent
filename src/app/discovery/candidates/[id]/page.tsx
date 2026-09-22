"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, statusBadgeClass } from "@/components/ui";
import type { EvaluatedCandidateView, IncomeLabHandoff, OpportunityBrief } from "@/lib/discovery-types";

export default function OpportunityBriefPage({ params }: { params: { id: string } }) {
  const [candidate, setCandidate] = useState<EvaluatedCandidateView | null>(null);
  const [brief, setBrief] = useState<OpportunityBrief | null>(null);
  const [handoff, setHandoff] = useState<IncomeLabHandoff | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [handoffMessage, setHandoffMessage] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch(`/api/discovery/candidates/${encodeURIComponent(params.id)}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(typeof data?.error === "string" ? data.error : "Brief not found");
        }
        setCandidate(data.candidate as EvaluatedCandidateView);
        setBrief((data.brief as OpportunityBrief | null) ?? null);
        setHandoff((data.handoff as IncomeLabHandoff | null) ?? null);
        setRunId(data.run?.id ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load brief");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  const handleHandoff = async () => {
    setPreparing(true);
    setHandoffMessage(null);
    try {
      const response = await fetch(`/api/discovery/candidates/${encodeURIComponent(params.id)}/handoff`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Handoff failed");
      }
      setHandoff(data.handoff as IncomeLabHandoff);
      setCandidate(data.candidate as EvaluatedCandidateView);
      setHandoffMessage(typeof data.note === "string" ? data.note : "Handoff prepared.");
    } catch (err) {
      setHandoffMessage(err instanceof Error ? err.message : "Handoff failed");
    } finally {
      setPreparing(false);
    }
  };

  if (loading) return <div className="p-8 text-center">Loading opportunity brief…</div>;
  if (error || !candidate) {
    return (
      <div className="space-y-3">
        <Link href="/discovery" className="text-sm text-blue-600">
          Back to discovery
        </Link>
        <Card className="p-6 text-sm text-red-700">{error ?? "Candidate not found"}</Card>
      </div>
    );
  }

  const ranking = brief?.scoreBreakdown ?? candidate.rankingBreakdown;

  return (
    <div className="space-y-4">
      <Link href={runId ? `/discovery/${runId}` : "/discovery"} className="text-sm text-blue-600">
        Back to ranked opportunities
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{candidate.title}</h1>
        <Badge className={statusBadgeClass(candidate.validationConclusion ?? "INSUFFICIENT_EVIDENCE")}>
          {candidate.validationConclusion ?? "NO CONCLUSION"}
        </Badge>
        <Badge className={statusBadgeClass(candidate.handoffStatus)}>{candidate.handoffStatus}</Badge>
      </div>
      <p className="text-sm text-slate-600">{candidate.problemHypothesis}</p>

      <Card>
        <CardHeader title="Opportunity brief" subtitle="Evidence only. Missing data is not support. AI estimates are labeled separately." />
        <div className="space-y-4 p-5 text-sm">
          <p><strong>Category:</strong> {candidate.category}</p>
          <p><strong>Target audience:</strong> {candidate.targetAudience || "Unspecified"}</p>
          <p><strong>Confidence:</strong> {candidate.confidence == null ? "n/a" : `${Math.round(candidate.confidence * 100)}%`}</p>
          <p><strong>Conclusion basis:</strong> {brief?.conclusionBasis ?? "No research conclusion yet."}</p>
          <p><strong>Recommended next experiment:</strong> {brief?.recommendedNextExperiment ?? "Do not implement until evidence exists."}</p>
          {candidate.opportunityId ? (
            <p>
              <strong>Linked opportunity:</strong>{" "}
              <Link className="text-blue-700" href={`/opportunities/${candidate.opportunityId}`}>
                {candidate.opportunityId}
              </Link>
            </p>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <SignalBlock title="Demand evidence" status={brief?.demandEvidence.status} basis={brief?.demandEvidence.basis} urls={brief?.demandEvidence.urls} />
            <SignalBlock title="Market / trend evidence" status={brief?.marketTrendEvidence.status} basis={brief?.marketTrendEvidence.basis} urls={brief?.marketTrendEvidence.urls} />
            <SignalBlock title="Monetization" status={brief?.monetizationPossibilities.status} basis={brief?.monetizationPossibilities.basis} urls={[]} extra={brief?.monetizationPossibilities.options} />
            <SignalBlock title="Competition / alternatives" status={brief?.competitionAlternatives.status} basis={brief?.competitionAlternatives.basis} urls={brief?.competitionAlternatives.urls} />
          </div>

          {brief?.contradictions?.length ? (
            <div>
              <h3 className="font-semibold">Contradictions</h3>
              <ul className="mt-1 list-disc pl-5">
                {brief.contradictions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-slate-500">No contradictions recorded.</p>
          )}

          {brief?.risks?.length ? (
            <div>
              <h3 className="font-semibold">Risks / provider health</h3>
              <ul className="mt-1 list-disc pl-5">
                {brief.risks.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {brief?.evidenceUrls?.length ? (
            <div>
              <h3 className="font-semibold">Evidence URLs</h3>
              <ul className="mt-1 list-disc pl-5">
                {brief.evidenceUrls.map((url) => (
                  <li key={url}>
                    <a href={url} className="text-blue-700" rel="noopener noreferrer nofollow" target="_blank">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-slate-500">No evidence URLs. Missing data is not positive evidence.</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Score breakdown"
          subtitle="evidence-backed vs calculated vs AI estimate. AI estimates are never real-world facts."
        />
        <div className="p-5 text-sm">
          {ranking ? (
            <>
              <p className="mb-3 text-slate-600">{ranking.note}</p>
              <p className="mb-3">
                Ranking score <strong>{ranking.rankingScore.toFixed(1)}</strong> · evidence-backed{" "}
                {ranking.evidenceBackedScore.toFixed(1)} · calculated {ranking.calculatedScore ?? "none"} · AI estimate{" "}
                {ranking.aiEstimateScore ?? "none (intentionally unused)"}
              </p>
              <ul className="space-y-2">
                {ranking.factors.map((factor) => (
                  <li key={factor.key} className="rounded-md bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{factor.label}</span>
                      <Badge className="bg-slate-100 text-slate-700">{factor.provenance}</Badge>
                      <span>{factor.value == null ? "unmeasured" : factor.value}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{factor.basis}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-slate-500">No ranking yet.</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="AI Income Lab handoff"
          subtitle="Contract only. AIAgent does not execute implementation or revenue actions."
          action={
            <Button onClick={handleHandoff} disabled={preparing || candidate.handoffStatus === "NOT_READY"}>
              {preparing ? "Preparing…" : candidate.handoffStatus === "PREPARED" ? "Handoff prepared" : "Prepare handoff"}
            </Button>
          }
        />
        <div className="space-y-3 p-5 text-sm">
          {handoffMessage ? <p className="text-slate-700">{handoffMessage}</p> : null}
          {handoff ? (
            <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 text-xs">{JSON.stringify(handoff, null, 2)}</pre>
          ) : (
            <p className="text-slate-500">Not ready. Insufficient or contradicted evidence cannot be handed off.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

function SignalBlock({
  title,
  status,
  basis,
  urls,
  extra,
}: {
  title: string;
  status?: string;
  basis?: string;
  urls?: string[];
  extra?: string[];
}) {
  return (
    <div className="rounded-md border border-slate-100 p-3">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="font-semibold">{title}</h3>
        <Badge className={statusBadgeClass(status ?? "INSUFFICIENT")}>{status ?? "INSUFFICIENT"}</Badge>
      </div>
      <p className="text-xs text-slate-600">{basis ?? "No evidence."}</p>
      {extra?.length ? (
        <ul className="mt-2 list-disc pl-5 text-xs">
          {extra.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {urls?.length ? (
        <ul className="mt-2 list-disc pl-5 text-xs">
          {urls.map((url) => (
            <li key={url}>
              <a href={url} className="text-blue-700" rel="noopener noreferrer nofollow" target="_blank">
                {url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
