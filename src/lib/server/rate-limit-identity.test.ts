import { afterEach, describe, expect, it } from "vitest";
import { clientIdentity, rateLimit, rateLimitIdentity, resetRateLimits } from "./rate-limit";

/**
 * MEDIUM-1 — the auth routes keyed their rate limit on `x-forwarded-for`,
 * which is a client-supplied header. Forging a new value per request produced a
 * fresh bucket every time, so the per-address limit was trivially bypassable.
 * `rateLimitIdentity` keeps the per-address bucket (so one address cannot lock
 * everyone out) and adds a bucket keyed on nothing the client controls.
 */
function requestWithForwardedFor(value: string): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "x-forwarded-for": value },
  });
}

const OPTIONS = { max: 3, windowMs: 60_000, scopeMax: 6 };

describe("clientIdentity", () => {
  it("reads the first forwarded address and bounds its length", () => {
    expect(clientIdentity(requestWithForwardedFor("1.2.3.4, 5.6.7.8"))).toBe("1.2.3.4");
    expect(clientIdentity(requestWithForwardedFor("9".repeat(200)))).toHaveLength(64);
  });

  it("falls back to a shared bucket when no address is present", () => {
    expect(clientIdentity(new Request("http://localhost/"))).toBe("unknown");
  });
});

describe("rateLimitIdentity", () => {
  afterEach(() => resetRateLimits());

  it("allows up to the per-identity maximum from one address", () => {
    const request = requestWithForwardedFor("1.2.3.4");
    const results = [0, 1, 2, 3].map(() => rateLimitIdentity(request, "login", "a@example.test", OPTIONS));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
  });

  it("does not let one address consume another address's bucket", () => {
    for (let i = 0; i < 4; i += 1) rateLimitIdentity(requestWithForwardedFor("1.1.1.1"), "login", "a", OPTIONS);
    expect(rateLimitIdentity(requestWithForwardedFor("2.2.2.2"), "login", "a", OPTIONS).allowed).toBe(true);
  });

  it("cannot be bypassed by forging a new x-forwarded-for on every request", () => {
    // Each request presents a brand-new forged address, so the per-identity
    // bucket is always fresh. The client-independent scope bucket is what
    // actually bounds this, and it must eventually refuse.
    const allowed: boolean[] = [];
    for (let i = 0; i < OPTIONS.scopeMax + 3; i += 1) {
      allowed.push(rateLimitIdentity(requestWithForwardedFor(`10.0.0.${i}`), "login", "victim@example.test", OPTIONS).allowed);
    }
    expect(allowed.filter(Boolean).length).toBeLessThanOrEqual(OPTIONS.scopeMax);
    expect(allowed[allowed.length - 1]).toBe(false);
  });

  it("keeps separate scopes independent", () => {
    for (let i = 0; i < 5; i += 1) rateLimitIdentity(requestWithForwardedFor("3.3.3.3"), "login", "a", OPTIONS);
    expect(rateLimitIdentity(requestWithForwardedFor("3.3.3.3"), "register", "a", OPTIONS).allowed).toBe(true);
  });

  it("does not count a refused attempt against a different identity's scope budget twice", () => {
    const request = requestWithForwardedFor("4.4.4.4");
    const first = rateLimitIdentity(request, "login", "a", OPTIONS);
    const second = rateLimitIdentity(request, "login", "a", OPTIONS);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
  });
});

describe("rateLimit", () => {
  afterEach(() => resetRateLimits());

  it("keeps its original per-key behaviour", () => {
    const results = [0, 1, 2].map(() => rateLimit("scoped", "key", { max: 2, windowMs: 60_000 }));
    expect(results.map((r) => r.allowed)).toEqual([true, true, false]);
    expect(rateLimit("scoped", "other", { max: 2, windowMs: 60_000 }).allowed).toBe(true);
  });
});
