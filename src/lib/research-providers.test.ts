import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBraveProvider,
  createGoogleTrendsProvider,
  createRedditProvider,
  createUnavailableProvider,
  fetchWithTimeout,
} from "./research-providers";
import type { ResearchQuery } from "./research-types";

const demandQuery: ResearchQuery = { query: "teacher worksheets", source: "brave", purpose: "demand" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.SERPAPI_API_KEY;
});

describe("provider configuration honesty", () => {
  it("brave throws a clear error when the API key is missing", async () => {
    delete process.env.BRAVE_SEARCH_API_KEY;
    await expect(createBraveProvider().search(demandQuery)).rejects.toThrow(/BRAVE_SEARCH_API_KEY is not configured/);
  });

  it("google-trends throws a clear error when SERPAPI_API_KEY is missing", async () => {
    delete process.env.SERPAPI_API_KEY;
    await expect(createGoogleTrendsProvider().search({ ...demandQuery, source: "google-trends", purpose: "trend" }))
      .rejects.toThrow(/SERPAPI_API_KEY is not configured/);
  });

  it("unavailable placeholder providers state that they are not configured", async () => {
    await expect(createUnavailableProvider("reddit").search(demandQuery)).rejects.toThrow(/not configured/);
  });
});

describe("brave provider", () => {
  it("maps live API results into normalized REAL_LIVE_DATA evidence", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: "<b>Worksheets</b> that sell", url: "https://shop.example.com/w?ref=x", description: "Teachers &amp; parents buy" },
            { title: "No URL result", url: "", description: "dropped" },
            { title: "Bad scheme", url: "javascript:alert(1)", description: "dropped" },
          ],
        },
      }),
    }));

    const results = await createBraveProvider().search(demandQuery);

    expect(results).toHaveLength(1);
    expect(results[0]!.source).toBe("brave");
    expect(results[0]!.dataClass).toBe("REAL_LIVE_DATA");
    expect(results[0]!.snippet).not.toContain("<b>");
    expect(results[0]!.supports).toEqual(["demand"]);
  });

  it("surfaces HTTP failures as provider errors", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    await expect(createBraveProvider().search(demandQuery)).rejects.toThrow("brave: API returned HTTP 429");
  });

  it("never includes the API key in thrown error messages", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "super-secret-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hangup")));
    try {
      await createBraveProvider().search(demandQuery);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-key");
    }
  });
});

describe("reddit provider", () => {
  it("maps children results and resolves permalink URLs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          children: [
            { data: { title: "Looking for worksheets", selftext: "Any recommendations?", permalink: "/r/teachers/comments/1/" } },
            { data: { title: "Link post", url: "https://example.com/article" } },
          ],
        },
      }),
    }));

    const results = await createRedditProvider().search({ ...demandQuery, source: "reddit", purpose: "pain-point" });

    expect(results).toHaveLength(2);
    expect(results[0]!.url).toBe("https://www.reddit.com/r/teachers/comments/1/");
    expect(results[1]!.url).toBe("https://example.com/article");
    expect(results[0]!.dataClass).toBe("REAL_LIVE_DATA");
  });

  it("propagates HTTP failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(createRedditProvider().search({ ...demandQuery, source: "reddit" })).rejects.toThrow("HTTP 503");
  });
});

describe("google-trends provider (SerpApi)", () => {
  it("converts a live TIMESERIES into one normalized evidence item with real values", async () => {
    process.env.SERPAPI_API_KEY = "test-key";
    const values = Array.from({ length: 12 }, (_, i) => i + 1); // rising 1..12
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        interest_over_time: {
          timeline_data: values.map((v) => ({ timestamp: 1700000000, extracted_values: [v] })),
        },
      }),
    }));

    const results = await createGoogleTrendsProvider().search({ ...demandQuery, source: "google-trends", purpose: "trend" });

    expect(results).toHaveLength(1);
    expect(results[0]!.dataClass).toBe("REAL_LIVE_DATA");
    expect(results[0]!.supports).toEqual(["trend"]);
    expect(results[0]!.snippet).toContain("normalized 0-100");
    expect(results[0]!.snippet).toContain("Start value 1, end value 12");
  });

  it("returns empty when SerpApi reports no timeline", async () => {
    process.env.SERPAPI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ interest_over_time: {} }) }));
    const results = await createGoogleTrendsProvider().search({ ...demandQuery, source: "google-trends", purpose: "trend" });
    expect(results).toEqual([]);
  });

  it("surfaces SerpApi error payloads as provider failures", async () => {
    process.env.SERPAPI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: "Invalid API key" }),
    }));
    await expect(
      createGoogleTrendsProvider().search({ ...demandQuery, source: "google-trends", purpose: "trend" }),
    ).rejects.toThrow("SerpApi error: Invalid API key");
  });
});

describe("fetchWithTimeout", () => {
  it("aborts requests that exceed the timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      // Simulate a real fetch: rejects when its AbortSignal fires.
      return new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }));

    await expect(fetchWithTimeout("https://example.com", {})).rejects.toThrow();
  }, 10_000);
});
