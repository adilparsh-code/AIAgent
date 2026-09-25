import type { ResearchConclusion } from "../research-types";
import type {
  HandoffStatus,
  OpportunityHandoffContract,
  HandoffRecommendedExperimentType,
} from "../handoff";

/**
 * HIGH-1 — cross-repository handoff delivery contract (AIAgent → AI Income Lab).
 *
 * This module is the ONLY agreed wire format between the two repositories. It
 * is deliberately dependency-free and side-effect-free so that BOTH sides can
 * use the exact same definition:
 *
 *   - producer side: `buildHandoffDeliveryEnvelope` turns a persisted
 *     `OpportunityHandoffContract` into the envelope that is delivered;
 *   - receiver side: `parseHandoffDeliveryEnvelope` validates an untrusted
 *     inbound payload and either returns a typed envelope or refuses it with
 *     explicit, machine-readable reasons.
 *
 * Two deliberate properties:
 *
 *  1. The eligibility decision is NEVER re-derived here. `eligibleForImplementation`
 *     is carried from AIAgent's single authoritative gate
 *     (`src/lib/handoff.ts` → `HANDOFF_IMPLEMENTATION_PERMITTED_CONCLUSIONS`).
 *     The receiver must not compute its own opinion, or the two repositories
 *     drift apart again (this is exactly what HIGH-2 was about).
 *
 *  2. Nothing is invented. Every field traces back to a persisted
 *     `OpportunityHandoffContract` produced from stored opportunity/research
 *     data. Where a value is unknown it stays `null` — it is never guessed.
 *
 * This file defines a CONTRACT ONLY. It contains no endpoint, no URL, no
 * credential and no transport; see `transport.ts` for the producer's
 * delivery mechanics and `../server/handoff-delivery-service.ts` for the
 * durable delivery state.
 */

/** Stable identifier of the wire contract. A receiver MUST reject an unknown id. */
export const HANDOFF_DELIVERY_CONTRACT_ID = "aiagent.income-lab.opportunity-handoff" as const;

/** The only contract version this build produces and accepts. */
export const HANDOFF_DELIVERY_CONTRACT_VERSION = 1 as const;

/** Contract versions this build can speak. */
export const SUPPORTED_HANDOFF_DELIVERY_CONTRACT_VERSIONS: readonly number[] = [1] as const;

/** Source system, as written into every envelope. */
export const HANDOFF_DELIVERY_SOURCE_SYSTEM = "AIAGENT" as const;

/** Target system, as written into every envelope. */
export const HANDOFF_DELIVERY_TARGET_SYSTEM = "AI_INCOME_LAB" as const;

/**
 * Deterministic delivery/idempotency key.
 *
 * The same handoff always produces the same key, so a retry — from any
 * process, at any time — is recognised by the receiver as a replay of the
 * same logical delivery and must not create a second downstream experiment.
 * This is the same invariant HIGH-4 enforces locally through
 * `Experiment.handoffId`'s unique index.
 */
export function handoffDeliveryKey(handoffId: string, contractVersion: number = HANDOFF_DELIVERY_CONTRACT_VERSION): string {
  return `aiagent-handoff:${handoffId}:v${contractVersion}`;
}

/** Validation/decision state carried from AIAgent's authoritative gate. */
export interface HandoffDeliveryValidation {
  /** Evidence-driven research conclusion, or null when unknown. */
  conclusion: ResearchConclusion | null;
  /** Recorded research confidence, or null. */
  confidence: number | null;
  /** Recorded research score, or null. */
  score: number | null;
  /**
   * AIAgent's handoff gate verdict. The receiver records it; it never
   * recomputes it.
   */
  eligibleForImplementation: boolean;
  /** AIAgent-side handoff lifecycle state at delivery time. */
  handoffStatus: HandoffStatus;
}

/** Opportunity data required downstream to act without another round trip. */
export interface HandoffDeliveryOpportunity {
  title: string;
  category: string;
  targetAudience: string;
  problem: string;
  monetizationMethods: string[];
  risks: string[];
}

/** The experiment the receiver is asked to consider (never to auto-execute). */
export interface HandoffDeliveryExperiment {
  recommendedType: HandoffRecommendedExperimentType;
  hypothesis: string;
  successCriteria: string[];
  budgetLimit: number | null;
  timeLimitDays: number | null;
}

/** Evidence reference information. Full evidence rows never leave AIAgent. */
export interface HandoffDeliveryEvidenceRef {
  evidenceId: string;
  source: string;
  url: string;
  title: string;
  supports: string[];
}

export interface HandoffDeliveryEnvelopeV1 {
  contractId: typeof HANDOFF_DELIVERY_CONTRACT_ID;
  contractVersion: 1;
  /** AIAgent's handoff id. Also the receiver's natural foreign key. */
  handoffId: string;
  /** Deterministic duplicate-delivery guard. See `handoffDeliveryKey`. */
  idempotencyKey: string;
  sourceSystem: typeof HANDOFF_DELIVERY_SOURCE_SYSTEM;
  targetSystem: typeof HANDOFF_DELIVERY_TARGET_SYSTEM;
  /** The opportunity this handoff was created from, in AIAgent. */
  sourceOpportunityId: string;
  validation: HandoffDeliveryValidation;
  opportunity: HandoffDeliveryOpportunity;
  experiment: HandoffDeliveryExperiment;
  evidence: HandoffDeliveryEvidenceRef[];
  /** ISO-8601 timestamp of when the envelope was produced. */
  issuedAt: string;
}

export type HandoffDeliveryEnvelope = HandoffDeliveryEnvelopeV1;

// ---------------------------------------------------------------------------
// Producer side
// ---------------------------------------------------------------------------

export interface BuildHandoffEnvelopeInput {
  contract: OpportunityHandoffContract;
  /**
   * AIAgent's handoff gate verdict, taken from `evaluateHandoffEligibility`
   * (or the discovery projection of the same gate). Required so the envelope
   * can never ship without an explicit, authoritative eligibility decision.
   */
  eligibleForImplementation: boolean;
  /** Injectable clock; defaults to now. */
  issuedAt?: string;
}

/**
 * Build the wire envelope from a persisted handoff contract.
 *
 * Every field is copied from the contract; nothing is re-derived, so a
 * transport bug can never make the two repositories disagree about the
 * opportunity's state.
 */
export function buildHandoffDeliveryEnvelope(input: BuildHandoffEnvelopeInput): HandoffDeliveryEnvelopeV1 {
  const { contract } = input;
  const version = contract.contractVersion;
  return {
    contractId: HANDOFF_DELIVERY_CONTRACT_ID,
    contractVersion: version,
    handoffId: contract.handoffId,
    idempotencyKey: handoffDeliveryKey(contract.handoffId, version),
    sourceSystem: HANDOFF_DELIVERY_SOURCE_SYSTEM,
    targetSystem: HANDOFF_DELIVERY_TARGET_SYSTEM,
    sourceOpportunityId: contract.opportunityId,
    validation: {
      conclusion: contract.validationConclusion,
      confidence: contract.confidence,
      score: contract.score,
      eligibleForImplementation: input.eligibleForImplementation,
      handoffStatus: contract.handoffStatus,
    },
    opportunity: {
      title: contract.title,
      category: contract.category,
      targetAudience: contract.targetAudience,
      problem: contract.problem,
      monetizationMethods: contract.monetizationOptions.map((option) => option.method),
      risks: [...contract.risks],
    },
    experiment: {
      recommendedType: contract.recommendedExperiment,
      hypothesis: contract.experimentHypothesis,
      successCriteria: [...contract.successCriteria],
      budgetLimit: contract.budgetLimit,
      timeLimitDays: contract.timeLimitDays,
    },
    evidence: contract.evidence.map((item) => ({
      evidenceId: item.evidenceId,
      source: item.source,
      url: item.url,
      title: item.title,
      supports: [...item.supports],
    })),
    issuedAt: input.issuedAt ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Receiver side
// ---------------------------------------------------------------------------

/**
 * Machine-readable reasons a receiver must refuse an envelope. Every refusal
 * maps to an HTTP status the producer understands, so an unsupported version
 * is never silently "accepted" with partial data.
 */
export type HandoffDeliveryRejectionReason =
  | "MALFORMED_JSON"
  | "UNSUPPORTED_CONTRACT_ID"
  | "UNSUPPORTED_CONTRACT_VERSION"
  | "MISSING_FIELD"
  | "FIELD_TOO_LONG"
  | "INVALID_TYPE"
  | "INVALID_ENUM_VALUE"
  | "IDEMPOTENCY_KEY_MISMATCH"
  | "WRONG_SOURCE_SYSTEM"
  | "WRONG_TARGET_SYSTEM"
  | "NOT_IMPLEMENTATION_ELIGIBLE";

export interface HandoffDeliveryRejection {
  ok: false;
  reason: HandoffDeliveryRejectionReason;
  /** Dotted path of the offending field, when the refusal is field-scoped. */
  field?: string;
  /** HTTP status a receiver should answer with. */
  status: 400 | 401 | 403 | 409 | 422;
}

export interface HandoffDeliveryAcceptance {
  ok: true;
  envelope: HandoffDeliveryEnvelopeV1;
}

export type HandoffDeliveryParseResult = HandoffDeliveryAcceptance | HandoffDeliveryRejection;

const MAX_ID_LENGTH = 128;
const MAX_SHORT_TEXT = 500;
const MAX_LONG_TEXT = 4_000;
const MAX_LIST_ITEMS = 50;
const MAX_EVIDENCE_ITEMS = 25;

const VALID_CONCLUSIONS: readonly string[] = [
  "VALIDATED",
  "PROMISING",
  "INSUFFICIENT_EVIDENCE",
  "CONTRADICTED",
  "REQUIRES_HUMAN_REVIEW",
  "REJECTED",
];

const VALID_HANDOFF_STATUSES: readonly string[] = [
  "DRAFT",
  "HANDOFF_READY",
  "ACCEPTED",
  "REJECTED",
  "COMPLETED",
];

const VALID_EXPERIMENT_TYPES: readonly string[] = ["MVP_BUILD", "ASSET_LAUNCH"];

function reject(
  reason: HandoffDeliveryRejectionReason,
  field?: string,
  status: HandoffDeliveryRejection["status"] = 400,
): HandoffDeliveryRejection {
  return field === undefined ? { ok: false, reason, status } : { ok: false, reason, field, status };
}

function requireString(
  value: unknown,
  path: string,
  maxLength: number,
): string | HandoffDeliveryRejection {
  if (value === undefined || value === null) return reject("MISSING_FIELD", path);
  if (typeof value !== "string") return reject("INVALID_TYPE", path);
  if (value.length === 0) return reject("MISSING_FIELD", path);
  if (value.length > maxLength) return reject("FIELD_TOO_LONG", path);
  return value;
}

function requireNullableNumber(value: unknown, path: string): number | null | HandoffDeliveryRejection {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return reject("INVALID_TYPE", path);
  return value;
}

function requireEnum(
  value: unknown,
  path: string,
  allowed: readonly string[],
): string | HandoffDeliveryRejection {
  const text = requireString(value, path, MAX_SHORT_TEXT);
  if (typeof text !== "string") return text;
  if (!allowed.includes(text)) return reject("INVALID_ENUM_VALUE", path);
  return text;
}

function requireStringList(
  value: unknown,
  path: string,
  maxLength: number,
): string[] | HandoffDeliveryRejection {
  if (!Array.isArray(value)) return reject("INVALID_TYPE", path);
  if (value.length > MAX_LIST_ITEMS) return reject("FIELD_TOO_LONG", path);
  const out: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = requireString(value[i], `${path}[${i}]`, maxLength);
    if (typeof item !== "string") return item;
    out.push(item);
  }
  return out;
}

function isRejection(value: unknown): value is HandoffDeliveryRejection {
  return typeof value === "object" && value !== null && (value as HandoffDeliveryRejection).ok === false;
}

function asRecord(value: unknown, path: string): Record<string, unknown> | HandoffDeliveryRejection {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return reject("INVALID_TYPE", path);
  }
  return value as Record<string, unknown>;
}

/**
 * Receiver-side validation of an untrusted delivery.
 *
 * This is the symmetric counterpart of `buildHandoffDeliveryEnvelope` and the
 * single definition the AI Income Lab receiver must agree with. It is exported
 * (and unit-tested) here so the two repositories can prove they speak the same
 * contract without either side inventing an endpoint.
 *
 * A receiver MUST refuse (never partially accept):
 *   - an unknown `contractId` or `contractVersion`;
 *   - a payload whose `idempotencyKey` does not equal
 *     `handoffDeliveryKey(handoffId, contractVersion)`;
 *   - a payload addressed to another source or target system;
 *   - a handoff AIAgent's own gate marked as not implementation-eligible —
 *     a receiver must not execute work AIAgent explicitly gated off.
 */
export function parseHandoffDeliveryEnvelope(input: unknown): HandoffDeliveryParseResult {
  const root = asRecord(input, "payload");
  if (isRejection(root)) return root;

  if (root.contractId !== HANDOFF_DELIVERY_CONTRACT_ID) return reject("UNSUPPORTED_CONTRACT_ID", "contractId");
  if (typeof root.contractVersion !== "number" || !Number.isInteger(root.contractVersion)) {
    return reject("INVALID_TYPE", "contractVersion");
  }
  if (!SUPPORTED_HANDOFF_DELIVERY_CONTRACT_VERSIONS.includes(root.contractVersion)) {
    return reject("UNSUPPORTED_CONTRACT_VERSION", "contractVersion");
  }
  if (root.sourceSystem !== HANDOFF_DELIVERY_SOURCE_SYSTEM) return reject("WRONG_SOURCE_SYSTEM", "sourceSystem");
  if (root.targetSystem !== HANDOFF_DELIVERY_TARGET_SYSTEM) return reject("WRONG_TARGET_SYSTEM", "targetSystem");

  const handoffId = requireString(root.handoffId, "handoffId", MAX_ID_LENGTH);
  if (isRejection(handoffId)) return handoffId;

  const sourceOpportunityId = requireString(root.sourceOpportunityId, "sourceOpportunityId", MAX_ID_LENGTH);
  if (isRejection(sourceOpportunityId)) return sourceOpportunityId;

  const idempotencyKey = requireString(root.idempotencyKey, "idempotencyKey", MAX_ID_LENGTH);
  if (isRejection(idempotencyKey)) return idempotencyKey;
  // A mismatched key means the sender's own duplicate-delivery guard is not
  // trustworthy; refuse rather than derive a "probably right" key.
  if (idempotencyKey !== handoffDeliveryKey(handoffId, root.contractVersion)) {
    return reject("IDEMPOTENCY_KEY_MISMATCH", "idempotencyKey");
  }

  const issuedAt = requireString(root.issuedAt, "issuedAt", MAX_SHORT_TEXT);
  if (isRejection(issuedAt)) return issuedAt;
  if (Number.isNaN(new Date(issuedAt).getTime())) return reject("INVALID_TYPE", "issuedAt");

  const validation = asRecord(root.validation, "validation");
  if (isRejection(validation)) return validation;

  const conclusion =
    validation.conclusion === null
      ? null
      : requireEnum(validation.conclusion, "validation.conclusion", VALID_CONCLUSIONS);
  if (isRejection(conclusion)) return conclusion;
  const confidence = requireNullableNumber(validation.confidence, "validation.confidence");
  if (isRejection(confidence)) return confidence;
  const score = requireNullableNumber(validation.score, "validation.score");
  if (isRejection(score)) return score;
  if (typeof validation.eligibleForImplementation !== "boolean") {
    return reject("INVALID_TYPE", "validation.eligibleForImplementation");
  }
  const handoffStatus = requireEnum(validation.handoffStatus, "validation.handoffStatus", VALID_HANDOFF_STATUSES);
  if (isRejection(handoffStatus)) return handoffStatus;
  // AIAgent's gate said this handoff may not be implemented. The receiver must
  // not act on it; it may still record it for auditability.
  if (validation.eligibleForImplementation === false) {
    return reject("NOT_IMPLEMENTATION_ELIGIBLE", "validation.eligibleForImplementation", 422);
  }

  const opportunity = asRecord(root.opportunity, "opportunity");
  if (isRejection(opportunity)) return opportunity;
  const title = requireString(opportunity.title, "opportunity.title", MAX_LONG_TEXT);
  if (isRejection(title)) return title;
  const category = requireString(opportunity.category, "opportunity.category", MAX_SHORT_TEXT);
  if (isRejection(category)) return category;
  const targetAudience = requireString(opportunity.targetAudience, "opportunity.targetAudience", MAX_LONG_TEXT);
  if (isRejection(targetAudience)) return targetAudience;
  const problem = requireString(opportunity.problem, "opportunity.problem", MAX_LONG_TEXT);
  if (isRejection(problem)) return problem;
  const monetizationMethods = requireStringList(
    opportunity.monetizationMethods,
    "opportunity.monetizationMethods",
    MAX_SHORT_TEXT,
  );
  if (isRejection(monetizationMethods)) return monetizationMethods;
  const risks = requireStringList(opportunity.risks, "opportunity.risks", MAX_LONG_TEXT);
  if (isRejection(risks)) return risks;

  const experiment = asRecord(root.experiment, "experiment");
  if (isRejection(experiment)) return experiment;
  const recommendedType = requireEnum(
    experiment.recommendedType,
    "experiment.recommendedType",
    VALID_EXPERIMENT_TYPES,
  );
  if (isRejection(recommendedType)) return recommendedType;
  const hypothesis = requireString(experiment.hypothesis, "experiment.hypothesis", MAX_LONG_TEXT);
  if (isRejection(hypothesis)) return hypothesis;
  const successCriteria = requireStringList(experiment.successCriteria, "experiment.successCriteria", MAX_LONG_TEXT);
  if (isRejection(successCriteria)) return successCriteria;
  const budgetLimit = requireNullableNumber(experiment.budgetLimit, "experiment.budgetLimit");
  if (isRejection(budgetLimit)) return budgetLimit;
  const timeLimitDays = requireNullableNumber(experiment.timeLimitDays, "experiment.timeLimitDays");
  if (isRejection(timeLimitDays)) return timeLimitDays;

  if (!Array.isArray(root.evidence)) return reject("INVALID_TYPE", "evidence");
  if (root.evidence.length > MAX_EVIDENCE_ITEMS) return reject("FIELD_TOO_LONG", "evidence");
  const evidence: HandoffDeliveryEvidenceRef[] = [];
  for (let i = 0; i < root.evidence.length; i += 1) {
    const path = `evidence[${i}]`;
    const item = asRecord(root.evidence[i], path);
    if (isRejection(item)) return item;
    const evidenceId = requireString(item.evidenceId, `${path}.evidenceId`, MAX_ID_LENGTH);
    if (isRejection(evidenceId)) return evidenceId;
    const source = requireString(item.source, `${path}.source`, MAX_SHORT_TEXT);
    if (isRejection(source)) return source;
    const url = requireString(item.url, `${path}.url`, MAX_LONG_TEXT);
    if (isRejection(url)) return url;
    const itemTitle = requireString(item.title, `${path}.title`, MAX_LONG_TEXT);
    if (isRejection(itemTitle)) return itemTitle;
    const supports = requireStringList(item.supports, `${path}.supports`, MAX_SHORT_TEXT);
    if (isRejection(supports)) return supports;
    evidence.push({ evidenceId, source, url, title: itemTitle, supports });
  }

  return {
    ok: true,
    envelope: {
      contractId: HANDOFF_DELIVERY_CONTRACT_ID,
      contractVersion: HANDOFF_DELIVERY_CONTRACT_VERSION,
      handoffId,
      idempotencyKey,
      sourceSystem: HANDOFF_DELIVERY_SOURCE_SYSTEM,
      targetSystem: HANDOFF_DELIVERY_TARGET_SYSTEM,
      sourceOpportunityId,
      validation: {
        conclusion: conclusion as ResearchConclusion | null,
        confidence,
        score,
        eligibleForImplementation: true,
        handoffStatus: handoffStatus as HandoffStatus,
      },
      opportunity: {
        title,
        category,
        targetAudience,
        problem,
        monetizationMethods,
        risks,
      },
      experiment: {
        recommendedType: recommendedType as HandoffRecommendedExperimentType,
        hypothesis,
        successCriteria,
        budgetLimit,
        timeLimitDays,
      },
      evidence,
      issuedAt,
    },
  };
}
