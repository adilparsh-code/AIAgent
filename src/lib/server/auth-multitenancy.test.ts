/**
 * Phase 6A — cross-tenant security scenario (mandatory Step 16), tested at the
 * REAL route-handler level with two users against real PostgreSQL.
 *
 * User A and User B are registered through /api/auth/register. User B owns an
 * opportunity (plus its research run, handoff, and experiment). User A then
 * attempts to read, mutate, and delete each of them. Every attempt must be
 * DENIED — and, for IDOR resistance, must be indistinguishable from a missing
 * record (404) rather than an authorization leak (403 with existence info).
 *
 * Session identity comes from a cookie jar per user; no request ever supplies
 * a userId, mirroring the real client contract.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../db";

const hasDb = Boolean(process.env.DATABASE_URL);
const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Route handlers resolve the session via next/headers' cookies(). Outside the
// Next.js runtime we back it with a mutable jar that makeRequest() populates,
// so handlers run unmodified and the session always comes from the cookie.
const cookieJar = vi.hoisted(() => ({ current: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      const value = cookieJar.current[name];
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

// Minimal Next.js Request shim for route-handler invocation in vitest.
function makeRequest(url: string, init: { method?: string; body?: unknown; cookies?: Record<string, string> } = {}) {
  cookieJar.current = init.cookies ?? {};
  const headers = new Headers();
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (init.cookies) {
    const cookieHeader = Object.entries(init.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    headers.set("cookie", cookieHeader);
  }
  const bodyText = init.body === undefined ? null : JSON.stringify(init.body);
  return new Request(url, { method: init.method ?? "GET", headers, body: bodyText });
}

function readSetCookies(response: Response): string[] {
  const anyResponse = response as unknown as { headers: Headers & { getSetCookie?: () => string[] } };
  if (typeof anyResponse.headers.getSetCookie === "function") return anyResponse.headers.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function extractSessionToken(response: Response): string | null {
  for (const cookie of readSetCookies(response)) {
    const [pair] = cookie.split(";");
    const [name, value] = pair.split("=");
    if (name === "ail_session") return decodeURIComponent(value);
  }
  return null;
}

function makeParams(id: string) {
  return { params: { id } };
}

describe.skipIf(!hasDb)("Phase 6A authentication + multi-tenancy (real PostgreSQL)", () => {
  const prisma = getPrisma();
  const createdUserIds: string[] = [];
  const createdOpportunityIds: string[] = [];
  let userACookie: Record<string, string> = {};
  let userBCookie: Record<string, string> = {};

  afterAll(async () => {
    for (const id of createdOpportunityIds) {
      await prisma.opportunity.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("registers two users; sessions resolve to their own identity", async () => {
    const { POST: register } = await import("@/app/api/auth/register/route");

    const suffix = uniqueSuffix();
    const resA = await register(
      makeRequest("http://localhost/api/auth/register", {
        method: "POST",
        body: { email: `user-a-${suffix}@example.com`, password: "password-A-123", name: "User A" },
      }),
    );
    expect(resA.status).toBe(201);
    const tokenA = extractSessionToken(resA);
    expect(tokenA).toBeTruthy();
    userACookie = { ail_session: tokenA as string };

    const resB = await register(
      makeRequest("http://localhost/api/auth/register", {
        method: "POST",
        body: { email: `user-b-${suffix}@example.com`, password: "password-B-123", name: "User B" },
      }),
    );
    expect(resB.status).toBe(201);
    userBCookie = { ail_session: extractSessionToken(resB) as string };

    const bodyA = (await resA.json()) as { user: { id: string; email: string } };
    const bodyB = (await resB.json()) as { user: { id: string; email: string } };
    createdUserIds.push(bodyA.user.id, bodyB.user.id);

    // Response exposes a safe shape only — never the password hash.
    expect(bodyA.user).not.toHaveProperty("passwordHash");

    const { GET: me } = await import("@/app/api/auth/me/route");
    makeRequest("http://localhost/api/auth/me", { cookies: userACookie });
    const meA = await me();
    const meAJson = (await meA.json()) as { user?: { email: string } };
    expect(meA.status).toBe(200);
    expect(meAJson.user?.email).toBe(bodyA.user.email);

    // Duplicate email registration is rejected.
    const dup = await register(
      makeRequest("http://localhost/api/auth/register", {
        method: "POST",
        body: { email: bodyA.user.email, password: "whatever-123" },
      }),
    );
    expect(dup.status).toBe(409);

    // Login failure is generic and does not reveal which part was wrong.
    const { POST: login } = await import("@/app/api/auth/login/route");
    const badPassword = await login(
      makeRequest("http://localhost/api/auth/login", {
        method: "POST",
        body: { email: bodyA.user.email, password: "wrong-password" },
      }),
    );
    expect(badPassword.status).toBe(401);
    const badPasswordBody = (await badPassword.json()) as { error: string };
    expect(badPasswordBody.error).toBe("Invalid email or password");
  });

  it("protected APIs reject unauthenticated access", async () => {
    const { GET: listOpportunities } = await import("@/app/api/opportunities/route");
    makeRequest("http://localhost/api/opportunities");
    const noAuth = await listOpportunities();
    expect(noAuth.status).toBe(401);

    const { POST: createOpportunity } = await import("@/app/api/opportunities/route");
    const createNoAuth = await createOpportunity(
      makeRequest("http://localhost/api/opportunities", {
        method: "POST",
        body: { title: "No auth", category: "SAAS", businessModel: "SAAS" },
      }),
    );
    expect(createNoAuth.status).toBe(401);

    const { GET: getHandoff } = await import("@/app/api/handoffs/[id]/route");
    const handoffNoAuth = await getHandoff(makeRequest("http://localhost/api/handoffs/x"), makeParams("x"));
    expect(handoffNoAuth.status).toBe(401);

    const { GET: getExperiment } = await import("@/app/api/experiments/[id]/route");
    const experimentNoAuth = await getExperiment(makeRequest("http://localhost/api/experiments/x"), makeParams("x"));
    expect(experimentNoAuth.status).toBe(401);

    const { GET: researchNoAuth } = await import("@/app/api/research/route");
    const research401 = await researchNoAuth(
      makeRequest("http://localhost/api/research?opportunityId=some-id"),
    );
    expect(research401.status).toBe(401);

    const { GET: agentRunsNoAuth } = await import("@/app/api/agents/[id]/runs/route");
    const agent401 = await agentRunsNoAuth(
      makeRequest("http://localhost/api/agents/agent-1/runs"),
      makeParams("agent-1"),
    );
    expect(agent401.status).toBe(401);

    const { GET: meNoAuth } = await import("@/app/api/auth/me/route");
    makeRequest("http://localhost/api/auth/me");
    expect((await meNoAuth()).status).toBe(401);
  });

  it("User A cannot access, modify, or delete User B's opportunity; ownership comes from the session", async () => {
    // User B creates an opportunity through the API — ownership must be
    // assigned server-side even if a malicious client sends ownerId/userId.
    const { POST: createOpportunity, GET: listOpportunities } = await import(
      "@/app/api/opportunities/route"
    );
    const createRes = await createOpportunity(
      makeRequest("http://localhost/api/opportunities", {
        method: "POST",
        cookies: userBCookie,
        body: {
          title: "User B private opportunity",
          category: "SAAS",
          businessModel: "SAAS",
          demandScore: 50,
          competitionScore: 50,
          commercialIntentScore: 50,
          automationScore: 50,
          differentiationScore: 50,
          monetizationStrengthScore: 50,
          halalScore: 50,
          halalStatus: "HALAL",
          confidence: 40,
          status: "IDEA",
          estimatedStartupCost: 100,
          // Attack payloads — must be ignored:
          ownerId: "attacker-owned-id",
          userId: "attacker-user-id",
        },
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; ownerId?: string };
    createdOpportunityIds.push(created.id);
    expect(created.ownerId).toBeUndefined(); // never echoed back in the mapped shape

    const dbRow = await prisma.opportunity.findUniqueOrThrow({
      where: { id: created.id },
      select: { ownerId: true },
    });
    const userBId = (await prisma.user.findFirst({ where: { name: "User B" }, select: { id: true } }))?.id;
    expect(dbRow.ownerId).toBe(userBId); // owner is User B, from the session

    // Only User B sees it in their list; User A's list is empty for it.
    makeRequest("http://localhost/api/opportunities", { cookies: userBCookie });
    const listB = await listOpportunities();
    const listBJson = (await listB.json()) as { id: string }[];
    expect(listBJson.some((row) => row.id === created.id)).toBe(true);
    makeRequest("http://localhost/api/opportunities", { cookies: userACookie });
    const listA = await listOpportunities();
    const listAJson = (await listA.json()) as { id: string }[];
    expect(listAJson.some((row) => row.id === created.id)).toBe(false);

    const { GET: getOpportunity, PATCH: patchOpportunity, DELETE: deleteOpportunity } = await import(
      "@/app/api/opportunities/[id]/route"
    );

    // GET → denied, masked as 404 (indistinguishable from nonexistent).
    const getA = await getOpportunity(
      makeRequest(`http://localhost/api/opportunities/${created.id}`, { cookies: userACookie }),
      makeParams(created.id),
    );
    expect(getA.status).toBe(404);

    // PATCH → denied.
    const patchA = await patchOpportunity(
      makeRequest(`http://localhost/api/opportunities/${created.id}`, {
        method: "PATCH",
        cookies: userACookie,
        body: { title: "User A was here" },
      }),
      makeParams(created.id),
    );
    expect(patchA.status).toBe(404);
    const stillIntact = await prisma.opportunity.findUniqueOrThrow({ where: { id: created.id } });
    expect(stillIntact.title).toBe("User B private opportunity"); // nothing mutated

    // DELETE → denied.
    const deleteA = await deleteOpportunity(
      makeRequest(`http://localhost/api/opportunities/${created.id}`, { method: "DELETE", cookies: userACookie }),
      makeParams(created.id),
    );
    expect(deleteA.status).toBe(404);
    expect(await prisma.opportunity.findUnique({ where: { id: created.id } })).not.toBeNull();

    // User B can still access and mutate their own record.
    const patchB = await patchOpportunity(
      makeRequest(`http://localhost/api/opportunities/${created.id}`, {
        method: "PATCH",
        cookies: userBCookie,
        body: { title: "User B renamed it" },
      }),
      makeParams(created.id),
    );
    expect(patchB.status).toBe(200);
  });

  it("User A cannot access User B's research, handoff, experiment, or evaluate it; full lifecycle still works for User B", async () => {
    // Setup: User B creates an opportunity and a research run via the repository.
    const { researchRepository } = await import("./repositories/research");
    const userBId = (await prisma.user.findFirst({ where: { name: "User B" }, select: { id: true } }))!.id;
    const oppId = `test-opp-${uniqueSuffix()}`;
    createdOpportunityIds.push(oppId);
    await prisma.opportunity.create({
      data: {
        id: oppId,
        title: `B research/handoff/experiment ${uniqueSuffix()}`,
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
        overallScore: 62.5,
        confidence: 40,
        status: "VALIDATED",
        risks: ["Platform dependency"],
        isSample: false,
        ownerId: userBId,
      },
    });
    const runId = `research-${uniqueSuffix()}`;
    await researchRepository.save({
      id: runId,
      opportunityId: oppId,
      status: "COMPLETED",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      queries: [{ query: `${oppId} demand`, source: "brave", purpose: "demand" }],
      evidence: [
        {
          id: `${runId}-ev-1`,
          source: "brave",
          title: "Demand evidence",
          url: "https://example.com/x",
          snippet: "Snippet",
          collectedAt: new Date().toISOString(),
          relevanceScore: 0.8,
          qualityScore: 0.7,
          hash: `${runId}-hash`,
          supports: ["demand"],
          contradicts: [],
          dataClass: "REAL_LIVE_DATA",
        },
      ],
      findings: [],
      validationSignals: [
        { key: "demand", label: "Demand", status: "MIXED", evidenceIds: [`${runId}-ev-1`], basis: "1 item" },
        { key: "pain-point", label: "Pain Point", status: "INSUFFICIENT", evidenceIds: [], basis: "0 items" },
        { key: "commercial-intent", label: "Commercial Intent", status: "INSUFFICIENT", evidenceIds: [], basis: "0 items" },
        { key: "trend", label: "Trend", status: "INSUFFICIENT", evidenceIds: [], basis: "0 items" },
        { key: "competition", label: "Competition", status: "INSUFFICIENT", evidenceIds: [], basis: "0 items" },
      ],
      confidence: 0.75,
      conclusion: "VALIDATED",
      conclusionBasis: "Test basis",
      providersAttempted: ["brave"],
      providersSucceeded: ["brave"],
      providerStatuses: [{ name: "brave", status: "SUCCEEDED", evidenceCount: 1, error: null }],
      errors: [],
      scoreIntegration: { suggestedOverallScore: null, factors: [] },
    });

    const { GET: researchGet } = await import("@/app/api/research/route");
    const researchA = await researchGet(
      makeRequest(`http://localhost/api/research?opportunityId=${oppId}`, { cookies: userACookie }),
    );
    expect(researchA.status).toBe(404);
    const latestA = await researchGet(
      makeRequest(`http://localhost/api/research?opportunityId=${oppId}&latest=1`, { cookies: userACookie }),
    );
    expect(latestA.status).toBe(404);
    const byIdA = await researchGet(
      makeRequest(`http://localhost/api/research?id=${runId}`, { cookies: userACookie }),
    );
    expect(byIdA.status).toBe(404);
    const researchB = await researchGet(
      makeRequest(`http://localhost/api/research?opportunityId=${oppId}`, { cookies: userBCookie }),
    );
    expect(researchB.status).toBe(200);

    // Handoff: User A cannot create one for B's opportunity; B can.
    const { POST: createHandoffRoute } = await import("@/app/api/handoffs/route");
    const handoffA = await createHandoffRoute(
      makeRequest("http://localhost/api/handoffs", {
        method: "POST",
        cookies: userACookie,
        body: { opportunityId: oppId },
      }),
    );
    expect(handoffA.status).toBe(404);
    const handoffB = await createHandoffRoute(
      makeRequest("http://localhost/api/handoffs", {
        method: "POST",
        cookies: userBCookie,
        body: { opportunityId: oppId },
      }),
    );
    if (handoffB.status !== 201) {
      const reasons = (await handoffB.json()) as { reasons?: string[] };
      throw new Error(`handoffB failed: ${JSON.stringify(reasons)}`);
    }
    const handoff = (await (handoffB.clone() as unknown as Response).json()) as { id: string };

    const { GET: getHandoff, POST: handoffAction } = await import("@/app/api/handoffs/[id]/route");
    const getHandoffA = await getHandoff(
      makeRequest(`http://localhost/api/handoffs/${handoff.id}`, { cookies: userACookie }),
      makeParams(handoff.id),
    );
    expect(getHandoffA.status).toBe(404);

    const acceptA = await handoffAction(
      makeRequest(`http://localhost/api/handoffs/${handoff.id}`, {
        method: "POST",
        cookies: userACookie,
        body: { action: "accept" },
      }),
      makeParams(handoff.id),
    );
    expect(acceptA.status).toBe(404);
    const stillDraft = await prisma.handoff.findUniqueOrThrow({ where: { id: handoff.id } });
    expect(stillDraft.status).toBe("HANDOFF_READY"); // B's handoff untouched

    // B accepts, then creates the experiment.
    const acceptB = await handoffAction(
      makeRequest(`http://localhost/api/handoffs/${handoff.id}`, {
        method: "POST",
        cookies: userBCookie,
        body: { action: "accept" },
      }),
      makeParams(handoff.id),
    );
    expect(acceptB.status).toBe(200);
    const experimentB = await handoffAction(
      makeRequest(`http://localhost/api/handoffs/${handoff.id}`, {
        method: "POST",
        cookies: userBCookie,
        body: { action: "createExperiment", budget: 100 },
      }),
      makeParams(handoff.id),
    );
    expect(experimentB.status).toBe(201);
    const experiment = (await experimentB.json()) as { id: string };

    // User A cannot read, modify, delete, or evaluate User B's experiment.
    const { GET: getExperiment, PATCH: patchExperiment, DELETE: deleteExperiment } = await import(
      "@/app/api/experiments/[id]/route"
    );
    const getExperimentA = await getExperiment(
      makeRequest(`http://localhost/api/experiments/${experiment.id}`, { cookies: userACookie }),
      makeParams(experiment.id),
    );
    expect(getExperimentA.status).toBe(404);

    const patchExperimentA = await patchExperiment(
      makeRequest(`http://localhost/api/experiments/${experiment.id}`, {
        method: "PATCH",
        cookies: userACookie,
        body: { notes: "User A was here" },
      }),
      makeParams(experiment.id),
    );
    expect(patchExperimentA.status).toBe(404);

    const deleteExperimentA = await deleteExperiment(
      makeRequest(`http://localhost/api/experiments/${experiment.id}`, {
        method: "DELETE",
        cookies: userACookie,
      }),
      makeParams(experiment.id),
    );
    expect(deleteExperimentA.status).toBe(404);
    expect(await prisma.experiment.findUnique({ where: { id: experiment.id } })).not.toBeNull();

    const { GET: evaluatePreview, POST: evaluatePost } = await import(
      "@/app/api/experiments/[id]/evaluate/route"
    );
    const evaluateA = await evaluatePost(
      makeRequest(`http://localhost/api/experiments/${experiment.id}/evaluate`, {
        method: "POST",
        cookies: userACookie,
        body: {},
      }),
      makeParams(experiment.id),
    );
    expect(evaluateA.status).toBe(404);
    const evaluatePreviewA = await evaluatePreview(
      makeRequest(`http://localhost/api/experiments/${experiment.id}/evaluate`, { cookies: userACookie }),
      makeParams(experiment.id),
    );
    expect(evaluatePreviewA.status).toBe(404);

    // User B's own experiment flow works end to end (Phase 5 preserved).
    const evaluateB = await evaluatePost(
      makeRequest(`http://localhost/api/experiments/${experiment.id}/evaluate`, {
        method: "POST",
        cookies: userBCookie,
        body: {},
      }),
      makeParams(experiment.id),
    );
    // No metrics recorded → the honest INSUFFICIENT_DATA decision still
    // completes the lifecycle (Phase 5 semantics), with feedback persisted.
    expect(evaluateB.status).toBe(200);
    const evaluateBJson = (await evaluateB.json()) as {
      feedback: { decision: string; dataClass: string };
      experiment: { status: string; decision: string };
    };
    expect(evaluateBJson.feedback.decision).toBe("INSUFFICIENT_DATA");
    expect(evaluateBJson.experiment.status).toBe("COMPLETED");
    expect(evaluateBJson.experiment.decision).toBe("INSUFFICIENT_DATA");

    // User A cannot see User B's agent runs; runs are owned by their creator.
    const { agentRunRepository } = await import("./repositories/agent-runs");
    const userAId = (await prisma.user.findFirst({ where: { name: "User A" }, select: { id: true } }))!.id;
    const agent = await prisma.agent.findFirst();
    if (agent) {
      await agentRunRepository.create({ agentId: agent.id, task: "B's private run", ownerId: userBId });
      const { GET: agentRunsGet } = await import("@/app/api/agents/[id]/runs/route");
      const runsA = await agentRunsGet(
        makeRequest(`http://localhost/api/agents/${agent.id}/runs`, { cookies: userACookie }),
        makeParams(agent.id),
      );
      const runsAJson = (await runsA.json()) as { runs: { task: string }[] };
      expect(runsAJson.runs.every((run) => run.task !== "B's private run")).toBe(true);
      const runsB = await agentRunsGet(
        makeRequest(`http://localhost/api/agents/${agent.id}/runs`, { cookies: userBCookie }),
        makeParams(agent.id),
      );
      const runsBJson = (await runsB.json()) as { runs: { task: string }[] };
      expect(runsBJson.runs.some((run) => run.task === "B's private run")).toBe(true);
      void userAId;
    }

    // Logout invalidates the server-side session.
    const { POST: logout } = await import("@/app/api/auth/logout/route");
    makeRequest("http://localhost/api/auth/logout", { method: "POST", cookies: userBCookie });
    const logoutRes = await logout();
    expect(logoutRes.status).toBe(200);
    const meAfterLogout = await import("@/app/api/auth/me/route");
    makeRequest("http://localhost/api/auth/me", { cookies: userBCookie });
    const meRes = await meAfterLogout.GET();
    expect(meRes.status).toBe(401);
  });

  it("admin rules: a normal USER cannot use admin-only endpoints; unowned legacy rows are not exposed to users", async () => {
    const { POST: createAgent } = await import("@/app/api/agents/route");
    const userTriesAdmin = await createAgent(
      makeRequest("http://localhost/api/agents", {
        method: "POST",
        cookies: userACookie,
        body: { name: "Sneaky Agent", type: "RESEARCH" },
      }),
    );
    expect(userTriesAdmin.status).toBe(403);

    // Unowned (legacy) rows exist in the DB but are invisible to User A...
    const legacyOppId = `legacy-opp-${uniqueSuffix()}`;
    createdOpportunityIds.push(legacyOppId);
    await prisma.opportunity.create({
      data: {
        id: legacyOppId,
        title: "Legacy unowned opportunity",
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
        overallScore: 62.5,
        confidence: 40,
        status: "IDEA",
        risks: [],
        isSample: false,
      },
    });
    const { GET: getOpportunity } = await import("@/app/api/opportunities/[id]/route");
    const userSeesLegacy = await getOpportunity(
      makeRequest(`http://localhost/api/opportunities/${legacyOppId}`, { cookies: userACookie }),
      makeParams(legacyOppId),
    );
    expect(userSeesLegacy.status).toBe(404);
  });
});
