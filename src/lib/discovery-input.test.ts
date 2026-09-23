import { describe, expect, it } from "vitest";
import { parseDiscoveryStartBody, safeId } from "./discovery-input";

describe("parseDiscoveryStartBody", () => {
  it("rejects invalid JSON", () => {
    expect(parseDiscoveryStartBody("{")).toEqual({ ok: false, error: "Invalid JSON body", status: 400 });
  });

  it("rejects a short topic", () => {
    const result = parseDiscoveryStartBody(JSON.stringify({ topic: "ab", category: "saas" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects an unknown category", () => {
    const result = parseDiscoveryStartBody(JSON.stringify({ topic: "teacher worksheets", category: "gambling" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("category");
  });

  it("rejects oversized bodies", () => {
    const result = parseDiscoveryStartBody("x".repeat(33 * 1024));
    expect(result).toEqual({ ok: false, error: "Request body too large", status: 413 });
  });

  it("rejects invalid maxCandidates", () => {
    const result = parseDiscoveryStartBody(
      JSON.stringify({ topic: "teacher worksheets", category: "education", maxCandidates: 99 }),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a valid payload and trims topic", () => {
    const result = parseDiscoveryStartBody(
      JSON.stringify({ topic: "  teacher worksheets  ", category: "education", maxCandidates: 3 }),
    );
    expect(result).toEqual({
      ok: true,
      topic: "teacher worksheets",
      category: "education",
      maxCandidates: 3,
    });
  });
});

describe("safeId", () => {
  it("trims and caps ids", () => {
    expect(safeId("  abc  ")).toBe("abc");
    expect(safeId("x".repeat(80)).length).toBe(64);
    expect(safeId(12)).toBe("");
  });
});
