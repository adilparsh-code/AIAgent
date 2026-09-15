import type { ResearchProvider } from "./base-provider";
import type { Evidence, ResearchQuery } from "./research-types";

function now() {
  return new Date().toISOString();
}

function idFor(source: string, url: string, index: number) {
  return `${source}-${index}-${Buffer.from(url).toString("base64url").slice(0, 16)}`;
}

function scoreEvidence(title: string, snippet: string) {
  const lengthScore = Math.min(1, (title.length + snippet.length) / 280);
  return Number((0.4 + lengthScore * 0.6).toFixed(2));
}

export function createUnavailableProvider(name: "brave" | "reddit" | "google-trends"): ResearchProvider {
  return {
    name,
    async search(): Promise<Evidence[]> {
      throw new Error(`${name}: provider is not configured`);
    },
  };
}

export function createBraveProvider(): ResearchProvider {
  return {
    name: "brave",
    async search(query: ResearchQuery): Promise<Evidence[]> {
      const key = process.env.BRAVE_SEARCH_API_KEY;
      if (!key) throw new Error("brave: BRAVE_SEARCH_API_KEY is not configured");
      if (typeof fetch === "undefined") throw new Error("brave: fetch is unavailable in this runtime");
      try {
        const url = new URL("https://api.search.brave.com/res/v1/web/search");
        url.searchParams.set("q", query.query);
        url.searchParams.set("count", "10");
        const response = await fetch(url, {
          headers: { Accept: "application/json", "X-Subscription-Token": key },
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`brave: API returned HTTP ${response.status}`);
        const data = (await response.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
        return (data.web?.results ?? []).filter((r) => r.url).map((r, index) => {
          const title = r.title ?? "Untitled result";
          const snippet = r.description ?? "";
          const url = r.url!;
          const score = scoreEvidence(title, snippet);
          return {
            id: idFor("brave", url, index), source: "brave", title, url, snippet,
            collectedAt: now(), relevanceScore: score, qualityScore: score,
            hash: `${title}|${snippet}|${url}`.toLowerCase(), supports: [query.purpose], contradicts: [],
          };
        });
      } catch (error) {
        throw new Error(`brave: ${error instanceof Error ? error.message : "request failed"}`);
      }
    },
  };
}

export function createRedditProvider(): ResearchProvider {
  return {
    name: "reddit",
    async search(query: ResearchQuery): Promise<Evidence[]> {
      try {
        const url = new URL("https://www.reddit.com/search.json");
        url.searchParams.set("q", query.query);
        url.searchParams.set("limit", "10");
        url.searchParams.set("raw_json", "1");
        const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "AIAgent/1.0 research" }, cache: "no-store" });
        if (!response.ok) throw new Error(`reddit: API returned HTTP ${response.status}`);
        const data = (await response.json()) as { data?: { children?: Array<{ data?: { title?: string; url?: string; selftext?: string; permalink?: string } }> } };
        return (data.data?.children ?? []).map((item, index) => item.data).filter(Boolean).map((r, index) => {
          const title = r!.title ?? "Reddit discussion";
          const snippet = r!.selftext ?? "";
          const url = r!.url || `https://www.reddit.com${r!.permalink ?? ""}`;
          const score = scoreEvidence(title, snippet);
          return {
            id: idFor("reddit", url, index), source: "reddit", title, url, snippet,
            collectedAt: now(), relevanceScore: score, qualityScore: score,
            hash: `${title}|${snippet}|${url}`.toLowerCase(), supports: [query.purpose], contradicts: [],
          };
        });
      } catch (error) {
        throw new Error(`reddit: ${error instanceof Error ? error.message : "request failed"}`);
      }
    },
  };
}

export function createGoogleTrendsProvider(): ResearchProvider {
  return createUnavailableProvider("google-trends");
}

export function getResearchProviders(): ResearchProvider[] {
  return [createBraveProvider(), createRedditProvider(), createGoogleTrendsProvider()];
}
