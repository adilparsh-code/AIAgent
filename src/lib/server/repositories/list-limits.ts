/**
 * MEDIUM-3 — bounded owner-facing list reads.
 *
 * The owner-scoped list queries in the repositories issued an unbounded
 * `findMany` and returned every matching row. A sufficiently active account
 * therefore turned `GET /api/opportunities` (and products, experiments and
 * revenue) into a full-table read and a full JSON response: memory pressure on
 * the server, a very large payload on the wire, and no way for the caller to
 * know that what it received is only a slice.
 *
 * The bound is applied at the repository, next to the query, so no route can
 * reintroduce an unbounded read. Ordering is always explicit so the bounded
 * slice is deterministic.
 *
 * Stated honestly: this caps how much a single list response can contain. It
 * is not pagination — a caller that needs older rows still has no way to reach
 * them yet. That is a known, documented gap, not a silent truncation: the cap
 * is a named constant, and the list endpoints keep their existing response
 * shape.
 */
export const LIST_READ_LIMITS = {
  /** Max rows a single owner-facing list read may return. */
  MAX_LIST_ROWS: 200,
  /** Max rows a single parent-scoped read (e.g. one opportunity's revenue) may return. */
  MAX_SCOPED_ROWS: 500,
} as const;

/** Clamp a requested list size into the bounded range. */
export function boundedListRows(requested: unknown, max: number = LIST_READ_LIMITS.MAX_LIST_ROWS): number {
  const value = typeof requested === "number" && Number.isFinite(requested) ? Math.floor(requested) : max;
  return Math.min(Math.max(1, value), max);
}
