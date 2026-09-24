import "server-only";
import { loadOpportunityDecisions } from "@/lib/server/opportunity-decision-loader";
import {
  calculatePortfolioIntelligence,
  type OpportunityPortfolioIntelligence,
} from "@/lib/opportunity-portfolio";

/**
 * Portfolio intelligence for the signed-in owner.
 *
 * Owner-scoped and sample-safe: only the session owner's non-sample
 * opportunities are ever loaded, so there is no cross-user opportunity,
 * research, or experiment leakage. Bounded reads (constant query count), no
 * external API calls, no secrets, deterministic output.
 *
 * Advisory only: this function never executes anything.
 */
export async function getOpportunityPortfolio(
  ownerId: string,
): Promise<OpportunityPortfolioIntelligence> {
  const { entries, truncated } = await loadOpportunityDecisions(ownerId);
  return calculatePortfolioIntelligence({
    opportunities: entries.map((entry) => entry.portfolioInput),
    truncated,
  });
}
