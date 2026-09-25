import { describe, expect, it } from "vitest";
import { pickFields, readWriteBody, WRITE_INPUT_LIMITS, type FieldSpec } from "./write-input";

/**
 * MEDIUM-2 — the opportunity/product/revenue create routes previously read
 * `request.json()` with no cap and spread the whole body into the repository,
 * so an authenticated caller could send an arbitrarily large payload and
 * mass-assign any field it liked.
 */
describe("readWriteBody", () => {
  it("accepts a normal JSON object", () => {
    const result = readWriteBody('{"name":"A"}');
    expect(result).toEqual({ ok: true, body: { name: "A" } });
  });

  it("treats an empty body as an empty object", () => {
    expect(readWriteBody("")).toEqual({ ok: true, body: {} });
  });

  it("refuses a body over the size cap instead of buffering it", () => {
    const huge = `{"name":"${"a".repeat(WRITE_INPUT_LIMITS.MAX_BODY_BYTES)}"}`;
    expect(readWriteBody(huge)).toEqual({ ok: false, error: "Request body too large", status: 413 });
  });

  it("refuses malformed JSON", () => {
    expect(readWriteBody("{oops")).toEqual({ ok: false, error: "Invalid JSON body", status: 400 });
  });

  it("refuses a non-object payload", () => {
    expect(readWriteBody("[1,2,3]")).toMatchObject({ ok: false, status: 400 });
    expect(readWriteBody('"a string"')).toMatchObject({ ok: false, status: 400 });
    expect(readWriteBody(null)).toMatchObject({ ok: false, status: 400 });
  });
});

const SPEC: FieldSpec = {
  title: { kind: "string", required: true, maxLength: 100 },
  score: { kind: "number", min: 0, max: 100 },
  tags: { kind: "stringArray", maxLength: 50 },
  status: { kind: "string", oneOf: ["IDEA", "VALIDATED"], default: "IDEA" },
};

describe("pickFields", () => {
  it("keeps only the allowlisted fields and drops everything else", () => {
    const result = pickFields(
      { title: "A", isSample: true, ownerId: "someone-else", halalStatus: "NOT_ALLOWED" },
      SPEC,
    );
    expect(result).toEqual({ ok: true, value: { title: "A", status: "IDEA" } });
  });

  it("never lets a client-supplied owner id through", () => {
    const result = pickFields({ title: "A", ownerId: "attacker" }, SPEC);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).not.toHaveProperty("ownerId");
  });

  it("requires a required field", () => {
    expect(pickFields({}, SPEC)).toEqual({ ok: false, error: "title is required", status: 400 });
  });

  it("rejects an empty required string", () => {
    expect(pickFields({ title: "   " }, SPEC)).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a value outside an enum rather than coercing it", () => {
    expect(pickFields({ title: "A", status: "PRODUCED" }, SPEC)).toEqual({
      ok: false,
      error: "status must be one of: IDEA, VALIDATED",
      status: 400,
    });
  });

  it("rejects an out-of-range or non-finite number", () => {
    expect(pickFields({ title: "A", score: 1000 }, SPEC)).toMatchObject({ ok: false, status: 400 });
    expect(pickFields({ title: "A", score: -1 }, SPEC)).toMatchObject({ ok: false, status: 400 });
    expect(pickFields({ title: "A", score: "50" }, SPEC)).toMatchObject({ ok: false, status: 400 });
    expect(pickFields({ title: "A", score: Number.NaN }, SPEC)).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects an over-long string", () => {
    expect(pickFields({ title: "x".repeat(101) }, SPEC)).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a non-array and an over-long array", () => {
    expect(pickFields({ title: "A", tags: "a" }, SPEC)).toMatchObject({ ok: false, status: 400 });
    expect(
      pickFields({ title: "A", tags: Array.from({ length: WRITE_INPUT_LIMITS.MAX_LIST_ITEMS + 1 }, () => "x") }, SPEC),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a non-string element inside a string array", () => {
    expect(pickFields({ title: "A", tags: ["ok", 5] }, SPEC)).toMatchObject({ ok: false, status: 400 });
  });

  it("applies the declared default when a field is omitted", () => {
    const result = pickFields({ title: "A" }, SPEC);
    expect(result).toEqual({ ok: true, value: { title: "A", status: "IDEA" } });
  });
});
