import "server-only";
import { getPrisma, isDbUnavailableError } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/server/password";
import { ForbiddenError, UnauthorizedError } from "@/lib/authz-errors";

/**
 * Authentication service (Phase 6A): registration, login, logout.
 *
 * Security properties:
 * - Passwords are scrypt-hashed (see password.ts); plaintext never persisted.
 * - Login failures use ONE generic message whether or not the email exists.
 * - DISABLED accounts are rejected at login and every session resolution.
 * - passwordHash never leaves this module; API responses map to a safe shape.
 */

const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 100;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
}

export function toPublicUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  createdAt: Date;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role === "ADMIN" ? "ADMIN" : "USER",
    status: user.status === "DISABLED" ? "DISABLED" : "ACTIVE",
    createdAt: user.createdAt.toISOString(),
  };
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH) : "";
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length >= 3 && email.includes("@");
}

export class AuthValidationError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "AuthValidationError";
  }
}

/** Register a new USER account. Duplicate emails return 409 without leaking rows. */
export async function registerUser(input: {
  email: unknown;
  password: unknown;
  name?: unknown;
}): Promise<PublicUser> {
  const email = normalizeEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";
  const name =
    typeof input.name === "string" ? input.name.trim().slice(0, MAX_NAME_LENGTH) : "";

  if (!validEmail(email)) throw new AuthValidationError("A valid email is required");
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AuthValidationError("Password is too long");
  }

  const prisma = getPrisma();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new AuthValidationError("An account with this email already exists", 409);

  const passwordHash = await hashPassword(password);
  try {
    const user = await prisma.user.create({
      data: { email, passwordHash, name, role: "USER", status: "ACTIVE" },
    });
    return toPublicUser(user);
  } catch (error) {
    // Race on the unique constraint — same answer as the pre-check.
    if (
      error instanceof Error &&
      (error.message.includes("Unique constraint") || error.message.includes("P2002"))
    ) {
      throw new AuthValidationError("An account with this email already exists", 409);
    }
    throw error;
  }
}

/**
 * Verify credentials. Always throws the same UnauthorizedError for unknown
 * emails, wrong passwords, and disabled accounts; does not reveal which.
 */
export async function authenticateUser(input: {
  email: unknown;
  password: unknown;
}): Promise<PublicUser> {
  const email = normalizeEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";
  if (!email || !password) throw new UnauthorizedError("Invalid email or password");

  const user = await getPrisma().user.findUnique({ where: { email } });
  const storedHash = user?.passwordHash ?? "";
  // Verify even for unknown users with a dummy hash so response timing does
  // not reveal whether the email exists.
  const passwordOk = await verifyPassword(password, storedHash || "scrypt$16384$8$1$00$00");
  if (!user || !passwordOk) throw new UnauthorizedError("Invalid email or password");
  if (user.status !== "ACTIVE") throw new UnauthorizedError("Invalid email or password");

  return toPublicUser(user);
}

export async function getUserById(id: string): Promise<PublicUser | null> {
  const user = await getPrisma().user.findUnique({ where: { id } });
  return user ? toPublicUser(user) : null;
}

export { isDbUnavailableError };
