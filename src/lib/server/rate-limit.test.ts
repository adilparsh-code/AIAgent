import { describe, expect, it } from "vitest";
import {
  rateLimit,
  resetRateLimits,
} from "./rate-limit";

describe("auth rate limiting boundary", () => {
  it("blocks repeated attempts within the window", () => {
    resetRateLimits();
    for (let i = 0; i < 5; i++) {
      expect(rateLimit("login", "1.2.3.4|a@b.com", { max: 5, windowMs: 60_000 }).allowed).toBe(true);
    }
    const blocked = rateLimit("login", "1.2.3.4|a@b.com", { max: 5, windowMs: 60_000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keys are scoped: a different ip/email is not blocked", () => {
    resetRateLimits();
    for (let i = 0; i < 10; i++) {
      rateLimit("login", "1.2.3.4|a@b.com", { max: 10, windowMs: 60_000 });
    }
    expect(rateLimit("login", "5.6.7.8|a@b.com", { max: 10, windowMs: 60_000 }).allowed).toBe(true);
    expect(rateLimit("register", "1.2.3.4|a@b.com", { max: 10, windowMs: 60_000 }).allowed).toBe(true);
  });

  it("counters reset after the window", () => {
    resetRateLimits();
    for (let i = 0; i < 3; i++) {
      rateLimit("register", "9.9.9.9", { max: 3, windowMs: 10 });
    }
    expect(rateLimit("register", "9.9.9.9", { max: 3, windowMs: 10 }).allowed).toBe(false);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(rateLimit("register", "9.9.9.9", { max: 3, windowMs: 10 }).allowed).toBe(true);
        resolve();
      }, 15);
    });
  });
});
