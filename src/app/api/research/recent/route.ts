import { NextResponse } from "next/server";
import { getPrisma, isDbUnavailableError } from "@/lib/db";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";

const MAX_LIMIT = 50;

/**
 * GET /api/research/recent?limit=25
 *
 * Owner-scoped recent research runs across the caller's opportunities, with
 * evidence/source counts and per-provider run statuses for the Research
 * Center. Read-only; research execution stays behind the existing
 * `POST /api/research` endpoint.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get("limit") ?? 25);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 25));

    const rows = await getPrisma().researchRun.findMany({
      where: { opportunity: { ownerId: user.id } },
      orderBy: { startedAt: "desc" },
      take: limit,
      select: {
        id: true,
        opportunityId: true,
        status: true,
        startedAt: true,
        completedAt: true,
        confidence: true,
        conclusion: true,
        conclusionBasis: true,
        providersAttempted: true,
        providersSucceeded: true,
        providerStatuses: true,
        errors: true,
        opportunity: { select: { id: true, title: true } },
        validation: {
          select: {
            demandStatus: true,
            painPointStatus: true,
            commercialIntentStatus: true,
            trendStatus: true,
            competitionStatus: true,
            evidenceCoverage: true,
            sourceDiversity: true,
            contradictionCount: true,
            confidence: true,
            conclusion: true,
          },
        },
        _count: { select: { evidence: true, sources: true, queries: true } },
      },
    });

    return NextResponse.json(
      rows.map((row) => ({
        id: row.id,
        opportunityId: row.opportunityId,
        opportunityTitle: row.opportunity.title,
        status: row.status,
        startedAt: row.startedAt.toISOString(),
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
        confidence: row.confidence === null ? null : Number(row.confidence),
        conclusion: row.conclusion,
        conclusionBasis: row.conclusionBasis,
        providersAttempted: row.providersAttempted,
        providersSucceeded: row.providersSucceeded,
        providerStatuses: row.providerStatuses,
        errors: row.errors,
        validation: row.validation
          ? {
              signals: {
                demand: row.validation.demandStatus,
                painPoint: row.validation.painPointStatus,
                commercialIntent: row.validation.commercialIntentStatus,
                trend: row.validation.trendStatus,
                competition: row.validation.competitionStatus,
              },
              evidenceCoverage: row.validation.evidenceCoverage,
              sourceDiversity: row.validation.sourceDiversity,
              contradictionCount: row.validation.contradictionCount,
              confidence: Number(row.validation.confidence),
              conclusion: row.validation.conclusion,
            }
          : null,
        evidenceCount: row._count.evidence,
        sourceCount: row._count.sources,
        queryCount: row._count.queries,
      })),
    );
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json(
        { error: "DATABASE_URL is not configured — research history requires persistence" },
        { status: 503 },
      );
    }
    return apiError(error, "Failed to load recent research runs");
  }
}
