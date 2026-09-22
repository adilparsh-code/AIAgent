import { DISCOVERY_CANDIDATE_LIMITS, isDiscoveryCategory } from "./discovery-candidates";
import type { DiscoveryCategory } from "./discovery-types";

export const DISCOVERY_LIMITS = {
  MAX_TOPIC_LENGTH: 240,
  MIN_TOPIC_LENGTH: 3,
  MAX_ID_LENGTH: 64,
  MAX_JSON_BYTES: 32 * 1024,
  MAX_CANDIDATES: DISCOVERY_CANDIDATE_LIMITS.MAX_CANDIDATES_CAP,
} as const;

export interface ParsedDiscoveryStart {
  ok: true;
  topic: string;
  category: DiscoveryCategory;
  maxCandidates: number;
}

export interface ParsedDiscoveryFailure {
  ok: false;
  error: string;
  status: number;
}

export type ParsedDiscoveryStartResult = ParsedDiscoveryStart | ParsedDiscoveryFailure;

export function safeId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, DISCOVERY_LIMITS.MAX_ID_LENGTH);
}

export function parseDiscoveryStartBody(raw: string | null): ParsedDiscoveryStartResult {
  if (raw == null) return { ok: false, error: "Invalid JSON body", status: 400 };
  if (raw.length > DISCOVERY_LIMITS.MAX_JSON_BYTES) {
    return { ok: false, error: "Request body too large", status: 413 };
  }

  let body: { topic?: unknown; category?: unknown; maxCandidates?: unknown };
  try {
    body = JSON.parse(raw) as { topic?: unknown; category?: unknown; maxCandidates?: unknown };
  } catch {
    return { ok: false, error: "Invalid JSON body", status: 400 };
  }
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON body", status: 400 };
  }

  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, DISCOVERY_LIMITS.MAX_TOPIC_LENGTH) : "";
  if (topic.length < DISCOVERY_LIMITS.MIN_TOPIC_LENGTH) {
    return { ok: false, error: "topic must be at least 3 characters", status: 400 };
  }

  if (!isDiscoveryCategory(body.category)) {
    return {
      ok: false,
      error: "category must be one of digital-products, apps, affiliate, education, pinterest-content, saas, ai-tools, childrens-activities, other",
      status: 400,
    };
  }

  let maxCandidates: number = DISCOVERY_CANDIDATE_LIMITS.MAX_CANDIDATES_DEFAULT;
  if (body.maxCandidates !== undefined) {
    const n = Number(body.maxCandidates);
    if (!Number.isInteger(n) || n < 1 || n > DISCOVERY_LIMITS.MAX_CANDIDATES) {
      return { ok: false, error: `maxCandidates must be an integer from 1 to ${DISCOVERY_LIMITS.MAX_CANDIDATES}`, status: 400 };
    }
    maxCandidates = n;
  }

  return { ok: true, topic, category: body.category, maxCandidates };
}
