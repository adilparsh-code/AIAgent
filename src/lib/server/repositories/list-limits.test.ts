import { describe, expect, it } from "vitest";
import { LIST_READ_LIMITS, boundedListRows } from "./list-limits";

/**
 * MEDIUM-3 — the owner-facing list queries were unbounded `findMany` calls, so
 * a sufficiently active account turned a list route into a full-table read and
 * a full JSON response. The cap lives at the repository so no route can
 * reintroduce an unbounded read.
 */
describe("boundedListRows", () => {
  it("defaults to the documented maximum", () => {
    expect(boundedListRows(undefined)).toBe(LIST_READ_LIMITS.MAX_LIST_ROWS);
    expect(boundedListRows(null)).toBe(LIST_READ_LIMITS.MAX_LIST_ROWS);
    expect(boundedListRows("nonsense")).toBe(LIST_READ_LIMITS.MAX_LIST_ROWS);
  });

  it("never exceeds the maximum, however large the request", () => {
    expect(boundedListRows(1_000_000)).toBe(LIST_READ_LIMITS.MAX_LIST_ROWS);
    expect(boundedListRows(Number.POSITIVE_INFINITY)).toBe(LIST_READ_LIMITS.MAX_LIST_ROWS);
  });

  it("never returns fewer than one row", () => {
    expect(boundedListRows(0)).toBe(1);
    expect(boundedListRows(-10)).toBe(1);
  });

  it("passes through a valid in-range request", () => {
    expect(boundedListRows(25)).toBe(25);
  });

  it("floors a fractional request", () => {
    expect(boundedListRows(10.9)).toBe(10);
  });

  it("clamps to a caller-supplied maximum", () => {
    expect(boundedListRows(1_000, 50)).toBe(50);
  });

  it("keeps the scoped cap strictly larger than the list cap", () => {
    expect(LIST_READ_LIMITS.MAX_SCOPED_ROWS).toBeGreaterThan(LIST_READ_LIMITS.MAX_LIST_ROWS);
  });
});
