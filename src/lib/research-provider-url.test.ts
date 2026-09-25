import { describe, expect, it } from "vitest";
import { buildSerpApiUrl, containsProviderCredential, redactProviderUrl } from "./research-provider-url";

/**
 * MEDIUM-5 — the SerpApi key travels in a query parameter because that is the
 * provider's authentication contract. These tests pin the guarantee that the
 * credential can never survive into a surfaced URL, a log line or a stored
 * diagnostic.
 */
describe("buildSerpApiUrl", () => {
  it("targets the real SerpApi endpoint and carries the key", () => {
    const url = buildSerpApiUrl({ engine: "google_trends", q: "test" }, "SECRET-KEY");
    expect(url.origin + url.pathname).toBe("https://serpapi.com/search.json");
    expect(url.searchParams.get("engine")).toBe("google_trends");
    expect(url.searchParams.get("api_key")).toBe("SECRET-KEY");
  });
});

describe("redactProviderUrl", () => {
  it("removes the SerpApi credential entirely, keeping no prefix of it", () => {
    const url = buildSerpApiUrl({ engine: "google_trends", q: "test" }, "SUPER-SECRET-KEY-VALUE");
    const redacted = redactProviderUrl(url);
    expect(redacted).not.toContain("SUPER-SECRET-KEY-VALUE");
    expect(redacted).not.toContain("SUPER");
    expect(redacted).toContain("api_key=");
    expect(redacted).toContain("REDACTED");
  });

  it("keeps the non-secret parameters so the URL is still diagnosable", () => {
    const url = buildSerpApiUrl({ engine: "google_trends", q: "analytics" }, "SECRET");
    const redacted = redactProviderUrl(url);
    expect(redacted).toContain("engine=google_trends");
    expect(redacted).toContain("q=analytics");
  });

  it("redacts other common credential parameter names", () => {
    for (const name of ["apikey", "key", "token", "access_token"]) {
      const redacted = redactProviderUrl(`https://provider.test/x?${name}=LEAKME`);
      expect(redacted).not.toContain("LEAKME");
    }
  });

  it("redacts a URL supplied as a string", () => {
    expect(redactProviderUrl("https://serpapi.com/search.json?api_key=LEAKME")).not.toContain("LEAKME");
  });

  it("bounds the output length", () => {
    const long = `https://serpapi.com/search.json?q=${"x".repeat(5_000)}`;
    expect(redactProviderUrl(long, 100).length).toBeLessThanOrEqual(100);
  });

  it("never throws on an unparseable value", () => {
    expect(redactProviderUrl("not a url")).toBe("[unparseable provider url]");
  });
});

describe("containsProviderCredential", () => {
  it("detects a credential in a query string", () => {
    expect(containsProviderCredential("https://x.test/a?api_key=SECRET")).toBe(true);
    expect(containsProviderCredential("https://x.test/a?engine=google_trends")).toBe(false);
  });
});
