/**
 * HIGH-1 — producer-side adaptation of AIAgent's nested numeric-v1 handoff
 * envelope onto the AI Income Lab receiver contract.
 *
 * The two repositories currently speak DIFFERENT wire contracts:
 *
 *   - AIAgent (this repository) produces a NESTED envelope with a numeric
 *     `contractVersion: 1` (`contract.ts`).
 *   - AI Income Lab's receiver (`POST /api/handoff/receive`, `main`) validates
 *     a FLAT envelope with a string `contractVersion: "1.0"`, a narrow
 *     `ALLOWED_ENVELOPE_FIELDS` allow-list (unknown top-level fields are a
 *     rejection), required `eventType`/`correlationId`/`businessModel`/
 *     `monetizationMethod`/`description` fields, and a bounded `payload`
 *     object (≤ 16 KB, depth ≤ 6, ≤ 50 counted keys/strings, strings
 *     ≤ 2000 characters, forbidden keys rejected).
 *
 * This module is the ONLY place the two shapes meet. It is deliberately pure,
 * deterministic and side-effect-free so it can be exhaustively unit-tested
 * without a network or a database.
 *
 * Honesty rules that govern the whole file:
 *
 *   1. NOTHING IS INVENTED. Every adapted field traces back to the persisted
 *      nested envelope or to the persisted `Opportunity.businessModel`. Where
 *      required data is missing, the adaptation is REFUSED — it never fabricates
 *      a placeholder.
 *   2. The producer's eligibility verdict is carried as `assertedEligibility`
 *      for AUDIT/PROVENANCE only. AI Income Lab recomputes eligibility from its
 *      own halal gate; a receiver-side refusal always wins.
 *   3. Identity is never truncated: `handoffId` and `idempotencyKey` pass
 *      through unchanged, or the adaptation refuses. The deterministic
 *      `aiagent-handoff:<handoffId>:v1` key is preserved byte-for-byte, so a
 *      retry is recognised as the same logical delivery by both sides.
 *   4. The payload is bounded BEFORE dispatch: every provenance string is
 *      truncated to the receiver's 2000-character bound and the serialized
 *      payload is checked against the receiver's 16 KB bound. With those
 *      per-string caps the payload cannot exceed the byte bound in practice;
 *      the size check remains as a defensive refusal, never as silent clipping.
 */

import {
  HANDOFF_DELIVERY_CONTRACT_ID,
  SUPPORTED_HANDOFF_DELIVERY_CONTRACT_VERSIONS,
  type HandoffDeliveryEnvelopeV1,
} from "./contract";

// ---------------------------------------------------------------------------
// Receiver contract constants (AI Income Lab `main`, handoff-envelope.ts)
// ---------------------------------------------------------------------------

/** The only wire contract version the AI Income Lab receiver accepts today. */
export const AI_INCOME_LAB_RECEIVER_CONTRACT_VERSION = "1.0" as const;

/** The only event type the receiver accepts, and the one we always send. */
export const AI_INCOME_LAB_HANDOFF_EVENT_TYPE = "OPPORTUNITY_PROPOSED" as const;

/** The receiver's eligibility assertion vocabulary (audit-only information). */
export type IncomeLabAssertedEligibility = "ALLOWED" | "REVIEW_REQUIRED" | "NOT_ALLOWED";

/** Receiver bounds mirrored from its published contract (`docs/handoff-receiver-high1.md`). */
const RECEIVER_MAX_TITLE = 300;
const RECEIVER_MAX_CATEGORY = 200;
const RECEIVER_MAX_BUSINESS_MODEL = 200;
const RECEIVER_MAX_MONETIZATION_METHOD = 200;
const RECEIVER_MAX_CORRELATION_ID = 200;
const RECEIVER_MAX_IDEMPOTENCY_KEY = 200;
const RECEIVER_MAX_CONTRACT_ID = 200;
const RECEIVER_MAX_HANDOFF_ID = 128;
const RECEIVER_MAX_FIELD = 2_000;
const RECEIVER_MAX_PAYLOAD_BYTES = 16 * 1024;

// ---------------------------------------------------------------------------
// Adapted envelope shape
// ---------------------------------------------------------------------------

/** The flat wire envelope. Exactly the receiver's allow-listed fields. */
export interface IncomeLabAdaptedEnvelope {
  contractVersion: string;
  contractId: string;
  idempotencyKey: string;
  correlationId: string;
  eventType: typeof AI_INCOME_LAB_HANDOFF_EVENT_TYPE;
  title: string;
  description: string;
  category: string;
  businessModel: string;
  monetizationMethod: string;
  assertedEligibility: IncomeLabAssertedEligibility;
  /** Bounded, opaque structured data. Never executed by the receiver. */
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/**
 * Deterministic reasons the adaptation refuses to produce a wire payload.
 * A refusal is a producer-side validation decision: nothing is sent, and the
 * delivery service records it durably instead of inventing data to send.
 */
export type AdaptationRefusalReason =
  | "MALFORMED_ENVELOPE"
  | "UNSUPPORTED_CONTRACT_ID"
  | "UNSUPPORTED_CONTRACT_VERSION"
  | "MISSING_HANDOFF_ID"
  | "MISSING_IDEMPOTENCY_KEY"
  | "MISSING_TITLE"
  | "MISSING_PROBLEM"
  | "MISSING_CATEGORY"
  | "MISSING_BUSINESS_MODEL"
  | "MISSING_MONETIZATION_METHOD"
  | "PAYLOAD_TOO_LARGE";

export interface AdaptationRefusal {
  ok: false;
  reason: AdaptationRefusalReason;
  /** Dotted path or input name of the offending data, when field-scoped. */
  field?: string;
}

export interface AdaptationSuccess {
  ok: true;
  envelope: IncomeLabAdaptedEnvelope;
}

export type AdaptationResult = AdaptationSuccess | AdaptationRefusal;

export interface AdaptHandoffEnvelopeInput {
  /** The nested numeric-v1 envelope AIAgent's delivery service produced. */
  envelope: HandoffDeliveryEnvelopeV1;
  /**
   * The persisted `Opportunity.businessModel` of the handoff's opportunity.
   * The nested envelope does not carry it; the receiver requires it. Taken
   * from stored data only — never inferred, never defaulted.
   */
  businessModel: string | null | undefined;
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Bounded string: trim, refuse when empty, deterministically truncate. */
function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLength);
}

/** Deterministic prose for the receiver's `description`: the problem itself. */
function buildDescription(envelope: HandoffDeliveryEnvelopeV1): string | null {
  return boundedText(envelope.opportunity?.problem, RECEIVER_MAX_FIELD);
}

/** Joined monetization methods; the exact inverse of AIAgent's own split. */
function buildMonetizationMethod(envelope: HandoffDeliveryEnvelopeV1): string | null {
  const methods = envelope.opportunity?.monetizationMethods;
  if (!Array.isArray(methods)) return null;
  const joined = methods
    .map((method) => (typeof method === "string" ? method.trim() : ""))
    .filter(Boolean)
    .join("; ");
  if (joined.length === 0) return null;
  return joined.slice(0, RECEIVER_MAX_MONETIZATION_METHOD);
}

/**
 * Map the producer's eligibility verdict into the receiver's assertion
 * vocabulary. AUDIT ONLY: the receiver records it and recomputes the effective
 * verdict from its own halal gate, so this mapping can never widen permission.
 */
function buildAssertedEligibility(envelope: HandoffDeliveryEnvelopeV1): IncomeLabAssertedEligibility {
  return envelope.validation?.eligibleForImplementation === true ? "ALLOWED" : "REVIEW_REQUIRED";
}

/**
 * Bounded provenance payload: nested source, validation, opportunity and
 * experiment information the receiver stores as opaque JSON. Every string is
 * truncated to the receiver's bound and the key/string budget stays below the
 * receiver's 50-key limit, so a valid nested envelope always fits.
 */
function buildPayload(envelope: HandoffDeliveryEnvelopeV1): Record<string, unknown> {
  const joinList = (items: unknown): string => {
    if (!Array.isArray(items)) return "";
    return items
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .join("; ")
      .slice(0, RECEIVER_MAX_FIELD);
  };

  const evidenceRefs = Array.isArray(envelope.evidence)
    ? envelope.evidence
        .map((item) =>
          [
            typeof item?.evidenceId === "string" ? item.evidenceId : "",
            typeof item?.source === "string" ? item.source : "",
            typeof item?.url === "string" ? item.url : "",
            typeof item?.title === "string" ? item.title : "",
            Array.isArray(item?.supports) ? item.supports.filter((s) => typeof s === "string").join(",") : "",
          ].join("|"),
        )
        .join("\n")
        .slice(0, RECEIVER_MAX_FIELD)
    : "";

  return {
    producer: {
      contractId: envelope.contractId,
      contractVersion: envelope.contractVersion,
      handoffId: envelope.handoffId,
      sourceOpportunityId: envelope.sourceOpportunityId,
      sourceSystem: envelope.sourceSystem,
      targetSystem: envelope.targetSystem,
      issuedAt: envelope.issuedAt,
    },
    validation: {
      conclusion: envelope.validation?.conclusion ?? null,
      confidence: envelope.validation?.confidence ?? null,
      score: envelope.validation?.score ?? null,
      eligibleForImplementation: envelope.validation?.eligibleForImplementation === true,
      handoffStatus: envelope.validation?.handoffStatus ?? null,
    },
    opportunity: {
      targetAudience: boundedText(envelope.opportunity?.targetAudience, RECEIVER_MAX_FIELD) ?? "",
      risks: joinList(envelope.opportunity?.risks),
      monetizationMethods: joinList(envelope.opportunity?.monetizationMethods),
    },
    experiment: {
      recommendedType: envelope.experiment?.recommendedType ?? null,
      hypothesis: boundedText(envelope.experiment?.hypothesis, RECEIVER_MAX_FIELD) ?? "",
      successCriteria: joinList(envelope.experiment?.successCriteria),
      budgetLimit: envelope.experiment?.budgetLimit ?? null,
      timeLimitDays: envelope.experiment?.timeLimitDays ?? null,
    },
    evidenceRefs,
  };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/**
 * Adapt one nested numeric-v1 delivery envelope onto the AI Income Lab flat
 * "1.0" receiver contract.
 *
 * Deterministic: the same input always produces byte-identical output, so a
 * retried delivery is recognised as the same logical delivery end to end.
 * Refusing: missing required data produces a typed refusal, never a guessed
 * field. Bounded: every string is capped at the receiver's published limits
 * and the payload is size-checked before anything can go on the wire.
 */
export function adaptHandoffEnvelopeForIncomeLab(input: AdaptHandoffEnvelopeInput): AdaptationResult {
  const { envelope } = input;

  // ---- structural guard: refuse anything that is not a producer envelope ---
  if (!isPlainObject(envelope)) {
    return { ok: false, reason: "MALFORMED_ENVELOPE", field: "envelope" };
  }
  if (envelope.contractId !== HANDOFF_DELIVERY_CONTRACT_ID) {
    return { ok: false, reason: "UNSUPPORTED_CONTRACT_ID", field: "contractId" };
  }
  if (!SUPPORTED_HANDOFF_DELIVERY_CONTRACT_VERSIONS.includes(envelope.contractVersion)) {
    return { ok: false, reason: "UNSUPPORTED_CONTRACT_VERSION", field: "contractVersion" };
  }
  if (!isPlainObject(envelope.opportunity)) {
    return { ok: false, reason: "MALFORMED_ENVELOPE", field: "opportunity" };
  }

  // ---- identity: preserved exactly, never truncated ------------------------
  const rawHandoffId = typeof envelope.handoffId === "string" ? envelope.handoffId.trim() : "";
  if (rawHandoffId.length === 0) {
    return { ok: false, reason: "MISSING_HANDOFF_ID", field: "handoffId" };
  }
  if (rawHandoffId.length > RECEIVER_MAX_HANDOFF_ID) {
    return { ok: false, reason: "MALFORMED_ENVELOPE", field: "handoffId" };
  }

  const rawIdempotencyKey =
    typeof envelope.idempotencyKey === "string" ? envelope.idempotencyKey.trim() : "";
  if (rawIdempotencyKey.length === 0) {
    return { ok: false, reason: "MISSING_IDEMPOTENCY_KEY", field: "idempotencyKey" };
  }
  if (rawIdempotencyKey.length > RECEIVER_MAX_IDEMPOTENCY_KEY) {
    return { ok: false, reason: "MALFORMED_ENVELOPE", field: "idempotencyKey" };
  }

  // ---- required receiver fields, taken only from persisted data ------------

  const title = boundedText(envelope.opportunity.title, RECEIVER_MAX_TITLE);
  if (!title) return { ok: false, reason: "MISSING_TITLE", field: "opportunity.title" };

  const description = buildDescription(envelope);
  if (!description) return { ok: false, reason: "MISSING_PROBLEM", field: "opportunity.problem" };

  const category = boundedText(envelope.opportunity.category, RECEIVER_MAX_CATEGORY);
  if (!category) return { ok: false, reason: "MISSING_CATEGORY", field: "opportunity.category" };

  const businessModel = boundedText(input.businessModel, RECEIVER_MAX_BUSINESS_MODEL);
  if (!businessModel) {
    return { ok: false, reason: "MISSING_BUSINESS_MODEL", field: "opportunity.businessModel" };
  }

  const monetizationMethod = buildMonetizationMethod(envelope);
  if (!monetizationMethod) {
    return {
      ok: false,
      reason: "MISSING_MONETIZATION_METHOD",
      field: "opportunity.monetizationMethods",
    };
  }

  const payload = buildPayload(envelope);
  // The receiver measures exactly this string; enforce its bound here so an
  // unboundable payload is refused producer-side instead of answered 400.
  if (JSON.stringify(payload).length > RECEIVER_MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: "PAYLOAD_TOO_LARGE", field: "payload" };
  }

  return {
    ok: true,
    envelope: {
      contractVersion: AI_INCOME_LAB_RECEIVER_CONTRACT_VERSION,
      // Provenance: the receiver accepts any contract id ≤ 200 characters and
      // records it on the persisted handoff row.
      contractId: HANDOFF_DELIVERY_CONTRACT_ID.slice(0, RECEIVER_MAX_CONTRACT_ID),
      idempotencyKey: rawIdempotencyKey,
      correlationId: `aiagent-handoff:${rawHandoffId}`.slice(0, RECEIVER_MAX_CORRELATION_ID),
      eventType: AI_INCOME_LAB_HANDOFF_EVENT_TYPE,
      title,
      description,
      category,
      businessModel,
      monetizationMethod,
      assertedEligibility: buildAssertedEligibility(envelope),
      payload,
    },
  };
}
