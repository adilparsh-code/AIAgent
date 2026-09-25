import { describe, expect, it } from "vitest";
import { resolveSambaNovaBaseUrl } from "./sambanova";

const DEFAULT = "https://api.sambanova.ai/v1/chat/completions";

/**
 * MEDIUM-8 — `SAMBANOVA_BASE_URL` is documented in `docs/environment.md` and
 * `docs/PRODUCTION_ACTIVATION.md` and advertised in
 * `SAMBANOVA_OPTIONAL_ENV_VARS`, but the endpoint was a hardcoded constant and
 * the variable was never read. An operator who set it silently kept talking to
 * the public endpoint.
 */
describe("resolveSambaNovaBaseUrl", () => {
  it("uses the documented default when the variable is unset", () => {
    expect(resolveSambaNovaBaseUrl({})).toBe(DEFAULT);
    expect(resolveSambaNovaBaseUrl({ SAMBANOVA_BASE_URL: "" })).toBe(DEFAULT);
    expect(resolveSambaNovaBaseUrl({ SAMBANOVA_BASE_URL: "   " })).toBe(DEFAULT);
  });

  it("honours a valid https override — the documented behaviour", () => {
    expect(resolveSambaNovaBaseUrl({ SAMBANOVA_BASE_URL: "https://eu.api.sambanova.ai/v1/chat/completions" })).toBe(
      "https://eu.api.sambanova.ai/v1/chat/completions",
    );
  });

  it("never sends the bearer credential to a plaintext endpoint", () => {
    expect(resolveSambaNovaBaseUrl({ SAMBANOVA_BASE_URL: "http://insecure.test/v1" })).toBe(DEFAULT);
  });

  it("falls back to the default for a malformed or absurd value rather than throwing", () => {
    expect(resolveSambaNovaBaseUrl({ SAMBANOVA_BASE_URL: "not-a-url" })).toBe(DEFAULT);
    expect(resolveSambaNovaBaseUrl({ SAMBANOVA_BASE_URL: "https://" })).toBe(DEFAULT);
    expect(resolveSambaNovaBaseUrl({ SAMBANOVA_BASE_URL: `https://x.test/${"a".repeat(500)}` })).toBe(DEFAULT);
  });
});
