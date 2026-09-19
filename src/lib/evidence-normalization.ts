import { createHash } from "node:crypto";
import type { Evidence, EvidenceDataClass, ResearchPurpose } from "./research-types";

const VALID_PURPOSES: ResearchPurpose[] = [
  "demand",
  "commercial-intent",
  "competition",
  "trend",
  "pain-point",
  "market",
];

/** Strip HTML tags/entities and collapse whitespace from external provider content. */
export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Only http(s) URLs are accepted. Anything else (javascript:, data:, protocol-relative,
 * or garbage) is rejected so provider URLs are never trusted blindly in the UI.
 */
export function sanitizeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Stable content hash used for cross-run and cross-provider duplicate detection. */
export function computeEvidenceHash(title: string, snippet: string, url: string): string {
  const normalizedUrl = url.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  const material = [normalizeText(title).toLowerCase(), normalizeText(snippet).toLowerCase(), normalizedUrl].join("|");
  return createHash("sha256").update(material).digest("hex");
}

export interface NormalizedEvidenceInput {
  source: string;
  title: unknown;
  url: unknown;
  snippet: unknown;
  collectedAt?: unknown;
  relevanceScore?: unknown;
  qualityScore?: unknown;
  supports?: unknown;
  contradicts?: unknown;
  dataClass?: unknown;
}

/**
 * Convert a raw provider result into a clean Evidence record.
 * Returns null when the item is unusable (missing URL/title or bad scores).
 */
export function normalizeEvidenceItem(
  item: NormalizedEvidenceInput,
  fallbackPurpose: ResearchPurpose,
): Evidence | null {
  const url = sanitizeExternalUrl(item.url);
  const title = normalizeText(item.title).slice(0, 300);
  if (!url || !title) return null;

  const snippet = normalizeText(item.snippet).slice(0, 1200);
  const collectedAtRaw = typeof item.collectedAt === "string" ? item.collectedAt : undefined;
  const collectedAt =
    collectedAtRaw && !Number.isNaN(new Date(collectedAtRaw).getTime())
      ? new Date(collectedAtRaw).toISOString()
      : new Date().toISOString();

  const relevance = clampScore(item.relevanceScore, 0.4 + Math.min(0.6, (title.length + snippet.length) / 600));
  const quality = clampScore(item.qualityScore, relevance);
  const supports = Array.isArray(item.supports)
    ? item.supports.filter((p): p is ResearchPurpose => VALID_PURPOSES.includes(p as ResearchPurpose))
    : [];
  const contradicts = Array.isArray(item.contradicts)
    ? item.contradicts.filter((c): c is string => typeof c === "string" && c.trim().length > 0).slice(0, 10)
    : [];
  const dataClass: EvidenceDataClass = item.dataClass === "REAL_LIVE_DATA" ? "REAL_LIVE_DATA" : "AI_ESTIMATE";

  return {
    id: `ev-${computeEvidenceHash(title, snippet, url).slice(0, 24)}`,
    source: String(item.source).slice(0, 60),
    title,
    url,
    snippet,
    collectedAt,
    relevanceScore: relevance,
    qualityScore: quality,
    hash: computeEvidenceHash(title, snippet, url),
    supports: supports.length ? supports : [fallbackPurpose],
    contradicts,
    dataClass,
  };
}

function clampScore(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return Number(fallback.toFixed(2));
  return Number(Math.min(1, num).toFixed(2));
}

export interface DedupeResult {
  evidence: Evidence[];
  duplicatesRemoved: number;
}

/**
 * Cross-provider deduplication. Two items are duplicates when they share the same
 * normalized URL or the same content hash. The first-seen (highest quality not
 * required) wins so that source diversity is preserved without inflating counts.
 */
export function dedupeEvidence(all: Evidence[]): DedupeResult {
  const byUrl = new Map<string, Evidence>();
  const byHash = new Map<string, Evidence>();
  const kept: Evidence[] = [];
  let duplicatesRemoved = 0;

  for (const item of all) {
    // Same normalization as the content hash: strip query/hash and trailing slashes.
    const urlKey = item.url.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
    const hashKey = item.hash;
    if (byUrl.has(urlKey) || byHash.has(hashKey)) {
      duplicatesRemoved += 1;
      continue;
    }
    byUrl.set(urlKey, item);
    byHash.set(hashKey, item);
    kept.push(item);
  }

  return { evidence: kept, duplicatesRemoved };
}
