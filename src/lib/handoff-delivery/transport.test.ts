import { describe, expect, it, vi } from "vitest";
import {
  HANDOFF_DELIVERY_MAX_ATTEMPTS,
  classifyDeliveryResponse,
  deliverHandoffEnvelope,
  deliveryBackoffMs,
  getHandoffDeliveryConfig,
  isRetryableDeliveryError,
  missingHandoffDeliveryConfig,
  type HandoffDeliveryConfig,
} from "./transport";
import { buildHandoffDeliveryEnvelope } from "./contract";
import type { OpportunityHandoffContract } from "../handoff";

const TOKEN = "a".repeat(48);

function contract(): OpportunityHandoffContract {
  return {
    contractVersion: 1,
    handoffId: "handoff-1",
    opportunityId: "opp-1",
    title: "T",
    category: "C",
    targetAudience: "A",
    problem: "P",
    validationConclusion: "VALIDATED",
    confidence: 0.8,
    score: 70,
    evidence: [],
    monetizationOptions: [],
    risks: ["r"],
    recommendedExperiment: "MVP_BUILD",
    experimentHypothesis: "h",
    successCriteria: ["s"],
    budgetLimit: null,
    timeLimitDays: null,
    handoffStatus: "ACCEPTED",
  };
}

const envelope = buildHandoffDeliveryEnvelope({ contract: contract(), eligibleForImplementation: true });

const configured: HandoffDeliveryConfig = {
  endpoint: "https://income-lab.example.test/api/agent-handoffs",
  token: TOKEN,
  timeoutMs: 1_000,
  maxAttempts: HANDOFF_DELIVERY_MAX_ATTEMPTS,
};

function jsonResponse(status: number, body = ""): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("handoff delivery transport — configuration fails closed", () => {
  it("is NOT_CONFIGURED when nothing is set, and never invents an endpoint", () => {
    const config = getHandoffDeliveryConfig({});
    expect(config.endpoint).toBeNull();
    expect(config.token).toBeNull();
    expect(missingHandoffDeliveryConfig(config)).toBe("BOTH");
  });

  it("rejects a plaintext or non-absolute endpoint", () => {
    expect(getHandoffDeliveryConfig({ AI_INCOME_LAB_HANDOFF_ENDPOINT: "http://lab.test/x" }).endpoint).toBeNull();
    expect(getHandoffDeliveryConfig({ AI_INCOME_LAB_HANDOFF_ENDPOINT: "not-a-url" }).endpoint).toBeNull();
    expect(getHandoffDeliveryConfig({ AI_INCOME_LAB_HANDOFF_ENDPOINT: "https://lab.test/x" }).endpoint).toBe(
      "https://lab.test/x",
    );
  });

  it("rejects a too-short credential", () => {
    expect(getHandoffDeliveryConfig({ AI_INCOME_LAB_HANDOFF_TOKEN: "short" }).token).toBeNull();
    expect(getHandoffDeliveryConfig({ AI_INCOME_LAB_HANDOFF_TOKEN: TOKEN }).token).toBe(TOKEN);
  });

  it("clamps an out-of-range timeout to the bounded default", () => {
    expect(getHandoffDeliveryConfig({ AI_INCOME_LAB_HANDOFF_TIMEOUT_MS: "5" }).timeoutMs).toBe(10_000);
    expect(getHandoffDeliveryConfig({ AI_INCOME_LAB_HANDOFF_TIMEOUT_MS: "999999" }).timeoutMs).toBe(10_000);
    expect(getHandoffDeliveryConfig({ AI_INCOME_LAB_HANDOFF_TIMEOUT_MS: "3000" }).timeoutMs).toBe(3_000);
  });
});

describe("handoff delivery transport — NOT LIVE without configuration", () => {
  it("reports NOT_CONFIGURED and makes no network call", async () => {
    const fetchImpl = vi.fn();
    const result = await deliverHandoffEnvelope(envelope, getHandoffDeliveryConfig({}), { fetchImpl: fetchImpl as never });
    expect(result).toMatchObject({ status: "NOT_CONFIGURED", attempts: 0 });
    expect(result.status === "NOT_CONFIGURED" && result.error.code).toBe("NOT_CONFIGURED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("names the missing variable without revealing any value", async () => {
    const result = await deliverHandoffEnvelope(
      envelope,
      { ...configured, token: null },
      { fetchImpl: (async () => jsonResponse(200)) as never },
    );
    expect(result.status).toBe("NOT_CONFIGURED");
    if (result.status === "NOT_CONFIGURED") {
      expect(result.error.message).toContain("AI_INCOME_LAB_HANDOFF_TOKEN");
      expect(result.error.message).not.toContain(TOKEN);
    }
  });
});

describe("handoff delivery transport — authentication and duplicate protection", () => {
  it("presents the bearer credential and the idempotency key on every attempt", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return jsonResponse(200);
    });
    const result = await deliverHandoffEnvelope(envelope, configured, { fetchImpl: fetchImpl as never });

    expect(result).toMatchObject({ status: "DELIVERED", attempts: 1, httpStatus: 200 });
    const [url, init] = calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(url).toBe(configured.endpoint);
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers["idempotency-key"]).toBe("aiagent-handoff:handoff-1:v1");
    expect(headers["x-handoff-contract-version"]).toBe("1");
  });

  it("surfaces the receiver's duplicate verdict on a replayed delivery", async () => {
    const result = await deliverHandoffEnvelope(
      envelope,
      configured,
      { fetchImpl: (async () => jsonResponse(200, '{"duplicate":true}')) as never },
    );
    expect(result).toMatchObject({ status: "DELIVERED", duplicate: true });
  });

  it("maps a rejected credential to AUTH_REJECTED and does not retry it", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401));
    const result = await deliverHandoffEnvelope(envelope, configured, { fetchImpl: fetchImpl as never });
    expect(result).toMatchObject({ status: "REJECTED", attempts: 1 });
    if (result.status === "REJECTED") expect(result.error.code).toBe("AUTH_REJECTED");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never leaks the credential into an error message", async () => {
    const result = await deliverHandoffEnvelope(
      envelope,
      configured,
      { fetchImpl: (async () => jsonResponse(403, "denied")) as never },
    );
    if (result.status === "REJECTED") expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

describe("handoff delivery transport — timeout, bounded retry and failure semantics", () => {
  it("aborts an attempt that outlives the timeout and reports TIMEOUT", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    const result = await deliverHandoffEnvelope(
      envelope,
      { ...configured, maxAttempts: 1 },
      { fetchImpl: fetchImpl as never, sleep: async () => undefined },
    );
    expect(result).toMatchObject({ status: "FAILED", attempts: 1 });
    if (result.status === "FAILED") expect(result.error.code).toBe("TIMEOUT");
  });

  it("retries a transient failure a bounded number of times, then gives up", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503));
    const sleeps: number[] = [];
    const result = await deliverHandoffEnvelope(envelope, configured, {
      fetchImpl: fetchImpl as never,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(HANDOFF_DELIVERY_MAX_ATTEMPTS);
    expect(result).toMatchObject({ status: "FAILED", attempts: HANDOFF_DELIVERY_MAX_ATTEMPTS });
    if (result.status === "FAILED") expect(result.error.code).toBe("RECEIVER_UNAVAILABLE");
    expect(sleeps).toEqual([500, 1_000]);
  });

  it("stops retrying as soon as a retry succeeds", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return call === 1 ? jsonResponse(500) : jsonResponse(200);
    });
    const result = await deliverHandoffEnvelope(envelope, configured, {
      fetchImpl: fetchImpl as never,
      sleep: async () => undefined,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: "DELIVERED", attempts: 2 });
  });

  it("does not retry a 429 more than the bounded policy allows", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(429));
    const result = await deliverHandoffEnvelope(envelope, configured, {
      fetchImpl: fetchImpl as never,
      sleep: async () => undefined,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(HANDOFF_DELIVERY_MAX_ATTEMPTS);
    if (result.status === "FAILED") expect(result.error.code).toBe("RATE_LIMITED");
  });

  it("classifies a receiver that rejects the contract version as UNSUPPORTED_VERSION", async () => {
    const result = await deliverHandoffEnvelope(
      envelope,
      configured,
      { fetchImpl: (async () => jsonResponse(400, '{"reason":"UNSUPPORTED_CONTRACT_VERSION"}')) as never },
    );
    if (result.status === "REJECTED") expect(result.error.code).toBe("UNSUPPORTED_VERSION");
  });

  it("only retries transient classes", () => {
    expect(isRetryableDeliveryError("TIMEOUT")).toBe(true);
    expect(isRetryableDeliveryError("RECEIVER_UNAVAILABLE")).toBe(true);
    expect(isRetryableDeliveryError("AUTH_REJECTED")).toBe(false);
    expect(isRetryableDeliveryError("UNSUPPORTED_VERSION")).toBe(false);
    expect(isRetryableDeliveryError("INVALID_PAYLOAD")).toBe(false);
  });

  it("caps the backoff so a delivery cycle cannot hang", () => {
    expect(deliveryBackoffMs(1)).toBe(500);
    expect(deliveryBackoffMs(2)).toBe(1_000);
    expect(deliveryBackoffMs(20)).toBe(8_000);
  });

  it("maps an unexpected status onto a safe, non-secret message", () => {
    const error = classifyDeliveryResponse(418, "teapot");
    expect(error.code).toBe("INVALID_PAYLOAD");
    expect(error.message).toContain("418");
  });
});
