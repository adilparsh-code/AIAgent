import { afterEach, describe, expect, it } from "vitest";
import { DbUnavailableError, getPrisma, isDbUnavailableError } from "./db";

afterEach(() => {
  delete process.env.DATABASE_URL;
});

describe("getPrisma", () => {
  it("throws when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;
    expect(() => getPrisma()).toThrow(DbUnavailableError);
    try {
      getPrisma();
    } catch (error) {
      expect(isDbUnavailableError(error)).toBe(true);
    }
  });
});
