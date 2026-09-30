import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption-at-rest for TOTP secrets (TOTP-2FA hardening).
 *
 * The key comes exclusively from the environment: `TOTP_ENCRYPTION_KEY` must
 * decode to exactly 32 bytes (64 hex chars or base64). It is never hard-coded,
 * never logged, and never returned to clients.
 *
 * Ciphertext format: v1.<iv>.<tag>.<ciphertext> (base64url parts). AES-256-GCM
 * is the standard Node.js AEAD primitive — no custom cryptography.
 */

export class SecretBoxConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxConfigError";
  }
}

const KEY_ENV_VAR = "TOTP_ENCRYPTION_KEY";
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env[KEY_ENV_VAR];
  if (!raw) {
    throw new SecretBoxConfigError(
      `Server misconfiguration: ${KEY_ENV_VAR} is not set. Generate one with: openssl rand -hex 32`,
    );
  }
  const normalized = raw.trim();
  cachedKey = /^[0-9a-fA-F]{64}$/.test(normalized)
    ? Buffer.from(normalized, "hex")
    : Buffer.from(normalized, "base64");
  if (cachedKey.length !== 32) {
    cachedKey = null;
    throw new SecretBoxConfigError(
      `Server misconfiguration: ${KEY_ENV_VAR} must decode to exactly 32 bytes (256 bits).`,
    );
  }
  return cachedKey;
}

/** Encrypt plaintext to the at-rest format. Never log inputs or outputs. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", loadKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const part = (b: Buffer) => b.toString("base64url");
  return [VERSION, part(iv), part(tag), part(encrypted)].join(".");
}

/** Decrypt an at-rest payload. Throws SecretBoxConfigError if misconfigured; returns null on tampering/bad format. */
export function decryptSecret(payload: string): string | null {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const iv = Buffer.from(parts[1] ?? "", "base64url");
    const tag = Buffer.from(parts[2] ?? "", "base64url");
    const ciphertext = Buffer.from(parts[3] ?? "", "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) return null;
    const decipher = createDecipheriv("aes-256-gcm", loadKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Test helper: clear the cached key so env changes are picked up between tests. */
export function resetSecretBoxForTests(): void {
  cachedKey = null;
}
