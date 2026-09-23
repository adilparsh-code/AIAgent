import "server-only";

/**
 * Minimal in-memory rate limiter for authentication abuse protection.
 *
 * Limitation (documented deliberately): state lives in this process only. With
 * a single Next.js server instance this stops credential-stuffing bursts; a
 * horizontally scaled deployment needs a shared store (e.g. Redis) — deferred
 * rather than introducing fragile external infrastructure now.
 *
 * Fixed-window counters; keys are (scope + identifier). Never logs the
 * identifier contents beyond the key hash — no emails or passwords.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function rateLimit(
  scope: string,
  identifier: string,
  options: { max: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();
  const key = `${scope}:${identifier}`;
  const entry = attempts.get(key);

  if (!entry || entry.resetAt <= now) {
    if (attempts.size > MAX_TRACKED_KEYS) {
      for (const [k, v] of attempts) if (v.resetAt <= now) attempts.delete(k);
    }
    attempts.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  entry.count += 1;
  if (entry.count > options.max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test/reset helper. */
export function resetRateLimits(): void {
  attempts.clear();
}
