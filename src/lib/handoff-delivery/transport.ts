/**
 * HIGH-1 — producer-side transport mechanics for the AIAgent → AI Income Lab
 * handoff delivery.
 *
 * This file owns the parts of delivery that are about the NETWORK, and nothing
 * about the business decision:
 *
 *   - explicit configuration (no built-in endpoint, ever);
 *   - peer authentication with a server-side shared secret;
 *   - a hard per-attempt timeout;
 *   - bounded retries with backoff, only for genuinely transient failures;
 *   - a typed outcome that distinguishes "the receiver refused this" from
 *     "we could not reach the receiver" from "we are not configured at all".
 *
 * Honesty rule that governs the whole file: when the endpoint or the credential
 * is absent, the outcome is NOT_CONFIGURED. It is never "delivered", never a
 * silent no-op, and never a mock. AIAgent does not ship a default AI Income Lab
 * URL — inventing one would create an integration that only appears to work.
 */

import type { HandoffDeliveryEnvelope } from "./contract";

/** Environment variables that configure the transport. Both are server-side only. */
export const HANDOFF_DELIVERY_ENDPOINT_ENV = "AI_INCOME_LAB_HANDOFF_ENDPOINT";
export const HANDOFF_DELIVERY_TOKEN_ENV = "AI_INCOME_LAB_HANDOFF_TOKEN";
export const HANDOFF_DELIVERY_TIMEOUT_ENV = "AI_INCOME_LAB_HANDOFF_TIMEOUT_MS";

/** Hard ceiling on a single delivery attempt. */
export const HANDOFF_DELIVERY_TIMEOUT_MS_DEFAULT = 10_000;
export const HANDOFF_DELIVERY_TIMEOUT_MS_MIN = 1_000;
export const HANDOFF_DELIVERY_TIMEOUT_MS_MAX = 60_000;

/** Bounded retry policy. Attempts include the first try. */
export const HANDOFF_DELIVERY_MAX_ATTEMPTS = 3;
export const HANDOFF_DELIVERY_BACKOFF_MS_BASE = 500;
export const HANDOFF_DELIVERY_BACKOFF_MS_CAP = 8_000;

const MAX_ENDPOINT_LENGTH = 300;
const MIN_TOKEN_LENGTH = 32;

export interface HandoffDeliveryConfig {
  /** Absolute https URL of the receiver. Null when not configured. */
  endpoint: string | null;
  /** Bearer credential presented to the receiver. Never logged or persisted. */
  token: string | null;
  timeoutMs: number;
  maxAttempts: number;
}

/**
 * Read and validate the transport configuration.
 *
 * Fails CLOSED: a value that is present but unusable (plain http, a
 * non-absolute URL, a too-short credential) is treated as NOT configured
 * rather than being used "best effort".
 */
export function getHandoffDeliveryConfig(
  env: Record<string, string | undefined> = process.env,
): HandoffDeliveryConfig {
  const rawEndpoint = (env[HANDOFF_DELIVERY_ENDPOINT_ENV] ?? "").trim();
  const rawToken = (env[HANDOFF_DELIVERY_TOKEN_ENV] ?? "").trim();
  const rawTimeout = Number(env[HANDOFF_DELIVERY_TIMEOUT_ENV]);

  let endpoint: string | null = null;
  if (rawEndpoint.length > 0 && rawEndpoint.length <= MAX_ENDPOINT_LENGTH) {
    try {
      const url = new URL(rawEndpoint);
      // HTTPS only. A plaintext delivery would put the bearer credential and
      // the handoff payload on the wire in the clear.
      if (url.protocol === "https:" && url.hostname.length > 0) endpoint = url.toString();
    } catch {
      endpoint = null;
    }
  }

  const token = rawToken.length >= MIN_TOKEN_LENGTH ? rawToken : null;

  const timeoutMs =
    Number.isFinite(rawTimeout) && rawTimeout >= HANDOFF_DELIVERY_TIMEOUT_MS_MIN && rawTimeout <= HANDOFF_DELIVERY_TIMEOUT_MS_MAX
      ? Math.floor(rawTimeout)
      : HANDOFF_DELIVERY_TIMEOUT_MS_DEFAULT;

  return { endpoint, token, timeoutMs, maxAttempts: HANDOFF_DELIVERY_MAX_ATTEMPTS };
}

/** Which half of the contract is missing, for an honest operator message. */
export type HandoffDeliveryMissingConfig = "ENDPOINT" | "TOKEN" | "BOTH" | "NONE";

export function missingHandoffDeliveryConfig(config: HandoffDeliveryConfig): HandoffDeliveryMissingConfig {
  if (!config.endpoint && !config.token) return "BOTH";
  if (!config.endpoint) return "ENDPOINT";
  if (!config.token) return "TOKEN";
  return "NONE";
}

/** Delivery status persisted per attempt. Mirrors the receiver's semantics. */
export type HandoffDeliveryStatus =
  | "NOT_CONFIGURED"
  | "PENDING"
  | "DELIVERED"
  | "REJECTED"
  | "FAILED";

/**
 * Why a delivery did not succeed. Kept machine-readable so the audit trail and
 * the retry policy agree, and so an operator is never told "failed" without
 * knowing whether retrying could ever help.
 */
export type HandoffDeliveryErrorCode =
  | "NOT_CONFIGURED"
  | "AUTH_REJECTED"
  | "UNSUPPORTED_VERSION"
  | "INVALID_PAYLOAD"
  | "RATE_LIMITED"
  | "RECEIVER_UNAVAILABLE"
  | "TIMEOUT"
  | "NETWORK_ERROR";

export interface HandoffDeliveryError {
  code: HandoffDeliveryErrorCode;
  /** Safe, redacted, bounded human message. Never contains the credential. */
  message: string;
  /** HTTP status the receiver answered with, when there was one. */
  status: number | null;
}

export type HandoffDeliveryResult =
  | {
      status: "DELIVERED";
      attempts: number;
      httpStatus: number;
      /** Receiver's idempotency verdict, when it reported one. */
      duplicate: boolean;
    }
  | {
      status: "REJECTED" | "FAILED";
      attempts: number;
      error: HandoffDeliveryError;
    }
  | {
      status: "NOT_CONFIGURED";
      attempts: 0;
      error: HandoffDeliveryError;
    };

/** Only these failures are worth another attempt. */
export function isRetryableDeliveryError(code: HandoffDeliveryErrorCode): boolean {
  return code === "TIMEOUT" || code === "NETWORK_ERROR" || code === "RECEIVER_UNAVAILABLE" || code === "RATE_LIMITED";
}

/** Backoff for the given attempt (1-based), capped so a cycle cannot hang. */
export function deliveryBackoffMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(HANDOFF_DELIVERY_BACKOFF_MS_CAP, HANDOFF_DELIVERY_BACKOFF_MS_BASE * 2 ** exponent);
}

/** Map a receiver HTTP answer onto AIAgent's error semantics. */
export function classifyDeliveryResponse(status: number, bodyText: string): HandoffDeliveryError {
  const safeBody = bodyText.replace(/[\r\n]+/g, " ").slice(0, 200);
  if (status === 401 || status === 403) {
    return {
      code: "AUTH_REJECTED",
      message: `AI Income Lab refused the delivery credential (HTTP ${status}).`,
      status,
    };
  }
  if (status === 400 || status === 422) {
    const unsupported = /UNSUPPORTED_CONTRACT_VERSION|contractVersion/i.test(safeBody);
    return {
      code: unsupported ? "UNSUPPORTED_VERSION" : "INVALID_PAYLOAD",
      message: unsupported
        ? `AI Income Lab rejected contract version v1 as unsupported (HTTP ${status}).`
        : `AI Income Lab rejected the handoff payload (HTTP ${status}).`,
      status,
    };
  }
  if (status === 409 || status === 429) {
    return {
      code: "RATE_LIMITED",
      message: `AI Income Lab asked AIAgent to back off (HTTP ${status}).`,
      status,
    };
  }
  if (status >= 500) {
    return {
      code: "RECEIVER_UNAVAILABLE",
      message: `AI Income Lab is unavailable (HTTP ${status}).`,
      status,
    };
  }
  return { code: "INVALID_PAYLOAD", message: `Unexpected AI Income Lab response (HTTP ${status}).`, status };
}

export interface HandoffTransportDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Deliver one envelope. Bounded attempts, hard timeout, authenticated, and
 * never reported as delivered unless the receiver actually accepted it.
 *
 * The `fetchImpl` seam exists so the timeout, retry and error-mapping
 * behaviour can be tested without a network. It is NOT a mock transport in
 * production: `deliverHandoff` always passes the platform `fetch`.
 */
export async function deliverHandoffEnvelope(
  envelope: HandoffDeliveryEnvelope,
  config: HandoffDeliveryConfig,
  deps: HandoffTransportDeps = {},
): Promise<HandoffDeliveryResult> {
  const missing = missingHandoffDeliveryConfig(config);
  if (missing !== "NONE" || !config.endpoint || !config.token) {
    return {
      status: "NOT_CONFIGURED",
      attempts: 0,
      error: {
        code: "NOT_CONFIGURED",
        message:
          missing === "TOKEN" || missing === "BOTH"
            ? `Cross-repository handoff delivery is NOT_CONFIGURED: ${HANDOFF_DELIVERY_TOKEN_ENV} is not set server-side.`
            : `Cross-repository handoff delivery is NOT_CONFIGURED: ${HANDOFF_DELIVERY_ENDPOINT_ENV} is not set server-side.`,
        status: null,
      },
    };
  }

  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const body = JSON.stringify(envelope);

  let attempts = 0;
  let lastError: HandoffDeliveryError = {
    code: "NETWORK_ERROR",
    message: "Delivery was never attempted.",
    status: null,
  };

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    attempts = attempt;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await doFetch(config.endpoint, {
        method: "POST",
        headers: {
          // Peer authentication. The secret itself is never logged and never
          // stored in the delivery audit trail.
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
          accept: "application/json",
          "idempotency-key": envelope.idempotencyKey,
          "x-handoff-contract-version": String(envelope.contractVersion),
        },
        body,
        signal: controller.signal,
        cache: "no-store",
      });

      if (response.ok) {
        const text = await safeReadText(response);
        return {
          status: "DELIVERED",
          attempts,
          httpStatus: response.status,
          duplicate: /"duplicate"\s*:\s*true/i.test(text),
        };
      }

      lastError = classifyDeliveryResponse(response.status, await safeReadText(response));
      // A refusal is a decision by the receiver. Retrying cannot change it.
      if (!isRetryableDeliveryError(lastError.code)) {
        return { status: "REJECTED", attempts, error: lastError };
      }
    } catch (error) {
      const aborted = controller.signal.aborted || isAbortError(error);
      lastError = aborted
        ? {
            code: "TIMEOUT",
            message: `AI Income Lab did not answer within ${config.timeoutMs}ms.`,
            status: null,
          }
        : {
            code: "NETWORK_ERROR",
            message: "AI Income Lab could not be reached.",
            status: null,
          };
    } finally {
      clearTimeout(timer);
    }

    if (attempt < config.maxAttempts && isRetryableDeliveryError(lastError.code)) {
      await sleep(deliveryBackoffMs(attempt));
    }
  }

  return { status: "FAILED", attempts, error: lastError };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}
