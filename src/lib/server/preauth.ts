import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Pre-authentication state for the TOTP login step (TOTP-2FA hardening).
 *
 * When a password is valid but 2FA is enabled, login does NOT create a
 * session. Instead the server holds a short-lived, server-side record scoped
 * only to the pending authentication and returns an opaque token in the
 * response body. Properties:
 *
 * - The token is a random 256-bit value; only its SHA-256 hash is retained.
 * - The record lives in process memory with a 5-minute TTL — restarts and
 *   expiry both invalidate it. Nothing is persisted to the database.
 * - The token is never set as a cookie, so it cannot satisfy the page
 *   middleware or any protected API: those require the `ail_session` cookie,
 *   which does not exist until 2FA succeeds.
 * - peek does not consume; a correct second factor consumes the record, so a
 *   token can complete at most one login.
 */

const PREAUTH_TTL_MS = 5 * 60 * 1000;
const MAX_TRACKED = 10_000;

interface PreAuthEntry {
  userId: string;
  email: string;
  expiresAt: number;
}

const store = new Map<string, PreAuthEntry>();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createPreAuthToken(user: { id: string; email: string }): { token: string; expiresAt: Date } {
  const now = Date.now();
  if (store.size > MAX_TRACKED) {
    for (const [key, entry] of store) if (entry.expiresAt <= now) store.delete(key);
  }
  const token = randomBytes(32).toString("base64url");
  store.set(hashToken(token), { userId: user.id, email: user.email, expiresAt: now + PREAUTH_TTL_MS });
  return { token, expiresAt: new Date(now + PREAUTH_TTL_MS) };
}

/** Look up a pending authentication without consuming it. Null when unknown/expired. */
export function peekPreAuthToken(token: unknown): { userId: string; email: string } | null {
  if (typeof token !== "string" || token.length === 0 || token.length > 128) return null;
  const key = hashToken(token);
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return { userId: entry.userId, email: entry.email };
}

/** Complete (consume) a pending authentication. Idempotent. */
export function consumePreAuthToken(token: unknown): void {
  if (typeof token !== "string") return;
  store.delete(hashToken(token));
}

/** Test helper. */
export function resetPreAuthTokensForTests(): void {
  store.clear();
}

export const PREAUTH_TTL_SECONDS = PREAUTH_TTL_MS / 1000;
