"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, Button } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/http";

/**
 * Phase 6C — learning & ranking evidence for one opportunity.
 * Shows research vs experiment evidence, learning signals, contradictions,
 * ranking history with reasons, and a manual rerank button. All numbers come
 * from the server's deterministic rules; the client can only REQUEST a rerank.
 */

interface RankingData {
  opportunityId: string;
  score: number;
  researchScore: number;
  experimentDelta: number;
  confidence: number;
  researchEvidence: { conclusion: string | null };
  experimentEvidence: {
    experimentCount?: number;
    completedCount?: number;
    contradiction?: string;
    confidence?: number;
    explanation?: string[];
  } | null;
  learningSignals: Array<{ key: string; basis: string; dataClass: string; experimentId: string }>;
  lastRankingAt: string | null;
  history: Array<{
    id: string;
    previousScore: number | null;
    newScore: number;
    previousRank: number | null;
    newRank: number | null;
    experimentDelta: number;
    contradiction: string;
    validationContext: string;
    confidence: number;
    reason: string;
    createdAt: string;
  }>;
}

function signalTone(key: string): string {
  if (key.startsWith("POSITIVE")) return "text-emerald-700";
  if (key.startsWith("NEGATIVE")) return "text-red-700";
  return "text-slate-600";
}

export function OpportunityLearning({ opportunityId }: { opportunityId: string }) {
  const [ranking, setRanking] = useState<RankingData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reranking, setReranking] = useState(false);
  const [rerankMessage, setRerankMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<RankingData>(`/api/opportunities/${opportunityId}/ranking`);
      setRanking(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load ranking");
    } finally {
      setLoaded(true);
    }
  }, [opportunityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRerank() {
    setReranking(true);
    setRerankMessage(null);
    try {
      await apiSend(`/api/opportunities/${opportunityId}/rerank`, "POST", {});
      await load();
      setRerankMessage("Re-ranking complete — changes are explained below.");
    } catch (err) {
      setRerankMessage(err instanceof Error ? err.message : "Re-ranking failed");
    } finally {
      setReranking(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Learning & ranking evidence"
        subtitle="Research evidence and recorded experiment evidence are tracked separately — experiments never overwrite research, and their influence is bounded."
        action={
          <Button onClick={handleRerank} disabled={reranking}>
            {reranking ? "Re-ranking…" : "Re-rank from experiments"}
          </Button>
        }
      />
      <div className="space-y-4 p-5 text-sm">
        {loadError && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-700">{loadError}</p>}
        {!loaded ? (
          <p className="text-slate-500">Loading…</p>
        ) : !ranking ? (
          <p className="text-slate-500">Ranking data unavailable.</p>
        ) : (
          <>
            {rerankMessage && <p className="rounded-md bg-blue-50 px-3 py-2 text-blue-700">{rerankMessage}</p>}

            <div className="grid gap-3 md:grid-cols-3">
              <p>
                <strong>Current score:</strong> {ranking.score.toFixed(1)}{" "}
                <span className="text-xs text-slate-400">
                  (research {ranking.researchScore.toFixed(1)} {ranking.experimentDelta !== 0 ? `${ranking.experimentDelta > 0 ? "+" : ""}${ranking.experimentDelta.toFixed(1)} experiment` : ""})
                </span>
              </p>
              <p>
                <strong>Confidence:</strong> {(ranking.confidence * 100).toFixed(0)}%{" "}
                <span className="text-xs text-slate-400">confidence ≠ score — a high score can still be uncertain</span>
              </p>
              <p>
                <strong>Last re-ranked:</strong> {ranking.lastRankingAt ? new Date(ranking.lastRankingAt).toLocaleString() : "never"}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Research evidence</p>
                <p>
                  {ranking.researchEvidence.conclusion
                    ? `${ranking.researchEvidence.conclusion.replace(/_/g, " ").toLowerCase()} from external research`
                    : "No research run concluded yet"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Experiment evidence</p>
                {ranking.experimentEvidence ? (
                  <>
                    <p>
                      {ranking.experimentEvidence.completedCount ?? 0} experiment(s) with recorded data
                      {ranking.experimentEvidence.contradiction && ranking.experimentEvidence.contradiction !== "NONE" ? (
                        <span className="text-amber-700"> · {ranking.experimentEvidence.contradiction.replace(/_/g, " ")}</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-slate-500">
                      Experiment influence {ranking.experimentDelta > 0 ? "+" : ""}
                      {ranking.experimentDelta.toFixed(1)} points (bounded, capped at ±10).
                    </p>
                  </>
                ) : (
                  <p className="text-slate-500">No recorded experiment data yet.</p>
                )}
              </div>
            </div>

            {ranking.learningSignals.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Learning signals</p>
                <ul className="space-y-2">
                  {ranking.learningSignals.map((signal, index) => (
                    <li key={`${signal.experimentId}-${index}`} className="rounded-md bg-slate-50 px-3 py-2">
                      <span className={`font-medium ${signalTone(signal.key)}`}>{signal.key.replace(/_/g, " ")}</span>{" "}
                      <span className="text-slate-600">— {signal.basis}</span>{" "}
                      <span className="text-xs text-slate-400">
                        ({signal.dataClass === "REAL_DATA" ? "recorded" : "estimated"} data)
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {ranking.history.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Ranking change history</p>
                <ul className="space-y-2">
                  {ranking.history.map((entry) => (
                    <li key={entry.id} className="rounded-md border border-slate-100 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {entry.previousScore === null ? "—" : entry.previousScore.toFixed(1)} → {entry.newScore.toFixed(1)}
                        </span>
                        {entry.previousRank !== null && entry.newRank !== null && entry.previousRank !== entry.newRank && (
                          <span className="text-xs text-slate-500">
                            rank #{entry.previousRank} → #{entry.newRank}
                          </span>
                        )}
                        <span className="text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString()}</span>
                        {entry.validationContext !== "INSUFFICIENT" && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                            {entry.validationContext.replace(/_/g, " ")}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-slate-600">{entry.reason}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-slate-400">
              Experiment evidence is bounded (±10 max) and can never overwrite research evidence; contradictions stay visible.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
