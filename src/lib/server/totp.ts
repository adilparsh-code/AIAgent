import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * RFC 6238 TOTP (HMAC-SHA1, 30-second step, 6 digits) — the configuration
 * Google Authenticator and every standard authenticator app uses by default.
 * Only node:crypto primitives; no third-party dependencies.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accept ±1 step (±30s clock drift) — RFC 6238 §5.2 recommends a window. */
export const TOTP_WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** 20 secret bytes = 160 bits — matches the RFC 4226 recommendation. */
const SECRET_BYTES = 20;

export class TotpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TotpConfigError";
  }
}

/** Cryptographically random Base32 secret (RFC 4648 alphabet, no padding). */
export function generateTotpSecret(): string {
  const bytes = randomBytes(SECRET_BYTES);
  let output = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** Decode Base32 (RFC 4648, case-insensitive, padding tolerated). Null when invalid. */
export function decodeBase32(input: string): Buffer | null {
  const clean = input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  if (clean.length === 0) return null;
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** HMAC-SHA1 based HOTP (RFC 4226) truncated to `digits` (RFC 4226 §5.3). */
function hotp(key: Buffer, counter: number, digits: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(Math.floor(counter)), 0);
  const digest = createHmac("sha1", key).update(buffer).digest();
  const offset = digest[19] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** TOTP at a concrete unix-second timestamp (used by tests to generate codes). */
export function totpAt(secret: string, unixSeconds: number): string {
  const key = decodeBase32(secret);
  if (!key) throw new TotpConfigError("Invalid TOTP secret encoding");
  return hotp(key, Math.floor(unixSeconds / TOTP_STEP_SECONDS), TOTP_DIGITS);
}

/**
 * Verify a submitted code against the secret at `nowMs`, accepting the
 * ±TOTP_WINDOW step drift window. Constant-time comparison per candidate;
 * input is normalized (digits only, length-capped) before comparison.
 */
export function verifyTotpCode(
  secret: string,
  code: unknown,
  options: { nowMs?: number; window?: number } = {},
): boolean {
  if (typeof code !== "string") return false;
  const normalized = code.replace(/[^0-9]/g, "");
  if (normalized.length !== TOTP_DIGITS) return false;
  const key = decodeBase32(secret);
  if (!key) return false;

  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const currentStep = Math.floor(nowSeconds / TOTP_STEP_SECONDS);
  const window = options.window ?? TOTP_WINDOW;
  const submitted = Buffer.from(normalized, "utf8");

  for (let drift = -window; drift <= window; drift += 1) {
    const candidate = Buffer.from(hotp(key, currentStep + drift, TOTP_DIGITS), "utf8");
    if (candidate.length === submitted.length && timingSafeEqual(candidate, submitted)) {
      return true;
    }
  }
  return false;
}

/**
 * otpauth:// URI (RFC 6238 / Key URI Format) for authenticator apps.
 * Label and issuer are percent-encoded; the issuer parameter is included so
 * Google Authenticator shows the app name alongside the account.
 */
export function buildOtpauthUri(accountLabel: string, secret: string, issuer: string): string {
  const label = encodeURIComponent(issuer) + ":" + encodeURIComponent(accountLabel);
  // Key URI Format expects percent-encoding; URLSearchParams would emit '+'
  // for spaces, so each parameter is encoded explicitly.
  const params = [
    `secret=${encodeURIComponent(secret)}`,
    `issuer=${encodeURIComponent(issuer)}`,
    `algorithm=SHA1`,
    `digits=${TOTP_DIGITS}`,
    `period=${TOTP_STEP_SECONDS}`,
  ].join("&");
  return `otpauth://totp/${label}?${params}`;
}

/** Cryptographically random one-time recovery codes (Crockford-like, unambiguous charset). */
export function generateRecoveryCodes(count: number): string[] {
  const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/I/L look-alikes
  const CODE_LEN = 10;
  const GROUPS = 2;
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const bytes = randomBytes(CODE_LEN);
    let code = "";
    for (let j = 0; j < CODE_LEN; j += 1) {
      code += ALPHABET[bytes[j] % ALPHABET.length];
      if (j === CODE_LEN / GROUPS - 1) code += "-";
    }
    codes.push(code);
  }
  return codes;
}
