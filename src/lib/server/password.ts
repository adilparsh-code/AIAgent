import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

/**
 * Password hashing with Node's built-in scrypt (OWASP-recommended parameters:
 * N=16384, r=8, p=1, 64-byte key). Encoded format:
 *   scrypt$N$r$p$<salt-hex>$<hash-hex>
 * Self-describing so parameters can be raised later without breaking existing
 * hashes. No home-made cryptography — only node:crypto primitives.
 */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Verify a password against a stored hash. Returns false for malformed or
 * unknown hash formats (e.g. hashes written by a future/other scheme) rather
 * than throwing, so login can never leak formatting details.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const parts = storedHash.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const N = Number.parseInt(parts[1] ?? "", 10);
    const r = Number.parseInt(parts[2] ?? "", 10);
    const p = Number.parseInt(parts[3] ?? "", 10);
    const salt = Buffer.from(parts[4] ?? "", "hex");
    const expected = Buffer.from(parts[5] ?? "", "hex");
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
    if (salt.length === 0 || expected.length === 0) return false;
    if (N < 16384 || N > 2 ** 21 || r < 8 || p < 1) return false; // refuse degenerate params
    const derived = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
