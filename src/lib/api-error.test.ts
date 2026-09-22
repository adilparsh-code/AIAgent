import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError } from "./api-error";

function bodyOf(response: Response) {
  return response.json() as Promise<{ error: string }>;
}

function dbUnavailableError() {
  const error = new Error("DATABASE_URL is not configured");
  error.name = "DbUnavailableError"; // how isDbUnavailableError() detects it
  return error;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("apiError", () => {
  it("returns 503 with a safe message for database-unavailable errors", async () => {
    const response = apiError(dbUnavailableError());
    expect(response.status).toBe(503);
    await expect(bodyOf(response)).resolves.toEqual({ error: "DATABASE_URL is not configured" });
  });

  it("does NOT leak Prisma-style internal messages (file paths / query internals) on 500", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const leaky = new Error(
      "Invalid `prisma.opportunity.findUnique()` invocation in\n" +
        "/app/src/lib/server/repositories/research.ts:137:29\n" +
        "Argument id: Got invalid value",
    );
    const response = apiError(leaky, "Failed to run research");

    expect(response.status).toBe(500);
    const body = await bodyOf(response);
    expect(body.error).toBe("Failed to run research");
    expect(body.error).not.toContain("prisma");
    expect(body.error).not.toContain("research.ts");

    // Full details go to server logs, never to the client.
    expect(consoleSpy).toHaveBeenCalled();
    const logged = String(consoleSpy.mock.calls[0][0]);
    expect(logged).toContain("api.unhandled");
    expect(logged).toContain("research.ts");
  });

  it("returns the fallback for non-Error throwables without leaking", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = apiError({ weird: "object" }, "Request failed");
    expect(response.status).toBe(500);
    await expect(bodyOf(response)).resolves.toEqual({ error: "Request failed" });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("passes through deliberately-thrown 'Opportunity … was not found' as 404", async () => {
    const response = apiError(new Error("Opportunity abc123 was not found"));
    expect(response.status).toBe(404);
    await expect(bodyOf(response)).resolves.toEqual({ error: "Opportunity abc123 was not found" });
  });

  it("does not treat generic messages containing 'not found' as safe 404s", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = apiError(new Error("Something failed near /etc/passwd: not found"));
    expect(response.status).toBe(500);
    const body = await bodyOf(response);
    expect(body.error).not.toContain("passwd");
  });

  it("maps foreign-key violations to a safe 404", async () => {
    const response = apiError(new Error("Foreign key constraint failed on the field: `ResearchRun`"));
    expect(response.status).toBe(404);
    await expect(bodyOf(response)).resolves.toEqual({ error: "Related record not found" });
  });
});
