/**
 * Phase 6/10 — decision API integration tests (real PostgreSQL, real route
 * handlers): authentication, owner scoping (foreign opportunity → 404), sample
 * rows never expose private decision data, and the response shape contract.
 * Follows the existing multitenancy test conventions.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../db";

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

function makeRequest(
  url: string,
  init: { method?: string; body?: unknown; cookies?: Record<string, string> } = {},
) {
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

async function createOpportunity(options: { ownerId: string | null; isSample?: boolean }) {
  const prisma = getPrisma();
  const opportunityId = `dec-opp-${uniqueSuffix()}`;
  await prisma.opportunity.create({
    data: {
      id: opportunityId,
      title: `Decision test ${uniqueSuffix()}`,
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

describe.skipIf(!hasDb)("Opportunity decision API (real PostgreSQL)", () => {
  const prisma = getPrisma();
  const createdUserIds: string[] = [];
  const createdOpportunityIds: string[] = [];
  let userACookie: Record<string, string> = {};

  afterAll(async () => {
    for (const id of createdOpportunityIds) {
      await prisma.opportunity.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("setup: user A and user B; each owns an opportunity", async () => {
    const { hashPassword } = await import("@/lib/server/password");
    const { POST: login } = await import("@/app/api/auth/login/route");
    const password = "password-D-123";

    const userA = await prisma.user.create({
      data: {
        email: `dec-a-${uniqueSuffix()}@example.com`.toLowerCase(),
        name: "Decision A",
        passwordHash: await hashPassword(password),
        role: "USER",
        status: "ACTIVE",
      },
    });
    createdUserIds.push(userA.id);
    const userB = await prisma.user.create({
      data: {
        email: `dec-b-${uniqueSuffix()}@example.com`.toLowerCase(),
        name: "Decision B",
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
    createdOpportunityIds.push(await createOpportunity({ ownerId: userB.id }));
    createdOpportunityIds.push(await createOpportunity({ ownerId: null, isSample: true }));
  });

  it("requires authentication", async () => {
    const { GET } = await import("@/app/api/opportunities/[id]/decision/route");
    const ownedByB = createdOpportunityIds[1]!;
    const response = await GET(
      makeRequest(`http://localhost/api/opportunities/${ownedByB}/decision`),
      { params: { id: ownedByB } },
    );
    expect(response.status).toBe(401);
  });

  it("returns a deterministic owner-scoped decision for user A", async () => {
    const { GET } = await import("@/app/api/opportunities/[id]/decision/route");
    const ownedByA = createdOpportunityIds[0]!;
    const response1 = await GET(
      makeRequest(`http://localhost/api/opportunities/${ownedByA}/decision`, { cookies: userACookie }),
      { params: { id: ownedByA } },
    );
    expect(response1.status).toBe(200);
    const body1 = (await response1.json()) as { opportunityId: string; decision: { decision: string; generatedAt: string; explanation: string[]; recommendedAction: { action: string } } };
    expect(body1.opportunityId).toBe(ownedByA);
    expect(typeof body1.decision.decision).toBe("string");
    expect(Array.isArray(body1.decision.explanation)).toBe(true);

    const response2 = await GET(
      makeRequest(`http://localhost/api/opportunities/${ownedByA}/decision`, { cookies: userACookie }),
      { params: { id: ownedByA } },
    );
    const body2 = (await response2.json()) as { decision: { decision: string; decisionScore: number; evidenceGaps: unknown[]; recommendedAction: { action: string } } };
    // Deterministic payload aside from the timestamp.
    expect(body2.decision.decision).toBe(body1.decision.decision);
    expect(body2.decision.recommendedAction.action).toBe(body1.decision.recommendedAction.action);
  });

  it("foreign opportunity → indistinguishable 404 (no cross-user access)", async () => {
    const { GET } = await import("@/app/api/opportunities/[id]/decision/route");
    const ownedByB = createdOpportunityIds[1]!;
    const response = await GET(
      makeRequest(`http://localhost/api/opportunities/${ownedByB}/decision`, { cookies: userACookie }),
      { params: { id: ownedByB } },
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("Opportunity not found");
  });

  it("sample opportunity → 404 (samples never expose private decision data)", async () => {
    const { GET } = await import("@/app/api/opportunities/[id]/decision/route");
    const sampleRow = createdOpportunityIds[2]!;
    const response = await GET(
      makeRequest(`http://localhost/api/opportunities/${sampleRow}/decision`, { cookies: userACookie }),
      { params: { id: sampleRow } },
    );
    expect(response.status).toBe(404);
  });

  it("missing opportunity → 404", async () => {
    const { GET } = await import("@/app/api/opportunities/[id]/decision/route");
    const response = await GET(
      makeRequest("http://localhost/api/opportunities/does-not-exist/decision", { cookies: userACookie }),
      { params: { id: "does-not-exist" } },
    );
    expect(response.status).toBe(404);
  });
});
