import "server-only";

import { getPrisma } from "@/lib/db";
import { getProviderActivations } from "@/lib/integrations/activation-service";
import { calculateOpportunityValidation, type OpportunityValidationResult } from "@/lib/opportunity-validation";
import { getOpportunityDecision } from "@/lib/server/opportunity-decision-service";
import { getOpportunityReadiness } from "@/lib/server/opportunity-readiness-service";

export const OPPORTUNITY_VALIDATION_BOUNDS = {
  MAX_PROVIDERS: 32,
} as const;

/**
 * Load one owner-scoped opportunity and compose the existing decision/readiness
 * contracts. No provider call or state mutation occurs. Missing, sample, and
 * cross-owner opportunities all return null so routes can return the same 404.
 */
export async function getOpportunityValidation(
  opportunityId: string,
  ownerId: string,
  now = new Date(),
): Promise<OpportunityValidationResult | null> {
  const prisma = getPrisma();
  const owned = await prisma.opportunity.findFirst({
    where: { id: opportunityId, ownerId, isSample: false },
    select: { id: true },
  });
  if (!owned) return null;

  const [decision, readiness, providerActivations] = await Promise.all([
    getOpportunityDecision(opportunityId, ownerId),
    getOpportunityReadiness(opportunityId, ownerId),
    getProviderActivations().catch(() => []),
  ]);
  if (!decision || !readiness) return null;

  const latest = await prisma.researchRun.findFirst({
    where: { opportunityId },
    orderBy: { startedAt: "desc" },
    select: {
      validation: {
        select: { evidenceCoverage: true, sourceDiversity: true },
      },
    },
  });

  return calculateOpportunityValidation({
    opportunityId,
    decision,
    readiness,
    evidenceCoverage: Number(latest?.validation?.evidenceCoverage ?? 0),
    sourceDiversity: latest?.validation?.sourceDiversity ?? 0,
    providers: providerActivations.slice(0, OPPORTUNITY_VALIDATION_BOUNDS.MAX_PROVIDERS).map((provider) => ({
      provider: provider.provider,
      status: provider.status,
      verified: provider.status === "HEALTHY" && provider.lastHealthDataClass === "REAL_DATA",
    })),
    now,
  });
}
