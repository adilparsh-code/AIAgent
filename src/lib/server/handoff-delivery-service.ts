import "server-only";
import { getPrisma } from "../db";
import { handoffRepository } from "./repositories/handoffs";
import { logger } from "./logger";
import {
  buildHandoffDeliveryEnvelope,
  handoffDeliveryKey,
  parseHandoffDeliveryEnvelope,
  type HandoffDeliveryEnvelopeV1,
} from "../handoff-delivery/contract";
import {
  deliverHandoffEnvelope,
  getHandoffDeliveryConfig,
  missingHandoffDeliveryConfig,
  HANDOFF_DELIVERY_ENDPOINT_ENV,
  HANDOFF_DELIVERY_TOKEN_ENV,
  type HandoffDeliveryErrorCode,
  type HandoffDeliveryStatus,
} from "../handoff-delivery/transport";
import { isImplementationPermittedConclusion } from "../handoff";

/**
 * HIGH-1 — producer-side handoff delivery service.
 *
 * Responsibilities, in order:
 *   1. authorization: the caller must own the handoff's opportunity;
 *   2. contract: build the shared, versioned envelope from the PERSISTED
 *      contract, stamped with AIAgent's authoritative eligibility verdict;
 *   3. self-check: the envelope is parsed back through the receiver-side
 *      validator before anything leaves the process, so a producer bug is
 *      caught here rather than being blamed on the receiver;
 *   4. delivery: bounded, authenticated, timed-out attempt;
 *   5. audit: a durable HandoffDelivery row records the real outcome.
 *
 * What this service deliberately does NOT do:
 *   - it never delivers anything the receiver has not been told to expect;
 *   - it never reports success it did not observe;
 *   - it never triggers any downstream execution. Delivery hands AI Income Lab
 *     a handoff to consider; the receiving system applies its own human-review
 *     and execution gates.
 */

const MAX_ERROR_MESSAGE_LENGTH = 300;

/** What is true about cross-repository delivery right now, from real config. */
export interface HandoffDeliveryCapability {
  /** Never reported as live unless an endpoint AND credential are configured. */
  status: "NOT_CONFIGURED" | "CONFIGURED";
  detail: string;
  endpointConfigured: boolean;
  credentialConfigured: boolean;
  /** Environment variable names the operator must set. Never their values. */
  requiredEnvironmentVariables: readonly string[];
}

export function describeHandoffDelivery(
  env: Record<string, string | undefined> = process.env,
): HandoffDeliveryCapability {
  const config = getHandoffDeliveryConfig(env);
  const missing = missingHandoffDeliveryConfig(config);
  return {
    status: missing === "NONE" ? "CONFIGURED" : "NOT_CONFIGURED",
    detail:
      missing === "NONE"
        ? "A cross-repository handoff receiver is configured. Delivery is attempted only on an explicit, owner-scoped request and its outcome is recorded in HandoffDelivery."
        : "Cross-repository handoff delivery is NOT LIVE: no addressable, authenticated AI Income Lab receiver is configured, so AIAgent has no outbound transport. Handoffs remain an in-repository data boundary and nothing is ever reported as delivered.",
    endpointConfigured: Boolean(config.endpoint),
    credentialConfigured: Boolean(config.token),
    requiredEnvironmentVariables: [HANDOFF_DELIVERY_ENDPOINT_ENV, HANDOFF_DELIVERY_TOKEN_ENV],
  };
}

export interface HandoffDeliveryAudit {
  handoffId: string;
  idempotencyKey: string;
  status: HandoffDeliveryStatus;
  attemptCount: number;
  lastErrorCode: HandoffDeliveryErrorCode | null;
  lastErrorMessage: string | null;
  httpStatus: number | null;
  duplicate: boolean;
  requestedAt: string;
  deliveredAt: string | null;
}

function toAudit(row: {
  handoffId: string;
  idempotencyKey: string;
  status: string;
  attemptCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  httpStatus: number | null;
  duplicate: boolean;
  requestedAt: Date;
  deliveredAt: Date | null;
}): HandoffDeliveryAudit {
  return {
    handoffId: row.handoffId,
    idempotencyKey: row.idempotencyKey,
    status: row.status as HandoffDeliveryStatus,
    attemptCount: row.attemptCount,
    lastErrorCode: (row.lastErrorCode as HandoffDeliveryErrorCode | null) ?? null,
    lastErrorMessage: row.lastErrorMessage,
    httpStatus: row.httpStatus,
    duplicate: row.duplicate,
    requestedAt: row.requestedAt.toISOString(),
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
  };
}

/** Read the delivery audit trail for one handoff. Owner-scoped. */
export async function getHandoffDeliveryAudit(
  handoffId: string,
  ownerId: string,
): Promise<HandoffDeliveryAudit | null> {
  const handoff = await handoffRepository.getById(handoffId, ownerId);
  if (!handoff) return null;
  const row = await getPrisma().handoffDelivery.findFirst({ where: { handoffId } });
  return row ? toAudit(row) : null;
}

export type DeliverHandoffOutcome =
  | { ok: false; status: number; error: string }
  | { ok: true; capability: HandoffDeliveryCapability; delivery: HandoffDeliveryAudit };

/**
 * Attempt one cross-repository delivery of an owner-scoped handoff.
 *
 * Preconditions, all enforced here:
 *   - the handoff exists and belongs to the caller (404 otherwise);
 *   - the handoff has been ACCEPTED, i.e. a human already decided it may
 *     proceed. Delivery is never a way to bypass that decision.
 *
 * Idempotency: the `HandoffDelivery` row is upserted on the deterministic
 * `idempotencyKey`, so calling this repeatedly for the same handoff updates
 * one audit record rather than creating a second logical delivery, and the
 * receiver de-duplicates on exactly the same key.
 */
export async function deliverHandoff(handoffId: string, ownerId: string): Promise<DeliverHandoffOutcome> {
  const handoff = await handoffRepository.getById(handoffId, ownerId);
  if (!handoff) return { ok: false, status: 404, error: "Handoff not found" };
  if (handoff.status !== "ACCEPTED") {
    return {
      ok: false,
      status: 409,
      error: `Handoff ${handoff.id} is ${handoff.status}; only an ACCEPTED handoff can be delivered`,
    };
  }

  const prisma = getPrisma();
  const idempotencyKey = handoffDeliveryKey(handoff.id, handoff.contractVersion);

  // The authoritative gate decides implementation permission; the envelope
  // carries that verdict, it never recomputes it.
  const eligibleForImplementation = isImplementationPermittedConclusion(
    handoff.validationConclusion as Parameters<typeof isImplementationPermittedConclusion>[0],
  );
  if (!eligibleForImplementation) {
    return {
      ok: false,
      status: 422,
      error:
        "Handoff conclusion does not permit implementation, so it is not eligible for cross-repository delivery",
    };
  }

  const envelope: HandoffDeliveryEnvelopeV1 = buildHandoffDeliveryEnvelope({
    contract: handoff.contract,
    eligibleForImplementation: true,
  });

  // Self-check with the receiver-side validator: never put a payload on the
  // wire that our own receiver contract would refuse.
  const selfCheck = parseHandoffDeliveryEnvelope(JSON.parse(JSON.stringify(envelope)));
  if (!selfCheck.ok) {
    logger.operationalEvent({
      event: "HANDOFF_DELIVERY_CONTRACT_INVALID",
      safeMessage: `Handoff ${handoff.id} produced a delivery envelope the receiver contract rejects (${selfCheck.reason}).`,
      severity: "ERROR",
    });
    return {
      ok: false,
      status: 500,
      error: "The handoff could not be serialized into a valid delivery contract",
    };
  }

  await prisma.handoffDelivery.upsert({
    where: { idempotencyKey },
    create: {
      handoffId: handoff.id,
      idempotencyKey,
      contractVersion: envelope.contractVersion,
      status: "PENDING",
      requestedById: ownerId,
    },
    // Re-requesting refreshes who asked and when; the delivery verdict from a
    // previous attempt is overwritten only when this attempt produces a result.
    update: { requestedById: ownerId, requestedAt: new Date() },
  });

  const result = await deliverHandoffEnvelope(envelope, getHandoffDeliveryConfig());

  const deliveredAt = result.status === "DELIVERED" ? new Date() : null;
  const row = await prisma.handoffDelivery.update({
    where: { idempotencyKey },
    data: {
      status: result.status,
      attemptCount: result.attempts,
      lastErrorCode: "error" in result ? result.error.code : null,
      lastErrorMessage:
        "error" in result && result.error.message
          ? result.error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH)
          : null,
      httpStatus: result.status === "DELIVERED" ? result.httpStatus : "error" in result ? result.error.status : null,
      duplicate: result.status === "DELIVERED" ? result.duplicate : false,
      deliveredAt,
    },
  });

  // Operational trail only. The credential is never part of any of these.
  logger.operationalEvent({
    event:
      result.status === "DELIVERED"
        ? "HANDOFF_DELIVERY_ACCEPTED"
        : result.status === "NOT_CONFIGURED"
          ? "HANDOFF_DELIVERY_NOT_CONFIGURED"
          : "HANDOFF_DELIVERY_FAILED",
    safeMessage: `Handoff ${handoff.id} delivery status ${result.status} after ${result.attempts} attempt(s).`,
    severity: result.status === "DELIVERED" ? "INFO" : "WARNING",
  });

  return { ok: true, capability: describeHandoffDelivery(), delivery: toAudit(row) };
}
