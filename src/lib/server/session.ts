import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getPrisma } from "@/lib/db";

/**
 * Session management (Phase 6A).
 *
 * - The browser holds only a random opaque token in an HttpOnly cookie.
 * - The database stores only the SHA-256 hash of that token, so a database
 *   leak never yields usable session tokens.
 * - The resolved identity always comes from the cookie server-side; client
 *   code can never assert a user id.
 */

export const SESSION_COOKIE_NAME = "ail_session";
/** 7 days. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const isProduction = process.env.NODE_ENV === "production";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DISABLED";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}


/** Safe session metadata returned to the authenticated user. Tokens and hashes are never exposed. */
export interface SessionInfo {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

/** List only the caller's own sessions, marking the current session without exposing secrets. */
export async function listUserSessions(
  userId: string,
  currentSessionId: string | null,
): Promise<SessionInfo[]> {
  const sessions = await getPrisma().session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { id: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    orderBy: { lastUsedAt: "desc" },
  });
  return sessions.map((session) => ({
    id: session.id,
    createdAt: session.createdAt.toISOString(),
    lastUsedAt: session.lastUsedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    isCurrent: session.id === currentSessionId,
  }));
}

/** Revoke one session only when it belongs to the authenticated user. */
export async function revokeUserSession(userId: string, sessionId: string): Promise<boolean> {
  const result = await getPrisma().session.deleteMany({
    where: { id: sessionId, userId },
  });
  return result.count > 0;
}

/** Revoke every session belonging to the user, optionally preserving the current session. */
export async function revokeAllUserSessions(
  userId: string,
  exceptSessionId?: string | null,
): Promise<number> {
  const result = await getPrisma().session.deleteMany({
    where: {
      userId,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
  });
  return result.count;
}

/** Create a server-side session row and return the raw token (never persisted in plaintext). */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getPrisma().session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  });
  return { token, expiresAt };
}

/** Set the session cookie on a NextResponse. HttpOnly; Secure in production; SameSite=Lax. */
export function setSessionCookie(response: NextResponseLike, token: string, expiresAt: Date): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: NextResponseLike): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Invalidate the current session server-side (used by logout). */
export async function destroySessionByToken(token: string): Promise<void> {
  await getPrisma().session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value ?? null;
}

/**
 * Resolve the authenticated user from the request's session cookie.
 * Returns null when unauthenticated, the session is expired/invalid, or the
 * account is DISABLED. Sliding renewal of lastUsedAt keeps rows fresh but is
 * best-effort (never blocks the request).
 */

/** Resolve both the current session id and authenticated identity. */
export async function getSessionContext(): Promise<
  { sessionId: string; user: AuthenticatedUser } | null
> {
  const token = await readSessionToken();
  if (!token) return null;

  const prisma = getPrisma();
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, expiresAt: true, user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  const { id, email, name, role, status } = session.user;
  if (status !== "ACTIVE") return null;

  prisma.session
    .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return {
    sessionId: session.id,
    user: { id, email, name, role, status },
  };
}

export async function getSessionUser(): Promise<AuthenticatedUser | null> {
  const context = await getSessionContext();
  return context?.user ?? null;
}
export interface NextResponseLike {
  cookies: {
    set(options: {
      name: string;
      value: string;
      httpOnly: boolean;
      secure: boolean;
      sameSite: "lax" | "strict" | "none";
      path: string;
      expires?: Date;
      maxAge?: number;
    }): unknown;
  };
}
