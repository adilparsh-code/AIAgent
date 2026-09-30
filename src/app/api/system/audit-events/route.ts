import { NextResponse } from "next/server";
import { getPrisma, isDbUnavailableError } from "@/lib/db";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";

const MAX_EVENTS = 150;
const PER_SOURCE_LIMIT = 50;

/**
 * GET /api/system/audit-events?limit=100
 *
 * Owner-scoped operational audit feed for the Audit Logs page, derived from
 * PERSISTED facts the caller owns:
 *
 *   - HandoffDelivery rows (delivery attempts, outcomes, error codes)
 *   - ResearchRun rows (started / failed terminal states)
 *   - Handoff rows (created / accepted / rejected transitions)
 *
 * Every message is already safe diagnostic content (the persistence layer
 * stores sanitized error messages only — see the HandoffDelivery model notes
 * and the operational-event sanitization used across services). No secrets,
 * credentials, or request payloads are returned. A queryable audit trail for
 * log-stream events (security events, operational logs) does not exist yet in
 * this repository, so this endpoint intentionally covers only what is actually
 * persisted — nothing is invented to fill the gap.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get("limit") ?? 100);
    const limit = Math.min(MAX_EVENTS, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 100));
    const take = Math.min(PER_SOURCE_LIMIT, limit);

    const owned = { opportunity: { ownerId: user.id } } as const;

    const [deliveries, researchRuns, handoffs] = await Promise.all([
      getPrisma().handoffDelivery.findMany({
        where: { handoff: owned },
        orderBy: { updatedAt: "desc" },
        take,
        include: { handoff: { select: { opportunityId: true, opportunity: { select: { title: true } } } } },
      }),
      getPrisma().researchRun.findMany({
        where: owned,
        orderBy: { startedAt: "desc" },
        take,
        select: { id: true, opportunityId: true, status: true, startedAt: true, completedAt: true, errors: true, opportunity: { select: { title: true } } },
      }),
      getPrisma().handoff.findMany({
        where: owned,
        orderBy: { updatedAt: "desc" },
        take,
        select: { id: true, opportunityId: true, status: true, createdAt: true, updatedAt: true, acceptedAt: true, rejectedAt: true, rejectionReason: true, opportunity: { select: { title: true } } },
      }),
    ]);

    type AuditEvent = {
      id: string;
      timestamp: string;
      source: "HANDOFF_DELIVERY" | "RESEARCH_RUN" | "HANDOFF";
      action: string;
      entity: string;
      entityLabel: string;
      opportunityId: string | null;
      status: string;
      detail: string | null;
    };

    const events: AuditEvent[] = [];

    for (const row of deliveries) {
      events.push({
        id: `delivery:${row.idempotencyKey}`,
        timestamp: row.updatedAt.toISOString(),
        source: "HANDOFF_DELIVERY",
        action: "handoff.delivery",
        entity: "HandoffDelivery",
        entityLabel: row.handoff.opportunity.title,
        opportunityId: row.handoff.opportunityId,
        status: row.status,
        detail:
          row.lastErrorMessage ??
          (row.duplicate ? "Receiver reported the delivery as a duplicate replay." : null),
      });
    }

    for (const row of researchRuns) {
      const status = row.status;
      if (status !== "FAILED" && status !== "COMPLETED" && status !== "PARTIAL") {
        // Only terminal research states carry an auditable outcome.
        continue;
      }
      events.push({
        id: `research:${row.id}`,
        timestamp: (row.completedAt ?? row.startedAt).toISOString(),
        source: "RESEARCH_RUN",
        action: "research.run",
        entity: "ResearchRun",
        entityLabel: row.opportunity.title,
        opportunityId: row.opportunityId,
        status,
        detail: row.errors.length > 0 ? row.errors[0] : null,
      });
    }

    for (const row of handoffs) {
      const action =
        row.status === "ACCEPTED" && row.acceptedAt
          ? "handoff.accepted"
          : row.status === "REJECTED" && row.rejectedAt
            ? "handoff.rejected"
            : "handoff.created";
      events.push({
        id: `handoff:${row.id}:${action}`,
        timestamp: (row.acceptedAt ?? row.rejectedAt ?? row.createdAt).toISOString(),
        source: "HANDOFF",
        action,
        entity: "Handoff",
        entityLabel: row.opportunity.title,
        opportunityId: row.opportunityId,
        status: row.status,
        detail: row.rejectionReason,
      });
    }

    events.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));

    return NextResponse.json({
      coverage: "Persisted handoff deliveries, terminal research runs, and handoff transitions. Log-stream events are not queryable yet and are not included.",
      generatedAt: new Date().toISOString(),
      events: events.slice(0, limit),
    });
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    return apiError(error, "Failed to load audit events");
  }
}
