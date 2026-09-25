/**
 * MEDIUM-5 — SerpApi credentials must not travel inside a URL that can be
 * surfaced.
 *
 * Google offers no official Trends API, so this project reaches Trends through
 * SerpApi, and SerpApi authenticates with an `api_key` query parameter. That
 * parameter is the provider's contract, so the smallest safe fix is NOT to
 * remove it (doing so would break a working integration) but to guarantee the
 * credential-bearing URL can never reach a log line, an error message or a
 * persisted diagnostic:
 *
 *   - every SerpApi request is built through `buildSerpApiUrl`, so the one
 *     place that knows about the credential is one function;
 *   - `redactProviderUrl` is applied to any URL that is turned into text, and
 *     it removes the credential rather than truncating the string, so a
 *     partially-redacted key can never survive;
 *   - error paths report the provider and the HTTP status only.
 *
 * Residual risk, stated honestly: the key is still present in the outbound
 * request line to serpapi.com, because that is how SerpApi authenticates. It
 * is over HTTPS to the provider and is never written to AIAgent's own logs.
 */
export const SERPAPI_SEARCH_ENDPOINT = "https://serpapi.com/search.json";

/** Query parameters whose values are always stripped from a surfaced URL. */
const CREDENTIAL_PARAMS = ["api_key", "apikey", "apiKey", "key", "token", "access_token"];

/**
 * Return a copy of `url` safe to log or include in an error: every credential
 * parameter is removed entirely (not shortened), and the result is bounded.
 */
export function redactProviderUrl(url: string | URL, maxLength = 300): string {
  let parsed: URL;
  try {
    parsed = new URL(typeof url === "string" ? url : url.toString());
  } catch {
    return "[unparseable provider url]";
  }
  for (const param of CREDENTIAL_PARAMS) {
    if (parsed.searchParams.has(param)) parsed.searchParams.set(param, "[REDACTED]");
  }
  // A key is never abbreviated: a prefix is still a secret prefix.
  parsed.search = parsed.search
    .replace(/(api_key|apikey|apiKey|key|token|access_token)=([^&]*)/gi, (_match, name: string) =>
      `${name}=[REDACTED]`,
    );
  return parsed.toString().slice(0, maxLength);
}

/** True when the string carries a SerpApi-style credential in its query. */
export function containsProviderCredential(value: string): boolean {
  return new RegExp(`(?:^|[?&])(?:${CREDENTIAL_PARAMS.join("|")})=[^&]+`, "i").test(value);
}

/**
 * The single place a SerpApi request URL is built.
 * The key is required by the provider's contract and is never returned to a
 * caller that might log it.
 */
export function buildSerpApiUrl(params: Record<string, string>, apiKey: string): URL {
  const url = new URL(SERPAPI_SEARCH_ENDPOINT);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("api_key", apiKey);
  return url;
}
