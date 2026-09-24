import { afterAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../db";

const hasDb = Boolean(process.env.DATABASE_URL);
const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cookieJar = vi.hoisted(() => ({ current: {} as Record<string, string> }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: (name: string) => cookieJar.current[name] ? { name, value: cookieJar.current[name] } : undefined }) }));

function request(url: string, cookies?: Record<string, string>): Request {
  cookieJar.current = cookies ?? {};
  return new Request(url, { headers: cookies ? { cookie: Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ") } : {} });
}
async function createUser(label: string) {
  const { hashPassword } = await import("@/lib/server/password");
  return getPrisma().user.create({ data: { email: `phase18-${label}-${uniqueSuffix()}@example.com`, name: `Phase 18 ${label}`, passwordHash: await hashPassword("password-P18-123"), role: "USER", status: "ACTIVE" } });
}

describe.skipIf(!hasDb)("Phase 18 opportunity validation (real PostgreSQL)", () => {
  const prisma = getPrisma();
  const userIds: string[] = [];
  const opportunityIds: string[] = [];
  afterAll(async () => {
    for (const id of opportunityIds) await prisma.opportunity.delete({ where: { id } }).catch(() => undefined);
    for (const id of userIds) await prisma.user.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("keeps validation owner-scoped and masks foreign opportunities as 404", async () => {
    const a = await createUser("A");
    const b = await createUser("B");
    userIds.push(a.id, b.id);
    const ownedByB = `phase18-opp-${uniqueSuffix()}`;
    opportunityIds.push(ownedByB);
    await prisma.opportunity.create({ data: { id: ownedByB, title: "Validation isolation", category: "SAAS", businessModel: "SAAS", estimatedStartupCost: 100, demandScore: 60, competitionScore: 40, commercialIntentScore: 55, automationScore: 50, differentiationScore: 45, monetizationStrengthScore: 50, halalScore: 80, halalStatus: "HALAL", overallScore: 60, confidence: 40, status: "IDEA", risks: [], isSample: false, ownerId: b.id } });
    const { createSession } = await import("@/lib/server/session");
    const session = await createSession(a.id);
    const cookies = { ail_session: session.token };
    const { GET } = await import("@/app/api/opportunities/[id]/validation/route");
    const response = await GET(request(`http://localhost/api/opportunities/${ownedByB}/validation`, cookies), { params: { id: ownedByB } });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Opportunity not found");
  });
});
