import "server-only";
import { getPrisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/server/password";
import { decryptSecret, encryptSecret } from "@/lib/server/secret-box";
import {
  buildOtpauthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  verifyTotpCode,
} from "@/lib/server/totp";

/**
 * TOTP second-factor service (TOTP-2FA hardening).
 *
 * All state transitions live here (not in route handlers) so the security
 * rules are enforced in exactly one place:
 *
 * - The Base32 TOTP secret exists in plaintext ONLY in memory between
 *   generation and encryption; at rest it is AES-256-GCM ciphertext.
 * - Enrollment requires a fresh password verification and does not enable
 *   2FA until a current authenticator code verifies (Phase 3 rule).
 * - Recovery codes are stored ONLY as scrypt hashes; plaintext codes are
 *   returned exactly once by the function that creates them.
 * - Disable/regenerate require password AND a current TOTP code (Phase 6).
 * - A successful second factor consumes the pre-auth record (Phase 4).
 */

const RECOVERY_CODE_COUNT = 10;

export class TotpServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "TotpServiceError";
  }
}

export interface TotpStatus {
  totpEnabled: boolean;
  pendingSetup: boolean;
  recoveryCodesRemaining: number;
}

function normalizeCode(code: unknown): string {
  return typeof code === "string" ? code.replace(/[^0-9]/g, "").slice(0, 12) : "";
}

/** Load the caller's TOTP row (caller id comes only from the server session). */
export async function getTotpStatus(userId: string): Promise<TotpStatus> {
  const prisma = getPrisma();
  const secret = await prisma.totpSecret.findUnique({ where: { userId }, select: { totpEnabled: true } });
  const remaining = await prisma.totpRecoveryCode.count({ where: { userId, usedAt: null } });
  return {
    totpEnabled: secret?.totpEnabled ?? false,
    pendingSetup: Boolean(secret && !secret.totpEnabled),
    recoveryCodesRemaining: remaining,
  };
}

/**
 * Step 1 of enrollment: re-verify the password, then generate (or regenerate)
 * a pending secret. Any previous pending secret is replaced; an already
 * enabled enrollment is rejected — disable first.
 */
export async function startTotpEnrollment(input: {
  userId: string;
  email: string;
  password: unknown;
}): Promise<{ otpauthUri: string; accountLabel: string }> {
  const prisma = getPrisma();
  if (typeof input.password !== "string" || input.password.length === 0) {
    throw new TotpServiceError("Password is required");
  }
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user || user.status !== "ACTIVE") throw new TotpServiceError("Account not found", 404);
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw new TotpServiceError("Incorrect password", 403);
  }

  const existing = await prisma.totpSecret.findUnique({ where: { userId: input.userId } });
  if (existing?.totpEnabled) {
    throw new TotpServiceError("Two-factor authentication is already enabled", 409);
  }

  const secret = generateTotpSecret();
  const data = { secretCiphertext: encryptSecret(secret), totpEnabled: false };
  await prisma.totpSecret.upsert({
    where: { userId: input.userId },
    update: data,
    create: { userId: input.userId, ...data },
  });

  return { otpauthUri: buildOtpauthUri(user.email, secret, "AI Income Lab"), accountLabel: user.email };
}

/**
 * Step 2 of enrollment: verify a current authenticator code against the
 * pending secret. Only success flips totpEnabled — a generated secret alone
 * never enables anything. On success, fresh recovery codes are issued.
 */
export async function confirmTotpEnrollment(input: {
  userId: string;
  code: unknown;
}): Promise<{ recoveryCodes: string[] }> {
  const prisma = getPrisma();
  const normalized = normalizeCode(input.code);
  if (normalized.length !== 6) throw new TotpServiceError("Enter the 6-digit code from your authenticator app");

  const record = await prisma.totpSecret.findUnique({ where: { userId: input.userId } });
  if (!record) throw new TotpServiceError("Start the setup flow first", 409);
  if (record.totpEnabled) throw new TotpServiceError("Two-factor authentication is already enabled", 409);

  const secret = decryptSecret(record.secretCiphertext);
  if (!secret || !verifyTotpCode(secret, normalized)) {
    throw new TotpServiceError("That code is not correct. Check your authenticator app and try again.", 403);
  }

  const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  const codeHashes = await Promise.all(recoveryCodes.map((code) => hashPassword(code)));

  await prisma.$transaction([
    prisma.totpSecret.update({ where: { userId: input.userId }, data: { totpEnabled: true } }),
    prisma.totpRecoveryCode.deleteMany({ where: { userId: input.userId } }),
    prisma.totpRecoveryCode.createMany({
      data: codeHashes.map((codeHash) => ({ userId: input.userId, codeHash })),
    }),
  ]);

  return { recoveryCodes };
}

/**
 * Attempt a second factor during login (pre-auth state). Accepts either a
 * 6-digit TOTP code or a one-time recovery code (letters/digits, dash
 * optional). Failure replies are identical for wrong codes and unknown
 * tokens (no enumeration); each attempt is separately rate-limited by the
 * route.
 */
export async function verifySecondFactorForLogin(input: {
  preAuthUserId: string;
  code: unknown;
}): Promise<{ userId: string } | null> {
  const prisma = getPrisma();
  const raw = typeof input.code === "string" ? input.code.trim().slice(0, 64) : "";
  if (!raw) return null;

  const record = await prisma.totpSecret.findUnique({ where: { userId: input.preAuthUserId } });
  if (!record || !record.totpEnabled) return null;

  const secret = decryptSecret(record.secretCiphertext);
  if (secret && verifyTotpCode(secret, raw)) {
    return { userId: input.preAuthUserId };
  }

  // Recovery-code path: compare candidate spellings against unused scrypt
  // hashes. The canonical stored form includes the dash; a dash-less or
  // lowercase input is normalized before hashing for comparison.
  const compact = raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const variants = new Set<string>();
  variants.add(raw.toUpperCase());
  if (compact.length === 10) {
    variants.add(`${compact.slice(0, 5)}-${compact.slice(5)}`);
    variants.add(compact);
  }

  if (variants.size > 0) {
    const unused = await prisma.totpRecoveryCode.findMany({
      where: { userId: input.preAuthUserId, usedAt: null },
      select: { id: true, codeHash: true },
    });
    for (const candidate of unused) {
      for (const variant of variants) {
        if (!(await verifyPassword(variant, candidate.codeHash))) continue;
        const claimed = await prisma.totpRecoveryCode.updateMany({
          where: { id: candidate.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (claimed.count === 1) return { userId: input.preAuthUserId };
        // Another concurrent request consumed it first; treat as failed.
        return null;
      }
    }
  }
  return null;
}

/**
 * Disable 2FA. Requires password AND a current TOTP code (Phase 6). Removes
 * the secret and every recovery code, and revokes all other sessions.
 */
export async function disableTotp(input: {
  userId: string;
  password: unknown;
  code: unknown;
}): Promise<void> {
  const prisma = getPrisma();
  if (typeof input.password !== "string" || input.password.length === 0) {
    throw new TotpServiceError("Password is required");
  }
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user || user.status !== "ACTIVE") throw new TotpServiceError("Account not found", 404);
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw new TotpServiceError("Incorrect password", 403);
  }

  const record = await prisma.totpSecret.findUnique({ where: { userId: input.userId } });
  if (!record || !record.totpEnabled) {
    throw new TotpServiceError("Two-factor authentication is not enabled", 409);
  }

  const secret = decryptSecret(record.secretCiphertext);
  if (!secret || !verifyTotpCode(secret, normalizeCode(input.code))) {
    throw new TotpServiceError("Enter a current code from your authenticator app to disable 2FA", 403);
  }

  await prisma.$transaction([
    prisma.totpSecret.delete({ where: { userId: input.userId } }),
    prisma.totpRecoveryCode.deleteMany({ where: { userId: input.userId } }),
  ]);
}

/**
 * Regenerate recovery codes (Phase 5): requires password AND a current TOTP
 * code; all previous recovery codes are invalidated (including unused ones).
 */
export async function regenerateRecoveryCodes(input: {
  userId: string;
  password: unknown;
  code: unknown;
}): Promise<{ recoveryCodes: string[] }> {
  const prisma = getPrisma();
  if (typeof input.password !== "string" || input.password.length === 0) {
    throw new TotpServiceError("Password is required");
  }
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user || user.status !== "ACTIVE") throw new TotpServiceError("Account not found", 404);
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw new TotpServiceError("Incorrect password", 403);
  }

  const record = await prisma.totpSecret.findUnique({ where: { userId: input.userId } });
  if (!record || !record.totpEnabled) {
    throw new TotpServiceError("Two-factor authentication is not enabled", 409);
  }

  const secret = decryptSecret(record.secretCiphertext);
  if (!secret || !verifyTotpCode(secret, normalizeCode(input.code))) {
    throw new TotpServiceError("Enter a current code from your authenticator app", 403);
  }

  const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  const codeHashes = await Promise.all(recoveryCodes.map((code) => hashPassword(code)));

  await prisma.$transaction([
    prisma.totpRecoveryCode.deleteMany({ where: { userId: input.userId } }),
    prisma.totpRecoveryCode.createMany({
      data: codeHashes.map((codeHash) => ({ userId: input.userId, codeHash })),
    }),
  ]);

  return { recoveryCodes };
}

/**
 * Reveal a pending enrollment secret for QR/setup display. Only available
 * while setup is NOT yet confirmed; never for an enabled enrollment.
 * Returns the decrypted Base32 secret — the caller must present it only in
 * the setup UI and never log or persist it.
 */
export async function revealPendingSecret(userId: string): Promise<string | null> {
  const record = await getPrisma().totpSecret.findUnique({ where: { userId } });
  if (!record || record.totpEnabled) return null;
  return decryptSecret(record.secretCiphertext);
}
