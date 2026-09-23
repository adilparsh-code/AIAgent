import { describe, expect, it } from "vitest";
import {
  extraTitlesFromEvidence,
  generateCandidates,
  isDiscoveryCategory,
  normalizeCandidateKey,
} from "./discovery-candidates";

describe("generateCandidates", () => {
  it("returns no candidates for a too-short topic", () => {
    expect(generateCandidates("ab", "education")).toEqual([]);
  });

  it("generates research hypotheses, not validated claims", () => {
    const seeds = generateCandidates("teacher worksheets", "education", { maxCandidates: 5 });
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds.length).toBeLessThanOrEqual(5);
    expect(seeds.every((seed) => seed.researchTitle.length >= 3)).toBe(true);
    expect(seeds.every((seed) => /hypothesis|unconfirmed|must/i.test(seed.problemHypothesis))).toBe(true);
    expect(new Set(seeds.map((seed) => seed.normalizedKey)).size).toBe(seeds.length);
  });

  it("deduplicates extra titles that collapse to the same key", () => {
    const seeds = generateCandidates("worksheets", "digital-products", {
      extraTitles: ["Teacher Worksheets", "teacher worksheets!!!", "Another Unique Title Here"],
      maxCandidates: 5,
    });
    const keys = seeds.map((seed) => seed.normalizedKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("caps candidate count", () => {
    const seeds = generateCandidates("pinterest printables", "pinterest-content", { maxCandidates: 2 });
    expect(seeds).toHaveLength(2);
  });
});

describe("normalizeCandidateKey / extraTitlesFromEvidence", () => {
  it("normalizes punctuation and case", () => {
    expect(normalizeCandidateKey("Teacher Worksheets!!!")).toBe("teacher worksheets");
  });

  it("keeps unique evidence titles related to the topic", () => {
    const titles = extraTitlesFromEvidence(
      [{ title: "Teacher worksheet pack" }, { title: "teacher worksheet pack" }, { title: "Unrelated crypto" }, "Too"],
      "teacher worksheet",
      3,
    );
    expect(titles).toEqual(["Teacher worksheet pack"]);
  });
});

describe("isDiscoveryCategory", () => {
  it("accepts known categories and rejects others", () => {
    expect(isDiscoveryCategory("saas")).toBe(true);
    expect(isDiscoveryCategory("lottery")).toBe(false);
    expect(isDiscoveryCategory(1)).toBe(false);
  });
});
