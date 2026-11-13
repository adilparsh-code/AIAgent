import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "./password-core";

/**
 * One-time first-administrator bootstrap (Phase 0, authentication readiness).
 *
 * Design constraints:
 * - There is intentionally NO HTTP route for this. It runs only from an
 *   operator-invoked server-side command (`scripts/create-first-admin.ts`),
 *   so public users can never claim ADMIN.
 * - It is permitted only while the database contains no ADMIN at all.
 * - Concurrency is handled inside a Serializable transaction that first takes
 *   a PostgreSQL transaction-scoped advisory lock, so two simultaneous runs
 *   cannot both observe "no admin" and create two administrators.
 * - It reuses the project's existing scrypt password hashing; plaintext is
 *   never persisted, returned, or logged by this module.
 * - No schema change or migration is required: `role` and `status` already
 *   exist on `User` with the correct enums.
 *
 * Promotion of additional admins later is a separate, deliberate operation
 * (out of scope here) — this function is only the initial bootstrap.
 */

export const ADMIN_BOOTSTRAP_CONFIRMATION = "CREATE_FIRST_ADMIN";

/** The single most powerful account gets a stricter floor than the 8-char user minimum. */
const MIN_ADMIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 100;

export type AdminBootstrapErrorCode =
  | "CONFIRMATION_REQUIRED"
  | "INVALID_EMAIL"
  | "WEAK_PASSWORD"
  | "ADMIN_EXISTS"
  | "EMAIL_TAKEN";

export class AdminBootstrapError extends Error {
  constructor(
    message: string,
    readonly code: AdminBootstrapErrorCode,
  ) {
    super(message);
    this.name = "AdminBootstrapError";
  }
}

export interface FirstAdminInput {
  email: unknown;
  password: unknown;
  name?: unknown;
  /** Must equal ADMIN_BOOTSTRAP_CONFIRMATION; guards against accidental runs. */
  confirmation: unknown;
}

export interface FirstAdminResult {
  id: string;
  email: string;
  role: "ADMIN";
}

export function normalizeAdminEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH) : "";
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length >= 3;
}

/**
 * Create the first ADMIN account, or fail closed.
 *
 * @throws AdminBootstrapError when the confirmation phrase is missing, input is
 * invalid, an administrator already exists, or the email is already in use.
 */
export async function createFirstAdmin(
  prisma: PrismaClient,
  input: FirstAdminInput,
): Promise<FirstAdminResult> {
  if (input.confirmation !== ADMIN_BOOTSTRAP_CONFIRMATION) {
    throw new AdminBootstrapError(
      `Refusing to create an administrator without the explicit confirmation "${ADMIN_BOOTSTRAP_CONFIRMATION}".`,
      "CONFIRMATION_REQUIRED",
    );
  }

  const email = normalizeAdminEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";
  const name =
    typeof input.name === "string" ? input.name.trim().slice(0, MAX_NAME_LENGTH) : "";

  if (!validEmail(email)) {
    throw new AdminBootstrapError("A valid administrator email is required.", "INVALID_EMAIL");
  }
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new AdminBootstrapError(
      `Administrator password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`,
      "WEAK_PASSWORD",
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AdminBootstrapError("Administrator password is too long.", "WEAK_PASSWORD");
  }

  // Hash before opening the transaction so the advisory lock is held only for
  // the short existence check + insert (scrypt is intentionally slow).
  const passwordHash = await hashPassword(password);

  return prisma.$transaction(
    async (tx) => {
      // Transaction-scoped advisory lock keyed to this bootstrap concern.
      // Released automatically on commit/rollback.
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
        "aiagent:first-admin-bootstrap",
      );

      const existingAdmin = await tx.user.findFirst({
        where: { role: "ADMIN" },
        select: { id: true },
      });
      if (existingAdmin) {
        throw new AdminBootstrapError(
          "An administrator already exists; first-admin bootstrap is closed.",
          "ADMIN_EXISTS",
        );
      }

      const existingAccount = await tx.user.findUnique({
        where: { email },
        select: { id: true, role: true },
      });
      if (existingAccount) {
        throw new AdminBootstrapError(
          "An account with this email already exists. Sign in and promote it deliberately, or choose another email.",
          "EMAIL_TAKEN",
        );
      }

      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          name,
          // Role and status are set explicitly here, never from user input.
          role: "ADMIN",
          status: "ACTIVE",
        },
        select: { id: true, email: true, role: true },
      });

      return { id: created.id, email: created.email, role: "ADMIN" as const };
    },
    { isolationLevel: "Serializable", timeout: 15_000 },
  );
}
