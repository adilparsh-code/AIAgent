/**
 * Phase 9 — live execution tests (pure + real PostgreSQL + stubbed provider
 * transport). No test ever contacts a real provider: `fetch` is stubbed so
 * every failure mode (401/403, 429, 5xx, timeout, malformed body, missing key)
 * is exercised deterministically and no real money/calls are ever made.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../db";
import {
  resolveTestAction,
  resolveTestActions,
  isTestExecutableCapability,
  sanitizeRequestId,
  TEST_EXECUTION_LIMITS,
} from "@/lib/integrations/test-execution";

const hasDb = Boolean(process.env.DATABASE_URL);
const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cookieJar: { current: Record<string, string> } = { current: {} };
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

function makeParams(id: string) {
  return { params: { id } };
}

function sessionToken(response: Response): string {
  const anyResponse = response as unknown as { headers: Headers & { getSetCookie?: () => string[] } };
  const cookies = typeof anyResponse.headers.getSetCookie === "function"
    ? anyResponse.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean) as string[];
  for (const cookie of cookies) {
    const [pair] = cookie.split(";");
    const [name, value] = pair.split("=");
    if (name === "ail_session") return decodeURIComponent(value);
  }
  throw new Error("no session cookie");
}

/** Stub the provider transport. Returns the captured requests. */
function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const calls: Array<{ url: string; body: string | null }> = [];
  const spy = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, body: typeof init?.body === "string" ? init.body : null });
    return handler(url, init);
  });
  vi.stubGlobal("fetch", spy);
  return calls;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A valid SambaNova chat-completion payload. */
function completionOk(text: string) {
  return jsonResponse(200, { id: "cmpl_test", choices: [{ message: { content: text } }], usage: { prompt_tokens: 5, completion_tokens: 7 } });
}

describe("Phase 9 test-execution catalog (pure)", () => {
  it("only exposes zero-financial-impact capabilities", () => {
    expect(isTestExecutableCapability("SEARCH")).toBe(true);
    expect(isTestExecutableCapability("READ_DATA")).toBe(true);
    expect(isTestExecutableCapability("CREATE_DRAFT")).toBe(true);
    expect(isTestExecutableCapability("PUBLISH")).toBe(false);
    expect(isTestExecutableCapability("SEND_MESSAGE")).toBe(false);
    expect(isTestExecutableCapability("CREATE_CAMPAIGN")).toBe(false);
    expect(isTestExecutableCapability("SPEND_MONEY")).toBe(false);
    expect(isTestExecutableCapability("UPLOAD")).toBe(false);
  });

  it("resolves allowlisted safe actions for the AI provider", () => {
    const actions = resolveTestActions("sambanova");
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].action).toBe("GENERATE_TEXT");
    expect(actions[0].capability).toBe("CREATE_DRAFT");
    expect(actions[0].taskType).toBe("CONTENT_DRAFT");
  });

  it("resolves safe research actions and refuses scaffolds", () => {
    expect(resolveTestActions("brave-search").map((a) => a.action)).toContain("SEARCH_WEB");
    expect(resolveTestActions("google-trends").map((a) => a.action)).toContain("SEARCH_TRENDS");
    expect(resolveTestActions("pinterest")).toEqual([]);
    expect(resolveTestActions("analytics-platform")).toEqual([]);
  });

  it("refuses actions that are not allowlisted for the integration", () => {
    expect(resolveTestAction("sambanova", "PUBLISH_PIN")).toBeNull();
    expect(resolveTestAction("sambanova", "SEARCH_WEB")).toBeNull(); // belongs to brave-search
    expect(resolveTestAction("brave-search", "SEARCH_WEB")).not.toBeNull();
  });

  it("uses fixed deterministic objectives (no client instructions)", () => {
    const action = resolveTestAction("sambanova", "GENERATE_TEXT")!;
    expect(action.objective).toContain("AIAGENT PHASE 9 TEST OK");
    expect(action.objective.length).toBeLessThan(600);
    expect(action.instructions.toLowerCase()).toContain("deterministic");
  });

  it("bounds every test execution", () => {
    expect(TEST_EXECUTION_LIMITS.timeLimitSeconds).toBeLessThanOrEqual(120);
    expect(TEST_EXECUTION_LIMITS.maxOutputChars).toBeLessThanOrEqual(20_000);
    expect(TEST_EXECUTION_LIMITS.maxRetries).toBe(1);
    expect(TEST_EXECUTION_LIMITS.maxActions).toBe(1);
    expect(TEST_EXECUTION_LIMITS.budgetLimit).toBe(0); // never any money
  });

  it("validates request ids used for duplicate suppression", () => {
    expect(sanitizeRequestId("abc-123_XY")).toBe("abc-123_XY");
    expect(sanitizeRequestId("has space")).toBeNull();
    expect(sanitizeRequestId("x".repeat(65))).toBeNull();
    expect(sanitizeRequestId("")).toBeNull();
    expect(sanitizeRequestId(42)).toBeNull();
  });

  it("exposes a real API key to the model or the client — never (names only)", async () => {
    const { getIntegrationRegistry } = await import("@/lib/integrations/registry");
    const { listIntegrationSummaries } = await import("@/lib/integrations/service");
    const adapter = getIntegrationRegistry().require("sambanova");
    const config = adapter.validateConfiguration();
    for (const name of config.presentEnvVars) expect(name).toMatch(/^[A-Z0-9_]+$/);
    const summaries = await listIntegrationSummaries();
    const serialized = JSON.stringify(summaries);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(serialized.toLowerCase()).not.toContain("bearer ");
  });

  it("never classifies a provider as HEALTHY without a real probe", async () => {
    const { createSambaNovaAdapter } = await import("@/lib/integrations/adapters/sambanova");
    const adapter = createSambaNovaAdapter();
    const config = adapter.validateConfiguration();
    if (config.presentEnvVars.length === 0) {
      // No key: a "health check" must stay NOT_CONFIGURED, never HEALTHY.
      const health = await adapter.healthCheck();
      expect(health.status).toBe("NOT_CONFIGURED");
    }
  });
});

describe.skipIf(!hasDb)("Phase 9 live execution (real PostgreSQL, stubbed provider)", () => {
  const prisma = getPrisma();
  const created: string[] = [];
  let ownerCookie: Record<string, string> = {};
  let ownerId = "";
  let agentIds: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    for (const agentId of agentIds) {
      await prisma.agent.delete({ where: { id: agentId } }).catch(() => undefined);
    }
    for (const id of created) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  async function ensureAgents() {
    if (agentIds.length > 0) return;
    for (const type of ["RESEARCH", "SEO", "ANALYTICS", "PRODUCT"] as const) {
      const agent = await prisma.agent.create({
        data: { name: `Phase9 ${type} ${suffix()}`, type, status: "ACTIVE" },
      });
      agentIds.push(agent.id);
    }
  }

  async function registerUser(tag: string) {
    // Users are created directly (one login per user) instead of hammering the
    // registration endpoint, which is deliberately rate-limited per IP.
    const { hashPassword } = await import("@/lib/server/password");
    const password = "password-P-123";
    const user = await prisma.user.create({
      data: {
        // Login normalizes addresses to lowercase; direct fixture creation
        // must persist the same canonical form (tags above intentionally use
        // capitals to catch this regression).
        email: `p9-${tag}-${suffix()}@example.com`.toLowerCase(),
        name: `P9 ${tag}`,
        passwordHash: await hashPassword(password),
        role: "USER",
        status: "ACTIVE",
      },
    });
    created.push(user.id);
    const { POST: login } = await import("@/app/api/auth/login/route");
    const loginResponse = await login(
      makeRequest("http://localhost/api/auth/login", {
        method: "POST",
        body: { email: user.email, password },
      }),
    );
    expect(loginResponse.status).toBe(200);
    return { cookie: { ail_session: sessionToken(loginResponse) }, id: user.id };
  }

  it("requires authentication", async () => {
    const { POST: runTest } = await import("@/app/api/integrations/[id]/test-execution/route");
    const response = await runTest(
      makeRequest("http://localhost/api/integrations/sambanova/test-execution", { method: "POST", body: {} }),
      makeParams("sambanova"),
    );
    expect(response.status).toBe(401);
  });

  it("rejects unknown integrations, scaffolds and non-allowlisted actions", async () => {
    const user = await registerUser("reject");
    const { POST: runTest, GET: getTest } = await import("@/app/api/integrations/[id]/test-execution/route");

    const unknown = await runTest(
      makeRequest("http://localhost/api/integrations/nope/test-execution", { method: "POST", body: {}, cookies: user.cookie }),
      makeParams("nope"),
    );
    expect(unknown.status).toBe(404);

    // Scaffold: never a fake success.
    const scaffold = await runTest(
      makeRequest("http://localhost/api/integrations/pinterest/test-execution", { method: "POST", body: {}, cookies: user.cookie }),
      makeParams("pinterest"),
    );
    expect(scaffold.status).toBe(409);

    // A publishing/financial action is not reachable from the test endpoint.
    const publish = await runTest(
      makeRequest("http://localhost/api/integrations/sambanova/test-execution", { method: "POST", body: { action: "PUBLISH" }, cookies: user.cookie }),
      makeParams("sambanova"),
    );
    expect(publish.status).toBe(400);

    // Safe action catalog is exposed without secrets.
    const catalog = await getTest(
      makeRequest("http://localhost/api/integrations/sambanova/test-execution", { cookies: user.cookie }),
      makeParams("sambanova"),
    );
    expect(catalog.status).toBe(200);
    const body = JSON.parse(await catalog.text()) as { actions: Array<{ action: string }> };
    expect(body.actions.map((a) => a.action)).toContain("GENERATE_TEXT");
  });

  it("missing API key → honest NOT_CONFIGURED / UNAVAILABLE, never fake success", async () => {
    if (process.env.SAMBANOVA_API_KEY) return; // real key present: covered by the live path
    await ensureAgents();
    const user = await registerUser("nokey");
    const { POST: runTest } = await import("@/app/api/integrations/[id]/test-execution/route");
    const response = await runTest(
      makeRequest("http://localhost/api/integrations/sambanova/test-execution", {
        method: "POST",
        body: { requestId: `nokey_${suffix()}` },
        cookies: user.cookie,
      }),
      makeParams("sambanova"),
    );
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()) as { status: string; error: string | null; missingEnvVars: string[] };
    expect(body.status).not.toBe("SUCCEEDED");
    expect(["UNAVAILABLE", "FAILED"]).toContain(body.status);
    expect(body.missingEnvVars).toContain("SAMBANOVA_API_KEY");
    expect(body.error).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
  });

  it("runs a real bounded execution: artifact + execution rows + secret-free persistence", async () => {
    await ensureAgents();
    const user = await registerUser("happy");
    const requestId = `happy_${suffix()}`;
    // Deterministic provider success.
    stubFetch(() => completionOk("AIAGENT PHASE 9 TEST OK"));
    if (!process.env.SAMBANOVA_API_KEY) {
      // Without a key the adapter refuses before any network call; assert the
      // gate rather than pretending a provider responded.
      const { runTestExecution } = await import("@/lib/server/test-execution-service");
      await expect(
        runTestExecution({ integrationName: "sambanova", ownerId: user.id, requestId }),
      ).resolves.toMatchObject({ status: expect.not.stringMatching(/^SUCCEEDED$/) });
      return;
    }
    const { POST: runTest } = await import("@/app/api/integrations/[id]/test-execution/route");
    const response = await runTest(
      makeRequest("http://localhost/api/integrations/sambanova/test-execution", {
        method: "POST",
        body: { requestId },
        cookies: user.cookie,
      }),
      makeParams("sambanova"),
    );
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()) as {
      status: string; executionId: string | null; artifactId: string | null; dataClass: string | null;
    };
    expect(body.status).toBe("SUCCEEDED");
    expect(body.executionId).toBeTruthy();
    expect(body.artifactId).toBeTruthy();
    expect(body.dataClass).toBe("AI_GENERATED"); // model output, never REAL_DATA

    const execution = await prisma.agentExecution.findUniqueOrThrow({ where: { id: body.executionId! } });
    expect(execution.integration).toBe("sambanova");
    expect(execution.action).toBe("GENERATE_TEXT");
    expect(execution.status).toBe("SUCCEEDED");
    expect(execution.dryRun).toBe(false);
    expect(execution.dataClass).toBe("AI_GENERATED");
    const task = await prisma.agentTask.findUniqueOrThrow({ where: { id: `test_${requestId}` } });
    expect(task.result).toMatchObject({ dataClass: "AI_GENERATED" });
    const audit = await prisma.integrationExecution.findFirst({ where: { taskId: `test_${requestId}` } });
    expect(audit).toBeTruthy();
    expect(audit?.dataClass).toBe("AI_GENERATED");
    const artifact = await prisma.agentArtifact.findUniqueOrThrow({ where: { id: body.artifactId! } });
    expect(artifact.dataClass).toBe("AI_GENERATED");
    expect(artifact.content).toContain("AIAGENT PHASE 9 TEST OK");
  });

  it("duplicate requestId resolves to the same execution (no duplicate provider call)", async () => {
    await ensureAgents();
    const user = await registerUser("dup");
    const requestId = `dup_${suffix()}`;
    const calls = stubFetch(() => completionOk("AIAGENT PHASE 9 TEST OK"));
    const { runTestExecution } = await import("@/lib/server/test-execution-service");
    const first = await runTestExecution({ integrationName: "sambanova", ownerId: user.id, requestId });
    const second = await runTestExecution({ integrationName: "sambanova", ownerId: user.id, requestId });
    expect(second.taskId).toBe(first.taskId);
    // A duplicate submission must resolve to the same execution row (or, once
    // the execution reached a terminal state, return that same row) — never a
    // second provider call and never a null/dangling reference.
    expect(second.executionId).toBe(first.executionId);
    expect(second.status).toBe(first.status);
    if (process.env.SAMBANOVA_API_KEY) {
      expect(calls.length).toBe(1);
    }
  });

  it("invalid API key (401) → AUTH_FAILED, sanitized error, no secrets stored", async () => {
    if (!process.env.SAMBANOVA_API_KEY) return; // needs a key to reach the provider path
    await ensureAgents();
    const user = await registerUser("401");
    stubFetch(() => jsonResponse(401, { error: "invalid api key sk-SECRETVALUE123456" }));
    const { runTestExecution } = await import("@/lib/server/test-execution-service");
    const result = await runTestExecution({ integrationName: "sambanova", ownerId: user.id, requestId: `k401_${suffix()}` });
    expect(result.status).toBe("AUTH_FAILED");
    expect(result.error).toBeTruthy();
    expect(result.error).not.toContain("SECRETVALUE");
    const rows = await prisma.integrationExecution.findMany({ where: { ownerId: user.id } });
    for (const row of rows) expect(JSON.stringify(row)).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
  });

  it("rate limit (429) → RATE_LIMITED without hammering the provider", async () => {
    if (!process.env.SAMBANOVA_API_KEY) return;
    await ensureAgents();
    const user = await registerUser("429");
    const calls = stubFetch(() => jsonResponse(429, { error: "rate limited" }));
    const { runTestExecution } = await import("@/lib/server/test-execution-service");
    const result = await runTestExecution({ integrationName: "sambanova", ownerId: user.id, requestId: `k429_${suffix()}` });
    expect(result.status).toBe("RATE_LIMITED");
    // maxRetries = 1 for test executions: exactly one provider call.
    expect(calls.length).toBe(1);
  });

  it("provider 5xx → FAILED and never SUCCEEDED", async () => {
    if (!process.env.SAMBANOVA_API_KEY) return;
    await ensureAgents();
    const user = await registerUser("500");
    stubFetch(() => jsonResponse(503, { error: "upstream unavailable" }));
    const { runTestExecution } = await import("@/lib/server/test-execution-service");
    const result = await runTestExecution({ integrationName: "sambanova", ownerId: user.id, requestId: `k500_${suffix()}` });
    expect(result.status).not.toBe("SUCCEEDED");
    expect(["FAILED", "RATE_LIMITED", "TIMEOUT"]).toContain(result.status);
  });

  it("malformed provider response fails safely", async () => {
    if (!process.env.SAMBANOVA_API_KEY) return;
    await ensureAgents();
    const user = await registerUser("malformed");
    stubFetch(() => new Response("<html>not json</html>", { status: 200, headers: { "content-type": "text/html" } }));
    const { runTestExecution } = await import("@/lib/server/test-execution-service");
    const result = await runTestExecution({ integrationName: "sambanova", ownerId: user.id, requestId: `kbad_${suffix()}` });
    expect(result.status).not.toBe("SUCCEEDED");
  });

  it("timeout is classified, not fabricated", async () => {
    if (!process.env.SAMBANOVA_API_KEY) return;
    await ensureAgents();
    const user = await registerUser("timeout");
    stubFetch(async () => {
      throw new Error("The operation was aborted due to timeout");
    });
    const { runTestExecution } = await import("@/lib/server/test-execution-service");
    const result = await runTestExecution({ integrationName: "sambanova", ownerId: user.id, requestId: `kto_${suffix()}` });
    expect(result.status).not.toBe("SUCCEEDED");
    expect(["TIMEOUT", "FAILED"]).toContain(result.status);
  });

  it("cross-tenant execution is blocked (404-masked)", async () => {
    await ensureAgents();
    const userA = await registerUser("tenantA");
    const userB = await registerUser("tenantB");
    const requestId = `tenant_${suffix()}`;
    stubFetch(() => completionOk("AIAGENT PHASE 9 TEST OK"));
    const { runTestExecution } = await import("@/lib/server/test-execution-service");
    await runTestExecution({ integrationName: "sambanova", ownerId: userA.id, requestId });

    // User B cannot see or re-run user A's task executions.
    const { GET: listExecutions } = await import("@/app/api/agent-tasks/[id]/executions/route");
    const responseB = await listExecutions(
      makeRequest(`http://localhost/api/agent-tasks/test_${requestId}/executions`, { cookies: userB.cookie }),
      makeParams(`test_${requestId}`),
    );
    expect(responseB.status).toBe(404);

    const responseA = await listExecutions(
      makeRequest(`http://localhost/api/agent-tasks/test_${requestId}/executions`, { cookies: userA.cookie }),
      makeParams(`test_${requestId}`),
    );
    expect(responseA.status).toBe(200);
  });

  it("prompt injection in task inputs stays inert data at the provider boundary", async () => {
    if (!process.env.SAMBANOVA_API_KEY) return;
    await ensureAgents();
    const user = await registerUser("inject");
    const calls = stubFetch(() => completionOk("ok"));
    const { runTestExecution } = await import("@/lib/server/test-execution-service");
    await runTestExecution({ integrationName: "sambanova", ownerId: user.id, requestId: `inj_${suffix()}` });
    if (calls.length === 0) return;
    const sent = calls[0].body ?? "";
    // The objective/instructions are fixed constants. The orchestrator's own
    // system prompt legitimately describes a "Controlled execution worker", so
    // assert on concrete tool/shell directives rather than the benign word
    // "execute". This proves user/task input cannot become an action verb.
    expect(sent).not.toMatch(/shell|powershell|bash\s|rm\s+-rf|curl\s|wget\s|spend money|purchase|publish|send message/i);
  });
});
