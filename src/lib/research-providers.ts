import type { ResearchProvider } from "./base-provider";
import type { Evidence, ResearchQuery } from "./research-types";
import { normalizeEvidenceItem } from "./evidence-normalization";
// MEDIUM-5: the SerpApi request URL is built in exactly one place, so the
// credential-bearing URL can never be assembled ad hoc and then surfaced.
import { buildSerpApiUrl } from "./research-provider-url";

export class ProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

const PROVIDER_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(url: string | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Serialize one raw provider result into normalized, sanitized Evidence.
 * Unusable rows (no URL/title) are dropped instead of fabricating placeholders.
 */
function buildEvidence(
  raw: {
    title: unknown;
    url: unknown;
    snippet: unknown;
    supports?: unknown;
    contradicts?: unknown;
    dataClass?: unknown;
  },
  source: string,
  fallbackPurpose: ResearchQuery["purpose"],
): Evidence | null {
  const normalized = normalizeEvidenceItem(
    { ...raw, source },
    fallbackPurpose,
  );
  return normalized;
}

export function isProviderNotConfigured(error: unknown): error is ProviderNotConfiguredError {
  return error instanceof ProviderNotConfiguredError ||
    (error instanceof Error && error.name === "ProviderNotConfiguredError") ||
    (error instanceof Error && /not configured/i.test(error.message));
}

export function createUnavailableProvider(name: "brave" | "reddit" | "google-trends"): ResearchProvider {
  return {
    name,
    async search(): Promise<Evidence[]> {
      throw new ProviderNotConfiguredError(`${name}: provider is not configured`);
    },
  };
}

export function createBraveProvider(): ResearchProvider {
  return {
    name: "brave",
    async search(query: ResearchQuery): Promise<Evidence[]> {
      const key = process.env.BRAVE_SEARCH_API_KEY;
      if (!key) throw new ProviderNotConfiguredError("brave: BRAVE_SEARCH_API_KEY is not configured");
      if (typeof fetch === "undefined") throw new Error("brave: fetch is unavailable in this runtime");
      try {
        const url = new URL("https://api.search.brave.com/res/v1/web/search");
        url.searchParams.set("q", query.query);
        url.searchParams.set("count", "10");
        const response = await fetchWithTimeout(url, {
          headers: { Accept: "application/json", "X-Subscription-Token": key },
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`brave: API returned HTTP ${response.status}`);
        const data = (await response.json()) as {
          web?: { results?: Array<{ title?: unknown; url?: unknown; description?: unknown }> };
        };
        return (data.web?.results ?? [])
          .map((raw) =>
            buildEvidence(
              { title: raw.title, url: raw.url, snippet: raw.description, supports: [query.purpose], dataClass: "REAL_LIVE_DATA" },
              "brave",
              query.purpose,
            ),
          )
          .filter((item): item is Evidence => item !== null);
      } catch (error) {
        if (isProviderNotConfigured(error)) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("brave: request timed out after 10s");
        }
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
        const response = await fetchWithTimeout(url, {
          headers: { Accept: "application/json", "User-Agent": "AIAgent/1.0 research" },
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`reddit: API returned HTTP ${response.status}`);
        const data = (await response.json()) as {
          data?: { children?: Array<{ data?: { title?: unknown; url?: unknown; selftext?: unknown; permalink?: unknown } }> };
        };
        return (data.data?.children ?? [])
          .map((child) => child?.data ?? null)
          .filter(Boolean)
          .map((row) => {
            const permalink = typeof row?.permalink === "string" ? row.permalink : "";
            const resolvedUrl = permalink
              ? `https://www.reddit.com${permalink}`
              : typeof row?.url === "string" ? row.url : "";
            return buildEvidence(
              {
                title: row?.title,
                url: resolvedUrl,
                snippet: typeof row?.selftext === "string" ? row.selftext.slice(0, 1200) : "",
                supports: [query.purpose],
                dataClass: "REAL_LIVE_DATA",
              },
              "reddit",
              query.purpose,
            );
          })
          .filter((item): item is Evidence => item !== null);
      } catch (error) {
        if (isProviderNotConfigured(error)) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("reddit: request timed out after 10s");
        }
        throw new Error(`reddit: ${error instanceof Error ? error.message : "request failed"}`);
      }
    },
  };
}

/**
 * Google Trends via SerpApi (named third-party provider — Google does not offer an
 * official Trends API). NORMALIZED 0-100 relative interest values are stored in the
 * snippet; only these normalized values exist, never fabricated market metrics.
 */
export function createGoogleTrendsProvider(): ResearchProvider {
  return {
    name: "google-trends",
    async search(query: ResearchQuery): Promise<Evidence[]> {
      const key = process.env.SERPAPI_API_KEY;
      if (!key) throw new ProviderNotConfiguredError("google-trends: SERPAPI_API_KEY is not configured (SerpApi is used because Google offers no official Trends API)");
      try {
      const url = buildSerpApiUrl(
        { engine: "google_trends", data_type: "TIMESERIES", date: "today 12-m", q: query.query },
        key,
      );
      const response = await fetchWithTimeout(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`google-trends: SerpApi returned HTTP ${response.status}`);
        const data = (await response.json()) as {
          error?: string;
          interest_over_time?: {
            timeline_data?: Array<{ timestamp?: unknown; extracted_values?: Array<unknown> }>;
          };
        };
        if (typeof data.error === "string" && data.error) {
          throw new Error(`google-trends: SerpApi error: ${data.error}`);
        }
        const timeline = data.interest_over_time?.timeline_data ?? [];
        if (!timeline.length) return [];

        const values = timeline
          .map((point) => {
            const value = point.extracted_values?.[0];
            return typeof value === "number" ? value : Number(value);
          })
          .filter((value) => Number.isFinite(value));
        if (!values.length) return [];

        const first = values[0]!;
        const last = values[values.length - 1]!;
        const average = values.reduce((sum, v) => sum + v, 0) / values.length;
        const max = Math.max(...values);

        // Normalized 0-100 relative interest (Google Trends values are already relative).
        const summary =
          `Google Trends interest over the last 12 months (normalized 0-100, relative, not absolute volume). ` +
          `Start value ${first}, end value ${last}, average ${average.toFixed(1)}, peak ${max}, ${values.length} data points. ` +
          `End vs start delta: ${Number(((last - first) / Math.max(1, first)) * 100).toFixed(0)}%.`;

        const share = last / 100;
        const relevance = Number(Math.min(1, 0.4 + share * 0.6).toFixed(2));
        const pageUrl = `https://trends.google.com/trends/explore?q=${encodeURIComponent(query.query)}`;

        return [buildEvidence(
          {
            title: `Google Trends: ${query.query}`,
            url: pageUrl,
            snippet: summary,
            supports: [query.purpose === "trend" ? "trend" : query.purpose],
            dataClass: "REAL_LIVE_DATA",
          },
          "google-trends",
          query.purpose,
        ) ?? null].filter((item): item is Evidence => item !== null);
      } catch (error) {
        if (isProviderNotConfigured(error)) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("google-trends: request timed out after 10s");
        }
        throw new Error(`google-trends: ${error instanceof Error ? error.message : "request failed"}`);
      }
    },
  };
}

export function getResearchProviders(): ResearchProvider[] {
  return [createBraveProvider(), createRedditProvider(), createGoogleTrendsProvider()];
}
