import { NextResponse } from "next/server";
import { getPrisma, isDbUnavailableError } from "@/lib/db";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";

const MAX_LIMIT = 100;

/**
 * GET /api/handoffs/deliveries?limit=50
 *
 * Owner-scoped listing of HIGH-1 handoff delivery audit rows (HandoffDelivery)
 * joined with their handoff and opportunity for the operational Handoff
 * Center. Read-only: every mutation stays behind the existing authenticated
 * delivery service (`POST /api/handoffs/:id/deliver`).
 *
 * Ownership follows the Phase 6A model: the row must belong to the caller
 * through the handoff's opportunity. Safe fields only — the transport
 * credential is never stored and never returned.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get("limit") ?? 50);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50));

    const rows = await getPrisma().handoffDelivery.findMany({
      where: { handoff: { opportunity: { ownerId: user.id } } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: {
        handoff: {
          select: {
            id: true,
            status: true,
            contractVersion: true,
            createdAt: true,
            opportunity: { select: { id: true, title: true } },
          },
        },
      },
    });

    return NextResponse.json(
      rows.map((row) => ({
        idempotencyKey: row.idempotencyKey,
        handoffId: row.handoffId,
        handoffStatus: row.handoff.status,
        contractVersion: row.contractVersion,
        opportunityId: row.handoff.opportunity.id,
        opportunityTitle: row.handoff.opportunity.title,
        status: row.status,
        attemptCount: row.attemptCount,
        lastErrorCode: row.lastErrorCode,
        lastErrorMessage: row.lastErrorMessage,
        httpStatus: row.httpStatus,
        duplicate: row.duplicate,
        requestedById: row.requestedById,
        requestedAt: row.requestedAt.toISOString(),
        deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
        updatedAt: row.updatedAt.toISOString(),
      })),
    );
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    return apiError(error, "Failed to load handoff deliveries");
  }
}
