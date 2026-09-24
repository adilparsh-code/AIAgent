import "server-only";
import { loadOpportunityDecisions } from "@/lib/server/opportunity-decision-loader";
import type { OpportunityDecision } from "@/lib/opportunity-decision";

/**
 * Load persisted data for ONE opportunity and compute its decision.
 *
 * Returns null when the opportunity does not exist for this owner or is a
 * sample row (samples never expose private decision data). Owner-scoped:
 * foreign opportunities are indistinguishable 404s.
 *
 * The bounded batch read is shared with the portfolio loader so the row →
 * read-model mapping exists in exactly one place (no duplicated query logic).
 */
export async function getOpportunityDecision(
  opportunityId: string,
  ownerId: string,
): Promise<OpportunityDecision | null> {
  const { entries } = await loadOpportunityDecisions(ownerId, { opportunityIds: [opportunityId] });
  return entries[0]?.decision ?? null;
}
