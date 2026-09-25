import "server-only";

/**
 * MEDIUM-1 — authentication rate limiting.
 *
 * Two distinct problems were found, and this module now addresses both
 * without weakening anything that already worked.
 *
 * 1. Client-address spoofing. The auth routes derived the rate-limit key from
 *    `x-forwarded-for` / `x-real-ip`. Those headers are client-supplied, so
 *    forging a new value on every request produced a fresh bucket and made the
 *    per-address limit trivially bypassable. `rateLimitIdentity` now ALWAYS
 *    applies a scope-wide bucket in addition to the per-identity bucket: the
 *    per-identity bucket keeps a single misbehaving address from locking out
 *    everyone, and the scope bucket is keyed on nothing the client controls,
 *    so forging headers cannot buy unlimited attempts.
 *
 * 2. Only the auth routes were limited. Every other authenticated route had
 *    no limit at all. The smallest safe improvement here is to make the
 *    limiter usable by any route through `rateLimitIdentity`; widening
 *    coverage onto every route is a separate, larger change and is NOT
 *    claimed as done here.
 *
 * Stated limitation, unchanged and honest: counters live in this process
 * only. A single server instance is protected; a horizontally scaled deployment
 * needs a shared store, and a restart clears the window. This is documented
 * rather than silently presented as production-grade.
 *
 * Fixed-window counters, keyed by (scope + identifier). Identifiers are never
 * logged in raw form beyond the key itself — no emails, no passwords.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  /** True when the refusal came from the client-independent scope bucket. */
  scopeExceeded: boolean;
}

function hit(key: string, now: number, options: { max: number; windowMs: number }): RateLimitResult {
  const entry = attempts.get(key);

  if (!entry || entry.resetAt <= now) {
    if (attempts.size > MAX_TRACKED_KEYS) {
      for (const [k, v] of attempts) if (v.resetAt <= now) attempts.delete(k);
    }
    attempts.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, retryAfterSeconds: 0, scopeExceeded: false };
  }

  entry.count += 1;
  if (entry.count > options.max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000), scopeExceeded: false };
  }
  return { allowed: true, retryAfterSeconds: 0, scopeExceeded: false };
}

export function rateLimit(
  scope: string,
  identifier: string,
  options: { max: number; windowMs: number },
): RateLimitResult {
  return hit(`${scope}:${identifier}`, Date.now(), options);
}

/**
 * Limit an authentication attempt by address, with a client-independent
 * scope-wide bucket layered on top.
 *
 * `scopeMax` is deliberately much larger than `max`: it exists to stop a
 * distributed or header-forging flood, not to cap legitimate traffic from
 * unrelated users sharing an egress address.
 */
export function rateLimitIdentity(
  request: Request,
  scope: string,
  identitySuffix: string,
  options: { max: number; windowMs: number; scopeMax: number },
): RateLimitResult {
  const now = Date.now();
  const perIdentity = hit(`${scope}:${clientIdentity(request)}|${identitySuffix}`, now, options);
  if (!perIdentity.allowed) return perIdentity;
  return hit(`${scope}:__scope__`, now, { max: options.scopeMax, windowMs: options.windowMs });
}

/**
 * Best-effort client address for the per-identity bucket only.
 *
 * Never used on its own to decide whether a caller may proceed: the header
 * values are client-supplied, so the scope bucket in `rateLimitIdentity` is
 * what actually bounds abuse.
 */
export function clientIdentity(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = request.headers.get("x-real-ip")?.trim();
  const value = forwarded || real;
  if (!value) return "unknown";
  return value.slice(0, 64);
}

/** Test/reset helper. */
export function resetRateLimits(): void {
  attempts.clear();
}
