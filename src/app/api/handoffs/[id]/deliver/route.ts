import { NextResponse } from "next/server";
import { isDbUnavailableError } from "@/lib/db";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import {
  describeHandoffDelivery,
  deliverHandoff,
  getHandoffDeliveryAudit,
} from "@/lib/server/handoff-delivery-service";

const MAX_ID_LENGTH = 64;

/**
 * HIGH-1 — cross-repository AIAgent → AI Income Lab handoff delivery.
 *
 * POST /api/handoffs/:id/deliver
 *   Owner-scoped attempt to deliver one ACCEPTED handoff to AI Income Lab
 *   using the shared, versioned contract in `@/lib/handoff-delivery/contract`.
 *
 *   - Authentication: the caller's session (requireUser).
 *   - Authorization/tenancy: the handoff must belong to the caller; a foreign
 *     handoff answers 404 exactly like a missing one.
 *   - Idempotency: delivery is keyed on the handoff id, so repeating this
 *     request updates one delivery record and the receiver de-duplicates on
 *     the same `idempotencyKey`.
 *   - Delivery state: the honest outcome (DELIVERED / REJECTED / FAILED /
 *     NOT_CONFIGURED) is persisted and returned. Nothing is reported as
 *     delivered that the receiver did not accept.
 *
 * GET /api/handoffs/:id/deliver
 *   The delivery audit trail for the caller's handoff.
 *
 * This endpoint triggers NO downstream execution. It hands AI Income Lab a
 * handoff to evaluate; the receiving system applies its own review and
 * execution gates.
 */
export async function POST(_request: Request, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = context.params.id?.trim().slice(0, MAX_ID_LENGTH) ?? "";
    if (!id) return NextResponse.json({ error: "Invalid handoff id" }, { status: 400 });

    const result = await deliverHandoff(id, user.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    // NOT_CONFIGURED is an honest 503, not a silent success: there is no
    // addressable authenticated receiver, so the handoff did not cross a
    // network boundary.
    const status = result.delivery.status === "NOT_CONFIGURED" ? 503 : 200;
    return NextResponse.json(result, { status });
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    return apiError(error, "Handoff delivery failed");
  }
}

export async function GET(_request: Request, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = context.params.id?.trim().slice(0, MAX_ID_LENGTH) ?? "";
    if (!id) return NextResponse.json({ error: "Invalid handoff id" }, { status: 400 });

    const audit = await getHandoffDeliveryAudit(id, user.id);
    // A foreign handoff is indistinguishable from a missing one.
    if (!audit) return NextResponse.json({ error: "Handoff not found" }, { status: 404 });
    return NextResponse.json({ capability: describeHandoffDelivery(), delivery: audit });
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    return apiError(error, "Failed to load handoff delivery");
  }
}
