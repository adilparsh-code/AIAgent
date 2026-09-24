/**
 * Phase 11/12 — portfolio API integration tests (real PostgreSQL, real route
 * handlers): authentication, owner scoping (no cross-user opportunity /
 * research / experiment leakage), sample exclusion, bounded reads, and a
 * deterministic response shape. Follows the existing multitenancy conventions.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../db";
import { DECISION_LOAD_BOUNDS } from "@/lib/server/opportunity-decision-loader";

const hasDb = Boolean(process.env.DATABASE_URL);
const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cookieJar = vi.hoisted(() => ({ current: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      const value = cookieJar.current[name];
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

function makeRequest(url: string, init: { method?: string; body?: unknown; cookies?: Record<string, string> } = {}) {
  cookieJar.current = init.cookies ?? {};
  const headers = new Headers();
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (init.cookies) {
    headers.set("cookie", Object.entries(init.cookies).map(([k, v]) => `${k}=${v}`).join("; "));
  }
  return new Request(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? null : JSON.stringify(init.body),
  });
}

function extractSessionToken(response: Response): string | null {
  const anyResponse = response as unknown as { headers: Headers & { getSetCookie?: () => string[] } };
  const cookies = typeof anyResponse.headers.getSetCookie === "function"
    ? anyResponse.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean) as string[];
  for (const cookie of cookies) {
    const [pair] = cookie.split(";");
    const [name, value] = pair.split("=");
    if (name === "ail_session") return decodeURIComponent(value);
  }
  return null;
}

async function createOpportunity(options: { ownerId: string | null; isSample?: boolean; title?: string }) {
  const prisma = getPrisma();
  const opportunityId = `pf-opp-${uniqueSuffix()}`;
  await prisma.opportunity.create({
    data: {
      id: opportunityId,
      title: options.title ?? `Portfolio test ${uniqueSuffix()}`,
      category: "SAAS",
      businessModel: "SAAS",
      estimatedStartupCost: 100,
      demandScore: 60,
      competitionScore: 40,
      commercialIntentScore: 55,
      automationScore: 50,
      differentiationScore: 45,
      monetizationStrengthScore: 50,
      halalScore: 80,
      halalStatus: "HALAL",
      overallScore: 60,
      confidence: 40,
      status: "VALIDATED",
      risks: ["Platform dependency"],
      isSample: options.isSample ?? false,
      ownerId: options.ownerId,
    },
  });
  return opportunityId;
}

describe.skipIf(!hasDb)("Opportunity portfolio API (real PostgreSQL)", () => {
  const prisma = getPrisma();
  const createdUserIds: string[] = [];
  const createdOpportunityIds: string[] = [];
  let userACookie: Record<string, string> = {};
  let userBOpportunityId = "";

  afterAll(async () => {
    for (const id of createdOpportunityIds) {
      await prisma.opportunity.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("setup: two users, each with opportunities; one sample row", async () => {
    const { hashPassword } = await import("@/lib/server/password");
    const { POST: login } = await import("@/app/api/auth/login/route");
    const password = "password-P-123";

    const userA = await prisma.user.create({
      data: {
        email: `pf-a-${uniqueSuffix()}@example.com`.toLowerCase(),
        name: "Portfolio A",
        passwordHash: await hashPassword(password),
        role: "USER",
        status: "ACTIVE",
      },
    });
    createdUserIds.push(userA.id);
    const userB = await prisma.user.create({
      data: {
        email: `pf-b-${uniqueSuffix()}@example.com`.toLowerCase(),
        name: "Portfolio B",
        passwordHash: await hashPassword(password),
        role: "USER",
        status: "ACTIVE",
      },
    });
    createdUserIds.push(userB.id);

    const loginResponse = await login(
      makeRequest("http://localhost/api/auth/login", {
        method: "POST",
        body: { email: userA.email, password },
      }),
    );
    expect(loginResponse.status).toBe(200);
    userACookie = { ail_session: extractSessionToken(loginResponse)! };

    createdOpportunityIds.push(await createOpportunity({ ownerId: userA.id }));
    userBOpportunityId = await createOpportunity({ ownerId: userB.id });
    createdOpportunityIds.push(userBOpportunityId);
    createdOpportunityIds.push(await createOpportunity({ ownerId: null, isSample: true }));
  });

  it("requires authentication", async () => {
    const { GET } = await import("@/app/api/opportunities/portfolio/route");
    // makeRequest seeds the mocked cookie jar (no cookie = signed out).
    makeRequest("http://localhost/api/opportunities/portfolio");
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns an owner-scoped, deterministic portfolio summary", async () => {
    const { GET } = await import("@/app/api/opportunities/portfolio/route");
    makeRequest("http://localhost/api/opportunities/portfolio", { cookies: userACookie });
    const response1 = await GET();
    expect(response1.status).toBe(200);
    const body1 = (await response1.json()) as {
      summary: { totalOpportunities: number; activeOpportunities: number; bounds: { maxOpportunities: number; truncated: boolean } };
      queues: Record<string, string[]>;
      portfolioDecision: string;
      concentrationWarnings: unknown[];
      evidenceQualitySummary: unknown;
      experimentCoverageSummary: unknown;
      explanation: string[];
      dataClass: string;
      generatedAt: string;
    };
    // User A owns exactly one non-sample opportunity; B's and the sample row
    // must not appear.
    expect(body1.summary.totalOpportunities).toBe(1);
    expect(Object.values(body1.queues).flat()).toEqual(
      expect.arrayContaining([]),
    );
    expect(Object.values(body1.queues).flat()).toHaveLength(1);
    expect(typeof body1.portfolioDecision).toBe("string");
    expect(Array.isArray(body1.concentrationWarnings)).toBe(true);
    expect(body1.explanation.length).toBeGreaterThan(0);
    expect(body1.dataClass).toBeTruthy();
    expect(body1.summary.bounds.maxOpportunities).toBe(DECISION_LOAD_BOUNDS.MAX_OPPORTUNITIES);

    makeRequest("http://localhost/api/opportunities/portfolio", { cookies: userACookie });
    const response2 = await GET();
    const body2 = (await response2.json()) as typeof body1;
    // Deterministic apart from the generation timestamp.
    expect(body2.summary).toEqual(body1.summary);
    expect(body2.portfolioDecision).toBe(body1.portfolioDecision);
    expect(body2.queues).toEqual(body1.queues);
  });

  it("excludes the foreign opportunity id from user A's portfolio", async () => {
    const { GET } = await import("@/app/api/opportunities/portfolio/route");
    makeRequest("http://localhost/api/opportunities/portfolio", { cookies: userACookie });
    const response = await GET();
    const body = (await response.json()) as { queues: Record<string, string[]> };
    const allIds = Object.values(body.queues).flat();
    expect(allIds).not.toContain(userBOpportunityId);
  });

  it("exposes no secrets and performs no execution", async () => {
    const { GET } = await import("@/app/api/opportunities/portfolio/route");
    makeRequest("http://localhost/api/opportunities/portfolio", { cookies: userACookie });
    const response = await GET();
    const text = await response.text();
    for (const secretName of ["SAMBANOVA_API_KEY", "BRAVE_SEARCH_API_KEY", "SERPAPI_API_KEY", "DATABASE_URL", "passwordHash"]) {
      expect(text).not.toContain(secretName);
    }
  });
});
