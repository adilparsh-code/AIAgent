import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

function requestFor(path: string, cookie?: string): NextRequest {
  const request = new NextRequest(`http://localhost${path}`);
  if (cookie) request.cookies.set("ail_session", cookie);
  return request;
}

describe("page-level auth middleware (Phase 15 boundary)", () => {
  it("redirects unauthenticated access to a console page to /login with a same-origin returnTo", () => {
    const response = middleware(requestFor("/opportunities"));
    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("returnTo=%2Fopportunities");
  });

  it("protects every operational console route", () => {
    for (const path of ["/handoffs", "/research", "/validation", "/evidence", "/agent-runs", "/audit-logs", "/health", "/providers"]) {
      const response = middleware(requestFor(path));
      expect(response.status, `expected redirect for ${path}`).toBe(307);
    }
  });

  it("lets public pages through without a session", () => {
    expect(middleware(requestFor("/")).status).toBe(200);
    expect(middleware(requestFor("/login")).status).toBe(200);
    expect(middleware(requestFor("/register")).status).toBe(200);
  });

  it("lets authenticated users through to protected pages", () => {
    expect(middleware(requestFor("/handoffs", "session-token")).status).toBe(200);
  });

  it("bounces authenticated users away from the login page", () => {
    const response = middleware(requestFor("/login", "session-token"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/");
  });
});
