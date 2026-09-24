import "server-only";

import { getPrisma } from "@/lib/db";
import { assessClosedLoop, type ClosedLoopAssessment, type ClosedLoopRankingView } from "@/lib/closed-loop-intelligence";
import { buildExperimentFeedbackFromSeries, rerankOpportunities } from "@/lib/server/learning-service";

/**
 * Run the bounded Phase 22 pass for one experiment:
 * recorded metrics → existing learning → existing reassessment/ranking.
 * No score is calculated here and no missing metric is filled in.
 */
export async function runClosedLoopForExperiment(
  experimentId: string,
  ownerId: string,
  now = new Date(),
): Promise<{ assessment: ClosedLoopAssessment; feedback: ReturnType<typeof buildExperimentFeedbackFromSeries> extends Promise<infer T> ? NonNullable<T> : never; rankingSnapshotIds: string[] } | null> {
  const experiment = await getPrisma().experiment.findFirst({
    where: { id: experimentId, isSample: false, opportunity: { ownerId } },
    select: { id: true, opportunityId: true, hypothesis: true, decision: true, status: true },
  });
  if (!experiment) return null;

  const built = await buildExperimentFeedbackFromSeries(experiment, ownerId);
  if (!built) return null;
  const { ranked, snapshotIds } = await rerankOpportunities(ownerId);
  const ranking = ranked.find((entry) => entry.opportunityId === experiment.opportunityId);
  const rankingView: ClosedLoopRankingView = ranking
    ? {
        experimentDelta: ranking.experimentDelta,
        newScore: ranking.newScore,
        previousScore: ranking.previousScore,
        changed: ranking.changed,
        contradiction: ranking.contradiction,
        validationContext: ranking.validationContext,
        explanation: ranking.explanation,
      }
    : {
        experimentDelta: 0,
        newScore: 0,
        previousScore: 0,
        changed: false,
        contradiction: "NONE",
        validationContext: "INSUFFICIENT",
        explanation: ["Opportunity ranking unavailable; no prioritization change was applied."],
      };
  void now;
  return {
    assessment: assessClosedLoop({ learning: built.contract, ranking: rankingView, rankingAvailable: Boolean(ranking) }),
    feedback: built,
    rankingSnapshotIds: snapshotIds,
  };
}
