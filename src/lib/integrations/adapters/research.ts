import { buildSerpApiUrl, redactProviderUrl } from "../../research-provider-url";
import {
  classifyHttpError,
  errorClassToStatus,
  sanitizeErrorMessage,
  type AdapterConfig,
  type ExecutionContext,
  type ExecutionResult,
  type HealthCheckResult,
  type IntegrationAdapter,
  type IntegrationCapability,
} from "../contract";

/**
 * Phase 8 — research provider adapters. These WRAP the existing Phase 1
 * providers (createBraveProvider / createRedditProvider /
 * createGoogleTrendsProvider) for integration health/status reporting — the
 * evidence architecture, the orchestrator, and evidence normalization remain
 * untouched and remain the only path that produces research Evidence.
 *
 * Health-check behavior (real probes, never fabricated):
 * - brave:   no BRAVE_SEARCH_API_KEY → NOT_CONFIGURED; with key → GET
 *            /res/v1/web/search?q=test&count=1 (200 = HEALTHY, 401/403 =
 *            AUTH_FAILED, 429 = DEGRADED, else FAILED).
 * - reddit:  public endpoint, no key → GET /search.json?q=test&limit=1.
 * - serpapi: no SERPAPI_API_KEY → NOT_CONFIGURED; with key → real
 *            engine=google_trends probe (trends visibility, 429 = DEGRADED).
 */

const SEARCH_CAPS: readonly IntegrationCapability[] = ["SEARCH", "READ_DATA"];

/**
 * MEDIUM-5: a transport error can carry the request URL in its message. The
 * SerpApi credential lives in that URL's query string, so any URL in an error
 * message is redacted before the message is sanitized and stored.
 */
function redactProviderCredentialInMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "request failed";
  return message.replace(/https?:\/\/\S+/gi, (match) => redactProviderUrl(match));
}

function resolveEnvironment(): "LIVE" | "TEST" | "UNKNOWN" {
  const raw = (process.env.RESEARCH_PROVIDER_ENV ?? "").trim().toUpperCase();
  return raw === "LIVE" || raw === "TEST" ? (raw as "LIVE" | "TEST") : "UNKNOWN";
}

function adapterConfig(requiredEnvVars: readonly string[]): AdapterConfig {
  return {
    environment: resolveEnvironment(),
    requiredEnvVars: [...requiredEnvVars],
    presentEnvVars: requiredEnvVars.filter((name) => Boolean(process.env[name])),
  };
}

function statusFromHttp(ok: boolean, status: number): HealthCheckResult["status"] {
  if (ok) return "HEALTHY";
  const errorClass = classifyHttpError(status, `HTTP ${status}`);
  if (errorClass === "AUTH") return "AUTH_FAILED";
  if (errorClass === "RATE_LIMIT") return "DEGRADED";
  return "FAILED";
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type Finish = (
  partial: Omit<
    ExecutionResult,
    "provider" | "action" | "startedAt" | "completedAt" | "durationMs"
  >,
) => ExecutionResult;

function makeFinish(
  provider: string,
  action: string,
  startedAt: string,
): Finish {
  return (partial) => ({
    ...partial,
    provider,
    action,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - new Date(startedAt).getTime(),
  });
}

function blockedResult(provider: string, action: string): Omit<ExecutionResult, "provider" | "action" | "startedAt" | "completedAt" | "durationMs"> {
  return {
    status: "BLOCKED",
    externalId: null,
    output: null,
    rawDataAvailable: false,
    dataClass: "REAL_DATA",
    error: `action "${action}" is not allowlisted for ${provider}`,
    usage: null,
    estimatedCost: null,
  };
}

function unavailableResult(provider: string, envVar: string): Omit<ExecutionResult, "provider" | "action" | "startedAt" | "completedAt" | "durationMs"> {
  return {
    status: "UNAVAILABLE",
    externalId: null,
    output: null,
    rawDataAvailable: false,
    dataClass: "REAL_DATA",
    error: `${provider}: ${envVar} is not configured`,
    usage: null,
    estimatedCost: null,
  };
}

export function createBraveSearchAdapter(): IntegrationAdapter {
  const REQUIRED: readonly string[] = ["BRAVE_SEARCH_API_KEY"];
  const NAME = "brave-search";
  const API = "https://api.search.brave.com/res/v1/web/search";
  return {
    name: NAME,
    type: "RESEARCH",
    description:
      "Brave Search API — web search used for demand, commercial-intent, and competition research queries.",
    capabilities: SEARCH_CAPS,
    requiredEnvVars: REQUIRED,
    timeoutMs: 10_000,
    maxRetries: 2,

    validateConfiguration(): AdapterConfig {
      return adapterConfig(REQUIRED);
    },

    async healthCheck(): Promise<HealthCheckResult> {
      const startedAt = Date.now();
      const config = this.validateConfiguration();
      const base = {
        adapterName: NAME,
        capabilities: [...SEARCH_CAPS],
        environment: config.environment,
      };
      if (config.presentEnvVars.length < REQUIRED.length) {
        return {
          ...base,
          status: "NOT_CONFIGURED",
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          error: null,
        };
      }
      try {
        const response = await fetchWithTimeout(
          `${API}?q=test&count=1`,
          {
            headers: {
              "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY ?? "",
              Accept: "application/json",
            },
          },
          10_000,
        );
        return {
          ...base,
          status: statusFromHttp(response.ok, response.status),
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          error: response.ok ? null : sanitizeErrorMessage(`brave HTTP ${response.status}`),
        };
      } catch (error) {
        return {
          ...base,
          status: "FAILED",
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          error: sanitizeErrorMessage(error instanceof Error ? error.message : "health probe failed"),
        };
      }
    },

    async execute(action: string, payload: unknown, context: ExecutionContext): Promise<ExecutionResult> {
      const startedAt = new Date().toISOString();
      const finish = makeFinish(NAME, action, startedAt);
      if (action !== "SEARCH_WEB") {
        return finish(blockedResult(NAME, action));
      }
      if (!process.env.BRAVE_SEARCH_API_KEY) {
        return finish(unavailableResult(NAME, "BRAVE_SEARCH_API_KEY"));
      }
      const body = payload as { query?: unknown; count?: unknown } | null;
      const query = typeof body?.query === "string" ? body.query.trim().slice(0, 200) : "";
      if (!query) {
        return finish({
          status: "FAILED",
          externalId: null,
          output: null,
          rawDataAvailable: false,
          dataClass: "REAL_DATA",
          error: "SEARCH_WEB requires payload.query",
          usage: null,
          estimatedCost: null,
        });
      }
      const count = Math.min(10, Math.max(1, typeof body?.count === "number" ? Math.floor(body.count) : 5));
      try {
        const response = await fetchWithTimeout(
          `${API}?q=${encodeURIComponent(query)}&count=${count}`,
          {
            headers: {
              "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY ?? "",
              Accept: "application/json",
            },
          },
          this.timeoutMs,
        );
        if (!response.ok) {
          return finish({
            status: errorClassToStatus(classifyHttpError(response.status, `HTTP ${response.status}`)),
            externalId: null,
            output: null,
            rawDataAvailable: false,
            dataClass: "REAL_DATA",
            error: sanitizeErrorMessage(`brave HTTP ${response.status}`),
            usage: null,
            estimatedCost: null,
          });
        }
        const data = (await response.json()) as {
          web?: { results?: Array<{ title: string; url: string; description: string }> };
        };
        const results = data.web?.results ?? [];
        return finish({
          status: "SUCCEEDED",
          externalId: null,
          output: { query, results },
          rawDataAvailable: true,
          dataClass: "REAL_DATA",
          error: null,
          usage: null,
          estimatedCost: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "execution failed";
        return finish({
          status: errorClassToStatus(classifyHttpError(null, message)),
          externalId: null,
          output: null,
          rawDataAvailable: false,
          dataClass: "REAL_DATA",
          error: sanitizeErrorMessage(message),
          usage: null,
          estimatedCost: null,
        });
      }
    },
  };
}

export function createRedditAdapter(): IntegrationAdapter {
  const NAME = "reddit";
  return {
    name: NAME,
    type: "RESEARCH",
    description:
      "Reddit public search — pain-point and community-demand research signals (no API key required).",
    capabilities: SEARCH_CAPS,
    requiredEnvVars: [],
    timeoutMs: 10_000,
    maxRetries: 2,

    validateConfiguration(): AdapterConfig {
      // Reddit needs no credentials: always configured.
      return { environment: resolveEnvironment(), requiredEnvVars: [], presentEnvVars: [] };
    },

    async healthCheck(): Promise<HealthCheckResult> {
      const startedAt = Date.now();
      const config = this.validateConfiguration();
      const base = {
        adapterName: NAME,
        capabilities: [...SEARCH_CAPS],
        environment: config.environment,
      };
      try {
        const response = await fetchWithTimeout(
          "https://www.reddit.com/search.json?q=test&limit=1&raw_json=1",
          { headers: { Accept: "application/json" } },
          10_000,
        );
        return {
          ...base,
          status: statusFromHttp(response.ok, response.status),
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          error: response.ok ? null : sanitizeErrorMessage(`reddit HTTP ${response.status}`),
        };
      } catch (error) {
        return {
          ...base,
          status: "FAILED",
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          error: sanitizeErrorMessage(error instanceof Error ? error.message : "health probe failed"),
        };
      }
    },

    async execute(action: string, payload: unknown, context: ExecutionContext): Promise<ExecutionResult> {
      const startedAt = new Date().toISOString();
      const finish = makeFinish(NAME, action, startedAt);
      if (action !== "SEARCH_POSTS") {
        return finish(blockedResult(NAME, action));
      }
      const body = payload as { query?: unknown; limit?: unknown } | null;
      const query = typeof body?.query === "string" ? body.query.trim().slice(0, 200) : "";
      if (!query) {
        return finish({
          status: "FAILED",
          externalId: null,
          output: null,
          rawDataAvailable: false,
          dataClass: "REAL_DATA",
          error: "SEARCH_POSTS requires payload.query",
          usage: null,
          estimatedCost: null,
        });
      }
      const limit = Math.min(10, Math.max(1, typeof body?.limit === "number" ? Math.floor(body.limit) : 5));
      try {
        const response = await fetchWithTimeout(
          `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${limit}&raw_json=1`,
          { headers: { Accept: "application/json" } },
          this.timeoutMs,
        );
        if (!response.ok) {
          return finish({
            status: errorClassToStatus(classifyHttpError(response.status, `HTTP ${response.status}`)),
            externalId: null,
            output: null,
            rawDataAvailable: false,
            dataClass: "REAL_DATA",
            error: sanitizeErrorMessage(`reddit HTTP ${response.status}`),
            usage: null,
            estimatedCost: null,
          });
        }
        const data = (await response.json()) as {
          data?: { children?: Array<{ data?: { id?: string; title?: string; permalink?: string } }> };
        };
        const posts = (data.data?.children ?? []).map((child) => ({
          id: child.data?.id ?? null,
          title: child.data?.title ?? "",
          permalink: child.data?.permalink ? `https://www.reddit.com${child.data.permalink}` : null,
        }));
        return finish({
          status: "SUCCEEDED",
          externalId: posts[0]?.id ?? null,
          output: { query, posts },
          rawDataAvailable: true,
          dataClass: "REAL_DATA",
          error: null,
          usage: null,
          estimatedCost: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "execution failed";
        return finish({
          status: errorClassToStatus(classifyHttpError(null, message)),
          externalId: null,
          output: null,
          rawDataAvailable: false,
          dataClass: "REAL_DATA",
          error: sanitizeErrorMessage(message),
          usage: null,
          estimatedCost: null,
        });
      }
    },
  };
}

export function createSerpApiTrendsAdapter(): IntegrationAdapter {
  const REQUIRED: readonly string[] = ["SERPAPI_API_KEY"];
  const NAME = "google-trends";
  return {
    name: NAME,
    type: "RESEARCH",
    description:
      "Google Trends via SerpApi — normalized relative search-interest signals (Google offers no official Trends API).",
    capabilities: SEARCH_CAPS,
    requiredEnvVars: REQUIRED,
    timeoutMs: 15_000,
    maxRetries: 2,

    validateConfiguration(): AdapterConfig {
      return adapterConfig(REQUIRED);
    },

    async healthCheck(): Promise<HealthCheckResult> {
      const startedAt = Date.now();
      const config = this.validateConfiguration();
      const base = {
        adapterName: NAME,
        capabilities: [...SEARCH_CAPS],
        environment: config.environment,
      };
      if (config.presentEnvVars.length < REQUIRED.length) {
        return {
          ...base,
          status: "NOT_CONFIGURED",
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          error: null,
        };
      }
      try {
        // MEDIUM-5: built by the shared helper so the credential-bearing URL
        // exists in exactly one auditable place and is never stringified into
        // a log line or diagnostic.
        const url = buildSerpApiUrl({ engine: "google_trends", q: "test" }, process.env.SERPAPI_API_KEY ?? "");
        const response = await fetchWithTimeout(url.toString(), { headers: { Accept: "application/json" } }, 15_000);
        return {
          ...base,
          status: statusFromHttp(response.ok, response.status),
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          error: response.ok ? null : sanitizeErrorMessage(`serpapi HTTP ${response.status}`),
        };
      } catch (error) {
        return {
          ...base,
          status: "FAILED",
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          error: sanitizeErrorMessage(redactProviderCredentialInMessage(error)),
        };
      }
    },

    async execute(action: string, payload: unknown, context: ExecutionContext): Promise<ExecutionResult> {
      const startedAt = new Date().toISOString();
      const finish = makeFinish(NAME, action, startedAt);
      if (action !== "SEARCH_TRENDS") {
        return finish(blockedResult(NAME, action));
      }
      if (!process.env.SERPAPI_API_KEY) {
        return finish(unavailableResult(NAME, "SERPAPI_API_KEY"));
      }
      const body = payload as { query?: unknown } | null;
      const query = typeof body?.query === "string" ? body.query.trim().slice(0, 200) : "";
      if (!query) {
        return finish({
          status: "FAILED",
          externalId: null,
          output: null,
          rawDataAvailable: false,
          dataClass: "REAL_DATA",
          error: "SEARCH_TRENDS requires payload.query",
          usage: null,
          estimatedCost: null,
        });
      }
      try {
        const url = buildSerpApiUrl({ engine: "google_trends", q: query }, process.env.SERPAPI_API_KEY ?? "");
        const response = await fetchWithTimeout(url.toString(), { headers: { Accept: "application/json" } }, this.timeoutMs);
        if (!response.ok) {
          return finish({
            status: errorClassToStatus(classifyHttpError(response.status, `HTTP ${response.status}`)),
            externalId: null,
            output: null,
            rawDataAvailable: false,
            dataClass: "REAL_DATA",
            error: sanitizeErrorMessage(`serpapi HTTP ${response.status}`),
            usage: null,
            estimatedCost: null,
          });
        }
        const data = (await response.json()) as { interest_over_time?: { timeline_data?: unknown[] }; serpapi_metadata?: unknown };
        const timeline = data.interest_over_time?.timeline_data ?? [];
        return finish({
          status: "SUCCEEDED",
          externalId: null,
          output: { query, points: timeline.length, timeline },
          rawDataAvailable: true,
          dataClass: "REAL_DATA",
          error: null,
          usage: null,
          estimatedCost: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "execution failed";
        return finish({
          status: errorClassToStatus(classifyHttpError(null, message)),
          externalId: null,
          output: null,
          rawDataAvailable: false,
          dataClass: "REAL_DATA",
          error: sanitizeErrorMessage(message),
          usage: null,
          estimatedCost: null,
        });
      }
    },
  };
}
