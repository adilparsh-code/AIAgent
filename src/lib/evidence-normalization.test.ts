import { describe, expect, it } from "vitest";
import type { Evidence } from "./research-types";
import {
  computeEvidenceHash,
  dedupeEvidence,
  normalizeEvidenceItem,
  normalizeText,
  sanitizeExternalUrl,
} from "./evidence-normalization";

const base = (overrides: Partial<Parameters<typeof normalizeEvidenceItem>[0]> = {}) => ({
  source: "brave",
  title: "Best worksheet tools 2026",
  url: "https://example.com/worksheets",
  snippet: "<p>Teachers &amp; parents buy worksheets</p>",
  supports: ["demand"],
  ...overrides,
});

describe("normalizeText", () => {
  it("strips HTML tags and entities and collapses whitespace", () => {
    expect(normalizeText("<p>Hello &amp; welcome</p>   world\n\t!")).toBe("Hello welcome world !");
  });
});

describe("sanitizeExternalUrl", () => {
  it("accepts http(s) URLs", () => {
    expect(sanitizeExternalUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(sanitizeExternalUrl("http://example.com")).toContain("http://example.com");
  });

  it("rejects javascript:, data:, and malformed URLs", () => {
    expect(sanitizeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeExternalUrl("data:text/html;base64,AAAA")).toBeNull();
    expect(sanitizeExternalUrl("not a url")).toBeNull();
    expect(sanitizeExternalUrl(null)).toBeNull();
  });
});

describe("computeEvidenceHash", () => {
  it("is stable across trailing slashes, query strings, and case", () => {
    const a = computeEvidenceHash("Title", "snippet", "https://example.com/Page?q=1");
    const b = computeEvidenceHash("title", "SNIPPET", "https://EXAMPLE.com/page/");
    expect(a).toBe(b);
  });

  it("differs for different content", () => {
    expect(computeEvidenceHash("A", "s", "https://x.com/1")).not.toBe(computeEvidenceHash("B", "s", "https://x.com/1"));
  });
});

describe("normalizeEvidenceItem", () => {
  it("normalizes HTML in snippets and clamps scores", () => {
    const item = normalizeEvidenceItem(base({ relevanceScore: 5, qualityScore: -1 }), "demand");
    expect(item).not.toBeNull();
    expect(item!.snippet).toBe("Teachers parents buy worksheets");
    expect(item!.relevanceScore).toBeLessThanOrEqual(1);
    expect(item!.qualityScore).toBeGreaterThan(0);
  });

  it("drops items without a usable URL or title", () => {
    expect(normalizeEvidenceItem(base({ url: "javascript:alert(1)" }), "demand")).toBeNull();
    expect(normalizeEvidenceItem(base({ title: "" }), "demand")).toBeNull();
  });

  it("defaults purpose when supports is missing or invalid", () => {
    const item = normalizeEvidenceItem(base({ supports: "not-an-array" }), "pain-point");
    expect(item!.supports).toEqual(["pain-point"]);
  });

  it("marks non-live data as AI_ESTIMATE unless REAL_LIVE_DATA is explicit", () => {
    expect(normalizeEvidenceItem(base(), "demand")!.dataClass).toBe("AI_ESTIMATE");
    expect(normalizeEvidenceItem(base({ dataClass: "REAL_LIVE_DATA" }), "demand")!.dataClass).toBe("REAL_LIVE_DATA");
  });
});

describe("dedupeEvidence", () => {
  const make = (id: string, url: string, hash: string): Evidence => ({
    id,
    source: id.startsWith("r") ? "reddit" : "brave",
    title: `Result ${id}`,
    url,
    snippet: "snippet",
    collectedAt: new Date().toISOString(),
    relevanceScore: 0.9,
    qualityScore: 0.8,
    hash,
    supports: ["demand"],
    contradicts: [],
    dataClass: "REAL_LIVE_DATA",
  });

  it("removes same-hash items across providers (duplicate sources cannot inflate confidence)", () => {
    const result = dedupeEvidence([make("a1", "https://x.com/1", "same"), make("r1", "https://x.com/2", "same")]);
    expect(result.evidence).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it("removes same normalized URL even when hashes differ", () => {
    const result = dedupeEvidence([
      make("a1", "https://x.com/page?q=1", "hash-a"),
      make("r1", "https://x.com/page/", "hash-b"),
    ]);
    expect(result.evidence).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it("preserves source diversity for genuinely distinct evidence", () => {
    const result = dedupeEvidence([
      make("a1", "https://a.com/1", "h1"),
      make("r1", "https://b.com/2", "h2"),
      make("a2", "https://c.com/3", "h3"),
    ]);
    expect(result.evidence).toHaveLength(3);
    expect(new Set(result.evidence.map((e) => e.source)).size).toBe(2);
  });

  it("returns empty result for empty input", () => {
    expect(dedupeEvidence([])).toEqual({ evidence: [], duplicatesRemoved: 0 });
  });
});
