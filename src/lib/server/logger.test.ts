/**
 * HIGH-7 regression suite: secrets never reach the centralized logger.
 *
 * The bug this locks down: `apiError()` passed raw `error.message` straight to
 * `logger.databaseError()`, and the central `emit()` serialized whatever it
 * received. A single new call site that forgot to sanitize would persist
 * credentials in the log sink. Redaction is now enforced centrally.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeLogFields, sanitizeLogValue, sanitizeOperationalMessage } from "@/lib/operational-events";
import { logger } from "@/lib/server/logger";

/** Every value that must never survive into a log line. */
const SECRETS = {
  bearer: "abcDEF123456ghiJKL789mno",
  basic: "dXNlcjpwYXNzd29yZDEyMw==",
  skKey: "sk-ABCDEFGHIJKLMNOPQRSTUVWX",
  providerKey: "AIzaSyD-ExampleKeyValue_1234567890",
  githubToken: "ghp_ExampleTokenValue1234567890",
  awsAccessKey: "AKIAIOSFODNN7EXAMPLE",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  sessionId: "sess-AbCdEfGhIjKlMnOpQrStUv",
  dbUrl: "postgresql://pguser:sup3rs3cret@db.internal:5432/ai_income_lab",
  redisUrl: "redis://:hunter2password@cache.internal:6379/0",
  password: "correct-horse-battery-staple",
};

let logSpies: Array<ReturnType<typeof vi.spyOn>>;

/** Captured log output across console.log/warn/error. */
function capturedLogs(): string {
  return logSpies
    .flatMap((spy) => spy.mock.calls.map((call) => String(call[0])))
    .join("\n");
}

beforeEach(() => {
  logSpies = [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sanitizeOperationalMessage redaction", () => {
  it("redacts every common credential shape", () => {
    const cases: Array<[string, string]> = [
      [`Authorization: Bearer ${SECRETS.bearer}`, SECRETS.bearer],
      [`authorization=Basic ${SECRETS.basic}`, SECRETS.basic],
      [`Cookie: session_token=abc123`, "session_token"],
      [`api_key=${SECRETS.skKey}`, SECRETS.skKey],
      [`apiKey: ${SECRETS.providerKey}`, SECRETS.providerKey],
      [`password: ${SECRETS.password}`, SECRETS.password],
      [`client_secret: shhhhh`, "shhhhh"],
      [`token=${SECRETS.sessionId}`, SECRETS.sessionId],
      [`invalid api key ${SECRETS.skKey}`, SECRETS.skKey],
      [`github token ${SECRETS.githubToken}`, SECRETS.githubToken],
      [`aws ${SECRETS.awsAccessKey}`, SECRETS.awsAccessKey],
      [`jwt ${SECRETS.jwt}`, SECRETS.jwt],
      [`failed to connect ${SECRETS.dbUrl}`, "sup3rs3cret"],
      [`cache ${SECRETS.redisUrl}`, "hunter2password"],
      [`dsn postgres://u:p@host:5432/db`, "postgres://u:p@host:5432/db"],
    ];
    for (const [input, forbidden] of cases) {
      const safe = sanitizeOperationalMessage(input);
      expect(safe, `input: ${input}`).not.toContain(forbidden);
    }
  });

  it("keeps non-secret diagnostics so real errors stay debuggable", () => {
    const safe = sanitizeOperationalMessage(
      "Invalid `prisma.opportunity.findUnique()` invocation in /app/src/lib/server/repositories/research.ts:137:29",
    );
    expect(safe).toContain("prisma.opportunity.findUnique()");
    expect(safe).toContain("research.ts");
  });

  it("collapses newlines and caps length", () => {
    expect(sanitizeOperationalMessage("a\nb\rc")).toBe("a b c");
    expect(sanitizeOperationalMessage("x".repeat(2_000)).length).toBeLessThanOrEqual(500);
  });

  it("never returns an empty diagnostic", () => {
    expect(sanitizeOperationalMessage("   ").length).toBeGreaterThan(0);
  });
});

describe("sanitizeLogValue", () => {
  it("redacts secrets nested in objects and arrays", () => {
    const sanitized = sanitizeLogValue({
      error: new Error(`connect ${SECRETS.dbUrl}`),
      errors: [`Bearer ${SECRETS.bearer}`, `api_key=${SECRETS.skKey}`],
      nested: { deeper: { secretValue: `password: ${SECRETS.password}` } },
    }) as Record<string, unknown>;

    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain("sup3rs3cret");
    expect(serialized).not.toContain(SECRETS.bearer);
    expect(serialized).not.toContain(SECRETS.skKey);
    expect(serialized).not.toContain(SECRETS.password);
    expect(serialized).toContain("REDACTED");
  });

  it("reduces an Error to a safe name/message pair", () => {
    const sanitized = sanitizeLogValue(new Error(`db down ${SECRETS.dbUrl}`)) as {
      name: string;
      message: string;
    };
    expect(sanitized.name).toBe("Error");
    expect(sanitized.message).not.toContain("sup3rs3cret");
  });

  it("preserves non-secret scalars", () => {
    expect(sanitizeLogValue(42)).toBe(42);
    expect(sanitizeLogValue(true)).toBe(true);
    expect(sanitizeLogValue(null)).toBeNull();
    expect(sanitizeLogValue(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01T00:00:00.000Z");
  });

  it("bounds arrays and nesting depth", () => {
    const long = sanitizeLogValue(Array.from({ length: 100 }, (_, index) => `item-${index}`)) as unknown[];
    expect(long.length).toBeLessThanOrEqual(26);
    expect(String(long[long.length - 1])).toContain("more");

    const deep = sanitizeLogValue({ a: { b: { c: { d: { e: "too deep" } } } } });
    expect(JSON.stringify(deep)).toContain("TRUNCATED");
  });

  it("handles a self-referencing object without throwing", () => {
    const cyclic: Record<string, unknown> = { name: "cyclic" };
    cyclic.self = cyclic;
    expect(() => sanitizeLogValue(cyclic)).not.toThrow();
  });
});

describe("centralized logger redaction", () => {
  it("never logs a raw provider API key", () => {
    logger.databaseError("provider", `HTTP 401 invalid api key ${SECRETS.skKey}`);
    const output = capturedLogs();
    expect(output).toContain("database.error");
    expect(output).not.toContain(SECRETS.skKey);
  });

  it("never logs a database connection string", () => {
    logger.databaseError("db.connect", `could not connect ${SECRETS.dbUrl}`);
    expect(capturedLogs()).not.toContain("sup3rs3cret");
  });

  it("never logs a bearer token or cookie header", () => {
    logger.researchFailed("run-1", "opp-1", [`Authorization: Bearer ${SECRETS.bearer}`]);
    expect(capturedLogs()).not.toContain(SECRETS.bearer);
  });

  it("redacts secrets inside array fields", () => {
    logger.researchFailed("run-2", "opp-2", [`password: ${SECRETS.password}`, `token=${SECRETS.sessionId}`]);
    const output = capturedLogs();
    expect(output).not.toContain(SECRETS.password);
    expect(output).not.toContain(SECRETS.sessionId);
  });

  it("redacts secrets inside nested object fields", () => {
    logger.integrationHealthChecked(
      "brave-search",
      "HEALTHY",
      `config ${SECRETS.dbUrl} key ${SECRETS.providerKey}`,
    );
    const output = capturedLogs();
    expect(output).not.toContain(SECRETS.providerKey);
    expect(output).not.toContain("sup3rs3cret");
  });

  it("still records useful, non-secret context", () => {
    logger.researchCompleted("run-3", "opp-3", "COMPLETED", 4, "VALIDATED");
    const output = capturedLogs();
    expect(output).toContain("research.completed");
    expect(output).toContain("run-3");
    expect(output).toContain("VALIDATED");
  });

  it("sanitizes every field of a record, not just the message", () => {
    const sanitized = sanitizeLogFields({
      operation: "op",
      message: `token=${SECRETS.sessionId}`,
      errors: [`Bearer ${SECRETS.bearer}`],
      count: 3,
      flag: false,
    });
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain(SECRETS.sessionId);
    expect(serialized).not.toContain(SECRETS.bearer);
    expect(sanitized.count).toBe(3);
    expect(sanitized.flag).toBe(false);
  });
});
