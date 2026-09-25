/**
 * MEDIUM-10 — a `returnTo` query parameter must never become an open redirect.
 *
 * The auth pages previously accepted any value that merely started with "/",
 * which includes the protocol-relative form `//evil.example`. After a
 * successful sign-in the page called `window.location.assign(returnTo)`, so
 * `?returnTo=//evil.example` sent the freshly authenticated user to another
 * origin. The backslash variant (`/\evil.example`) is normalised to a
 * protocol-relative URL by some browsers, so it is rejected too.
 *
 * The rule is deliberately narrow: a usable `returnTo` is a same-origin
 * absolute path. Anything else falls back to the supplied default.
 */
export const DEFAULT_RETURN_TO = "/";
export const MAX_RETURN_TO_LENGTH = 512;

const CONTROL_CHARACTERS = new RegExp("[\\u0000-\\u001f\\u007f]");

/** True only for a same-origin absolute path such as `/opportunities?x=1`. */
export function isSafeReturnTo(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_RETURN_TO_LENGTH) return false;
  // Must be an absolute path...
  if (!value.startsWith("/")) return false;
  // ...but NOT protocol-relative (`//host`) and not the backslash form
  // (`/\host`) that some browsers normalise into `//host`.
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  // No control characters, and no backslash anywhere a browser could
  // reinterpret as a scheme separator.
  if (CONTROL_CHARACTERS.test(value)) return false;
  if (value.includes("\\")) return false;
  return true;
}

/**
 * Resolve a `returnTo` query parameter to a safe destination.
 * Untrusted input always degrades to `fallback`, never to an attacker origin.
 * The fallback is validated too, so a caller cannot reintroduce the bug by
 * passing an unsafe default.
 */
export function safeReturnTo(value: unknown, fallback: string = DEFAULT_RETURN_TO): string {
  if (isSafeReturnTo(value)) return value;
  return isSafeReturnTo(fallback) ? fallback : DEFAULT_RETURN_TO;
}
