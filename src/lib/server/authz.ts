import "server-only";
import { getSessionUser, type AuthenticatedUser } from "@/lib/server/session";
import { UnauthorizedError, ForbiddenError } from "@/lib/authz-errors";

export type { AuthenticatedUser } from "@/lib/server/session";
export { UnauthorizedError, ForbiddenError } from "@/lib/authz-errors";

/**
 * Authorization layer (Phase 6A). Every protected API route calls one of these
 * helpers first; role/ownership logic is not scattered across route handlers.
 *
 * - requireUser(): any authenticated, ACTIVE account.
 * - requireAdmin(): authenticated AND role=ADMIN.
 * - requireOwnership(): the resolved record must already belong to the caller
 *   (ownerId === user.id). Records with no owner (pre-existing Phase 1-5 rows
 *   or sample data) are NOT claimable by arbitrary users — only an admin may
 *   access them, keeping single-tenant legacy data out of normal users' hands.
 *
 * The identity ALWAYS comes from the server-side session cookie; no client
 * payload, header, or URL parameter can influence authorization decisions.
 */

export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export async function requireAdmin(): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new ForbiddenError();
  return user;
}

/**
 * Enforce ownership of a resolved resource. `null` means "not found" for this
 * caller: a missing row and a row the caller does not own are deliberately
 * indistinguishable (404) to prevent existence probes across tenants.
 */
export function requireOwnership<T extends { ownerId: string | null }>(
  record: T | null,
  user: AuthenticatedUser,
): T {
  if (!record) throw new UnauthorizedError(); // mapped to 401 before auth; 404 handled per-route
  if (record.ownerId === user.id) return record;
  // Admins may administer unowned legacy/sample rows, but never another user's
  // private data — explicit rule, not blanket access.
  if (user.role === "ADMIN" && record.ownerId === null) return record;
  throw new ForbiddenError();
}

/**
 * Load-and-check helper for repositories that return null when the record does
 * not exist *or* is not visible to the caller (mapped to 404 by routes).
 */
export async function requireOwnedResource<T extends { ownerId: string | null }>(
  load: () => Promise<T | null>,
  user: AuthenticatedUser,
): Promise<T> {
  const record = await load();
  if (!record) throw new ForbiddenError("Resource not found"); // routes map to 404
  if (record.ownerId !== user.id && !(user.role === "ADMIN" && record.ownerId === null)) {
    throw new ForbiddenError("Resource not found");
  }
  return record;
}
