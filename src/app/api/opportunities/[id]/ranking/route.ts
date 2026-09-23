import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getPrisma } from "@/lib/db";
import { MAX_ID_LENGTH } from "@/lib/server/experiment-input";

function safeId(value: string): string {
  return value.trim().slice(0, MAX_ID_LENGTH);
}

/**
 * GET /api/opportunities/:id/ranking — score/confidence breakdown with the
 * research vs experiment evidence split, learning signals, contradictions, and
 * the recent RankingSnapshot history (WHY did this move). Owner-scoped.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = safeId(params.id);
    const opportunity = await getPrisma().opportunity.findFirst({
      where: { id, ownerId: user.id },
      select: {
        id: true,
        title: true,
        overallScore: true,
        confidence: true,
        lastResearchConclusion: true,
        experimentScoreDelta: true,
        experimentEvidence: true,
        lastRankingAt: true,
      },
    });
    if (!opportunity) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });

    const [snapshots, experiments] = await Promise.all([
      getPrisma().rankingSnapshot.findMany({
        where: { opportunityId: id, ownerId: user.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      getPrisma().experiment.findMany({
        where: { opportunityId: id, isSample: false },
        select: { id: true, decision: true, status: true, feedback: true },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    return NextResponse.json({
      opportunityId: id,
      score: Number(opportunity.overallScore),
      researchScore: Number(opportunity.overallScore) - Number(opportunity.experimentScoreDelta ?? 0),
      experimentDelta: Number(opportunity.experimentScoreDelta ?? 0),
      confidence: Number(opportunity.confidence),
      researchEvidence: { conclusion: opportunity.lastResearchConclusion },
      experimentEvidence: opportunity.experimentEvidence ?? null,
      learningSignals: experiments.flatMap((experiment) => {
        const learning = (experiment.feedback as { learning?: { learningSignals?: Array<{ key: string; basis: string; dataClass: string }> } } | null)?.learning;
        return (learning?.learningSignals ?? []).map((signal) => ({ ...signal, experimentId: experiment.id }));
      }),
      lastRankingAt: opportunity.lastRankingAt,
      history: snapshots.map((snapshot) => ({
        id: snapshot.id,
        previousScore: snapshot.previousScore === null ? null : Number(snapshot.previousScore),
        newScore: Number(snapshot.newScore),
        previousRank: snapshot.previousRank,
        newRank: snapshot.newRank,
        experimentDelta: Number(snapshot.experimentDelta),
        contradiction: snapshot.contradiction,
        validationContext: snapshot.validationContext,
        confidence: Number(snapshot.confidence),
        reason: snapshot.reason,
        experimentIds: snapshot.experimentIds,
        createdAt: snapshot.createdAt,
      })),
    });
  } catch (error) {
    return apiError(error, "Failed to load ranking");
  }
}
