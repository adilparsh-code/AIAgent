import "server-only";

/**
 * Guarded facade for password hashing. Application code imports this module so
 * a Client Component can never pull the hashing primitive into the browser
 * bundle. Operator CLI scripts import `./password-core` directly because they
 * run outside the Next.js React Server Component condition.
 */
export { hashPassword, verifyPassword } from "./password-core";
