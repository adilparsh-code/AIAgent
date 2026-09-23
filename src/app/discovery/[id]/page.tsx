"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, CardHeader, statusBadgeClass } from "@/components/ui";
import { formatRelativeTime } from "@/lib/format";
import type { DiscoveryRunResult } from "@/lib/discovery-types";

export default function DiscoveryRunPage({ params }: { params: { id: string } }) {
  const [run, setRun] = useState<DiscoveryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch(`/api/discovery/${encodeURIComponent(params.id)}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(typeof data?.error === "string" ? data.error : "Run not found");
        }
        setRun(data as DiscoveryRunResult);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load run");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  if (loading) return <div className="p-8 text-center">Loading discovery run…</div>;
  if (error || !run) {
    return (
      <div className="space-y-3">
        <Link href="/discovery" className="text-sm text-blue-600">
          Back to discovery
        </Link>
        <Card className="p-6 text-sm text-red-700">{error ?? "Discovery run not found"}</Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/discovery" className="text-sm text-blue-600">
        Back to discovery
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{run.topic}</h1>
        <Badge className={statusBadgeClass(run.status)}>{run.status}</Badge>
        <Badge className="bg-slate-100 text-slate-700">{run.category}</Badge>
      </div>
      <p className="text-sm text-slate-600">{run.notes}</p>
      <p className="text-xs text-slate-500">
        {formatRelativeTime(run.completedAt ?? run.startedAt)} · {run.researchedCount}/{run.candidateCount} researched ·{" "}
        {run.readyForHandoffCount} ready for AI Income Lab handoff
      </p>

      <div className="grid gap-2 text-xs text-slate-600 md:grid-cols-5">
        {["Discovery", "Research", "Validation", "Score", "Handoff ready"].map((step, index) => (
          <Card key={step} className="p-3 text-center font-medium">
            {index + 1}. {step}
          </Card>
        ))}
      </div>

      {run.errors.length ? (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>Run notes / errors:</strong>
          <ul className="mt-2 list-disc pl-5">
            {run.errors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Ranked opportunities"
          subtitle="Ranking uses evidence-backed signals first. Calculated scores are separate. AI estimates are never treated as facts."
        />
        <div className="divide-y divide-slate-100">
          {run.candidates.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">No candidates in this run.</p>
          ) : (
            run.candidates.map((candidate) => (
              <div key={candidate.id} className="flex flex-wrap items-start justify-between gap-3 p-5">
                <div className="min-w-0 flex-1">
                  <Link href={`/discovery/candidates/${candidate.id}`} className="font-semibold text-blue-700">
                    {candidate.rank ? `#${candidate.rank} ` : ""}
                    {candidate.title}
                  </Link>
                  <p className="mt-1 text-sm text-slate-600">{candidate.problemHypothesis}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge className={statusBadgeClass(candidate.validationConclusion ?? candidate.status)}>
                      {candidate.validationConclusion ?? candidate.status}
                    </Badge>
                    <Badge className="bg-slate-100 text-slate-700">
                      evidence {candidate.evidenceCount}
                    </Badge>
                    <Badge className="bg-slate-100 text-slate-700">
                      conf {candidate.confidence == null ? "n/a" : `${Math.round(candidate.confidence * 100)}%`}
                    </Badge>
                    <Badge className={statusBadgeClass(candidate.handoffStatus)}>{candidate.handoffStatus}</Badge>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold">{candidate.rankingScore == null ? "—" : candidate.rankingScore.toFixed(1)}</div>
                  <div className="text-xs text-slate-500">evidence-informed rank</div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
