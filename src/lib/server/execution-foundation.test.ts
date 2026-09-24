/**
 * Phase 9A — execution foundation against real PostgreSQL and real route
 * handlers: idempotency (unique key, concurrent duplicates), the deterministic
 * state machine (illegal transitions rejected), bounded capability-aware
 * retry, DRY_RUN honesty (SAMPLE_DATA, never REAL_DATA), approval gates, and
 * owner scoping.
 */
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma, isDbUnavailableError } from "../db";

const hasDb = Boolean(process.env.DATABASE_URL);
const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cookieJar: { current: Record<string, string> } = { current: {} };
// Match the Phase 8 route-level test harness (next/headers cookie mock).
vi.hoisted(() => undefined);

import { vi } from "vitest";
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      const value = cookieJar.current[name];
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

import { IllegalExecutionTransitionError, createExecutionIdempotent, transitionExecution } from "./execution-repository";
import { buildExecutionIdempotencyKey } from "@/lib/execution-contract";

function setCookies(cookies: Record<string, string>) {
  cookieJar.current = cookies;
}

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

function extractSessionToken(response: Response): string | null {
  const anyResponse = response as unknown as { headers: Headers & { getSetCookie?: () => string[] } };
  const cookies = typeof anyResponse.headers.getSetCookie === "function"
    ? anyResponse.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean) as string[];
  for (const cookie of cookies) {
    const [pair] = cookie.split(";");
    const [cookieName, value] = pair.split("=");
    if (cookieName === "ail_session") return decodeURIComponent(value);
  }
  return null;
}

async function createOwnedTaskFixtures(prisma: ReturnType<typeof getPrisma>, ownerId: string) {
  const agent = await prisma.agent.create({
    data: { name: `Exec Agent ${uniqueSuffix()}`, type: "RESEARCH", status: "ACTIVE" },
  });
  const opportunity = await prisma.opportunity.create({
    data: {
      title: `Exec opp ${uniqueSuffix()}`,
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
      risks: ["Dependency"],
      isSample: false,
      ownerId,
    },
  });
  const experiment = await prisma.experiment.create({
    data: {
      hypothesis: "Exec experiment",
      opportunityId: opportunity.id,
      target: "Track",
      budget: 0,
      startDate: new Date(),
      status: "RUNNING",
      isSample: false,
      revenue: 0,
      profit: 0,
      conversionRate: 0,
    },
  });
  const task = await prisma.agentTask.create({
    data: {
      agentId: agent.id,
      ownerId,
      opportunityId: opportunity.id,
      experimentId: experiment.id,
      taskType: "RESEARCH",
      objective: "Find evidence",
      instructions: "Use the configured providers",
      status: "READY",
    },
  });
  return { agent, opportunity, experiment, task };
}

describe.skipIf(!hasDb)("Phase 9A execution foundation (real PostgreSQL)", () => {
  const prisma = getPrisma();
  const cleanup: Array<() => Promise<void>> = [];
  let ownerCookie: Record<string, string> = {};
  let ownerId = "";
  let taskId = "";

  afterAll(async () => {
    for (const fn of cleanup.reverse()) {
      await fn().catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("setup: register a user and create an owned task", async () => {
    const suffix = uniqueSuffix();
    const { POST: register } = await import("@/app/api/auth/register/route");
    const response = await register(
      makeRequest("http://localhost/api/auth/register", {
        method: "POST",
        body: { email: `exec-user-${suffix}@example.com`, password: "password-X-123", name: "Exec Session" },
      }),
    );
    expect(response.status).toBe(201);
    ownerCookie = { ail_session: extractSessionToken(response) as string };
    ownerId = ((await response.json()) as { user: { id: string } }).user.id;
    const fixtures = await createOwnedTaskFixtures(prisma, ownerId);
    taskId = fixtures.task.id;
    cleanup.push(async () => {
      await prisma.user.delete({ where: { id: ownerId } });
      await prisma.agent.delete({ where: { id: fixtures.agent.id } });
    });
  });

  it("requires authentication for executions", async () => {
    const { POST: runExecution } = await import("@/app/api/agent-tasks/[id]/executions/route");
    const response = await runExecution(makeRequest("http://localhost/api/agent-tasks/x/executions", { method: "POST", body: {} }), makeParams("x"));
    expect(response.status).toBe(401);
  });

  it("rejects invalid modes and ids", async () => {
    const { POST: runExecution } = await import("@/app/api/agent-tasks/[id]/executions/route");
    const badMode = await runExecution(
      makeRequest(`http://localhost/api/agent-tasks/${taskId}/executions`, { method: "POST", body: { mode: "CHAOS" }, cookies: ownerCookie }),
      makeParams(taskId),
    );
    expect(badMode.status).toBe(400);
    const badId = await runExecution(
      makeRequest("http://localhost/api/agent-tasks/x/executions", { method: "POST", body: {}, cookies: ownerCookie }),
      makeParams("x".repeat(65)),
    );
    expect(badId.status).toBe(400);
  });

  it("runs a DRY_RUN execution that validates gates but never touches a provider", async () => {
    const { POST: runExecution } = await import("@/app/api/agent-tasks/[id]/executions/route");
    const response = await runExecution(
      makeRequest(`http://localhost/api/agent-tasks/${taskId}/executions`, { method: "POST", body: { mode: "DRY_RUN" }, cookies: ownerCookie }),
      makeParams(taskId),
    );
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()) as {
      executionId: string; status: string; mode: string; created: boolean;
      result: { mode: string; output: { simulation: boolean } | null } | null;
    };
    expect(body.status).toBe("SUCCEEDED");
    expect(body.mode).toBe("DRY_RUN");
    expect(body.created).toBe(true);
    expect(body.result?.mode).toBe("DRY_RUN");
    expect(body.result?.output?.simulation).toBe(true);

    const row = await prisma.agentExecution.findUniqueOrThrow({ where: { id: body.executionId } });
    expect(row.mode).toBe("DRY_RUN");
    expect(row.dryRun).toBe(true);
    expect(row.dataClass).toBe("SAMPLE_DATA"); // never REAL_DATA for a simulation
    expect(row.status).toBe("SUCCEEDED");
    expect(row.integration).toBe("brave-search"); // RESEARCH allowlist resolves brave-search
    expect(row.action).toBe("SEARCH_WEB");
  });

  it("resolves duplicate requests to the existing execution (idempotency)", async () => {
    const { POST: runExecution } = await import("@/app/api/agent-tasks/[id]/executions/route");
    const [first, second] = await Promise.all([
      runExecution(
        makeRequest(`http://localhost/api/agent-tasks/${taskId}/executions`, { method: "POST", body: { mode: "DRY_RUN" }, cookies: ownerCookie }),
        makeParams(taskId),
      ),
      runExecution(
        makeRequest(`http://localhost/api/agent-tasks/${taskId}/executions`, { method: "POST", body: { mode: "DRY_RUN" }, cookies: ownerCookie }),
        makeParams(taskId),
      ),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = JSON.parse(await first.text()) as { executionId: string };
    const secondBody = JSON.parse(await second.text()) as { executionId: string; created: boolean };
    expect(secondBody.executionId).toBe(firstBody.executionId);
    // At most one DRY_RUN row exists for this task.
    const rows = await prisma.agentExecution.findMany({ where: { taskId, mode: "DRY_RUN" } });
    expect(rows).toHaveLength(1);
    expect(secondBody.created).toBe(false);
  });

  it("LIVE execution with an unconfigured integration is honestly UNAVAILABLE (never fake success)", async () => {
    if (process.env.BRAVE_SEARCH_API_KEY) {
      return; // environment has a real key: the honest result differs, skip assertion
    }
    const { POST: runExecution } = await import("@/app/api/agent-tasks/[id]/executions/route");
    const response = await runExecution(
      makeRequest(`http://localhost/api/agent-tasks/${taskId}/executions`, { method: "POST", body: { mode: "LIVE" }, cookies: ownerCookie }),
      makeParams(taskId),
    );
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()) as { status: string; executionId: string | null };
    expect(["UNAVAILABLE", "FAILED", "TIMEOUT", "RATE_LIMITED", "AUTH_FAILED"]).toContain(body.status);
    expect(body.status).not.toBe("SUCCEEDED");
    if (body.executionId) {
      const row = await prisma.agentExecution.findUniqueOrThrow({ where: { id: body.executionId } });
      expect(row.status).toBe(body.status);
      expect(row.mode).toBe("LIVE");
      expect(row.dryRun).toBe(false);
      expect(row.error).toBeTruthy(); // classified, sanitized reason persisted
    }
  });

  it("enforces the state machine: illegal transitions are rejected", async () => {
    const key = buildExecutionIdempotencyKey({ ownerId, taskId, integration: "reddit", action: "SEARCH_POSTS", mode: "LIVE" });
    const { execution } = await createExecutionIdempotent({
      taskId,
      ownerId,
      opportunityId: null,
      experimentId: null,
      integration: "reddit",
      action: "SEARCH_POSTS",
      capability: "SEARCH",
      approvalStatus: "NOT_REQUIRED",
      idempotencyKey: key,
      mode: "LIVE",
      dryRun: false,
      maxAttempts: 2,
    });
    // QUEUED → SUCCEEDED is illegal.
    await expect(transitionExecution(execution.id, "QUEUED", "SUCCEEDED", {})).rejects.toBeInstanceOf(IllegalExecutionTransitionError);
    // QUEUED → RUNNING → SUCCEEDED is legal.
    await transitionExecution(execution.id, "QUEUED", "RUNNING", { startedAt: new Date() });
    await transitionExecution(execution.id, "RUNNING", "SUCCEEDED", { result: null as never, error: null, dataClass: "REAL_DATA" });
    // Terminal states have no outgoing edges.
    await expect(transitionExecution(execution.id, "SUCCEEDED", "RUNNING", {})).rejects.toBeInstanceOf(IllegalExecutionTransitionError);
    // FAILED → RUNNING is the legal retry edge; SUCCEEDED is not reachable from FAILED.
    await expect(transitionExecution(execution.id, "FAILED", "SUCCEEDED", {})).rejects.toBeInstanceOf(IllegalExecutionTransitionError);
  });

  it("concurrent duplicate creates resolve to one row", async () => {
    const key = buildExecutionIdempotencyKey({ ownerId, taskId, integration: "reddit", action: "SEARCH_POSTS", mode: "DRY_RUN" });
    const payload = {
      taskId,
      ownerId,
      opportunityId: null,
      experimentId: null,
      integration: "reddit",
      action: "SEARCH_POSTS",
      capability: "SEARCH",
      approvalStatus: "NOT_REQUIRED",
      idempotencyKey: key,
      mode: "DRY_RUN",
      dryRun: true,
      maxAttempts: 1,
    };
    const [a, b, c] = await Promise.all([
      createExecutionIdempotent(payload),
      createExecutionIdempotent(payload),
      createExecutionIdempotent(payload),
    ]);
    expect(a.execution.id).toBe(b.execution.id);
    expect(b.execution.id).toBe(c.execution.id);
    const createdCount = [a, b, c].filter((r) => r.created).length;
    expect(createdCount).toBe(1);
  });

  it("retry limit is bounded: a maxed-out execution is not re-run", async () => {
    const key = buildExecutionIdempotencyKey({ ownerId, taskId, integration: "google-trends", action: "SEARCH_TRENDS", mode: "LIVE" });
    await createExecutionIdempotent({
      taskId,
      ownerId,
      opportunityId: null,
      experimentId: null,
      integration: "google-trends",
      action: "SEARCH_TRENDS",
      capability: "SEARCH",
      approvalStatus: "NOT_REQUIRED",
      idempotencyKey: key,
      mode: "LIVE",
      dryRun: false,
      maxAttempts: 1,
    });
    const { getExecutionByIdempotencyKey } = await import("./execution-repository");
    const existing = await getExecutionByIdempotencyKey(key);
    expect(existing).toBeTruthy();
    // Drive it to terminal FAILED with retryCount at maxAttempts.
    await transitionExecution(existing!.id, "QUEUED", "RUNNING", { startedAt: new Date() });
    await transitionExecution(existing!.id, "RUNNING", "FAILED", { error: "boom" });
    await prisma.agentExecution.update({ where: { id: existing!.id }, data: { retryCount: 1 } });
    const { runAgentTaskExecution } = await import("./execution-orchestrator");
    const outcome = await runAgentTaskExecution(taskId, ownerId, { mode: "LIVE" });
    // The orchestrator must refuse to exceed maxAttempts for that key.
    const after = await getExecutionByIdempotencyKey(key);
    expect(after!.retryCount).toBeLessThanOrEqual(after!.maxAttempts);
  });

  it("executions are owner-scoped: another user sees none of them", async () => {
    const { GET: listExecutions } = await import("@/app/api/agent-tasks/[id]/executions/route");
    const suffix = uniqueSuffix();
    const { POST: register } = await import("@/app/api/auth/register/route");
    const registerResponse = await register(
      makeRequest("http://localhost/api/auth/register", {
        method: "POST",
        body: { email: `exec-b-${suffix}@example.com`, password: "password-B-123", name: "Exec B" },
      }),
    );
    const userBCookie = { ail_session: extractSessionToken(registerResponse) as string };
    cleanup.push(async () => {
      const bUser = await prisma.user.findUnique({ where: { email: `exec-b-${suffix}@example.com` } });
      if (bUser) await prisma.user.delete({ where: { id: bUser.id } });
    });

    const responseB = await listExecutions(
      makeRequest(`http://localhost/api/agent-tasks/${taskId}/executions`, { cookies: userBCookie }),
      makeParams(taskId),
    );
    // Cross-tenant task access is 404-masked.
    expect(responseB.status).toBe(404);

    const responseA = await listExecutions(
      makeRequest(`http://localhost/api/agent-tasks/${taskId}/executions`, { cookies: ownerCookie }),
      makeParams(taskId),
    );
    expect(responseA.status).toBe(200);
    const bodyA = JSON.parse(await responseA.text()) as { executions: unknown[] };
    expect(bodyA.executions.length).toBeGreaterThan(0);
  });

  it("approval-requiring configurations never execute and leave no execution row", async () => {
    // No current mapping carries an approval-class capability, so assert the
    // invariant directly and confirm the gate path via a requiresApproval task.
    const { TASK_TYPE_ACTIONS } = await import("@/lib/integrations/permissions");
    const approvalEntries = Object.values(TASK_TYPE_ACTIONS).flat().filter(
      (entry) => entry.capability === "PUBLISH" || entry.capability === "SPEND_MONEY" || entry.capability === "SEND_MESSAGE",
    );
    expect(approvalEntries).toHaveLength(0);

    const { createAgentTask } = await import("@/lib/server/agent-task-repository");
    const agent = await prisma.agent.findFirstOrThrow({ where: { type: "RESEARCH" } });
    const gated = await createAgentTask({
      agentId: agent.id,
      ownerId,
      taskType: "RESEARCH",
      objective: "Gated work",
      instructions: "",
      requiresApproval: true,
      expectedOutputs: [],
      constraints: [],
      budgetLimit: 0,
      timeLimitSeconds: 60,
      maxOutputChars: 5000,
      maxRetries: 1,
      maxActions: 5,
    });
    cleanup.push(async () => {
      await prisma.agentTask.deleteMany({ where: { id: gated.id } });
    });
    const { runAgentTaskExecution } = await import("./execution-orchestrator");
    const outcome = await runAgentTaskExecution(gated.id, ownerId, { mode: "DRY_RUN" });
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.message).toContain("approval");
    expect(outcome.executionId).toBeNull();
    const rows = await prisma.agentExecution.findMany({ where: { taskId: gated.id } });
    expect(rows).toHaveLength(0);
  });

  it("never persists secret-shaped values in execution rows", async () => {
    const rows = await prisma.agentExecution.findMany({ where: { taskId } });
    for (const row of rows) {
      const serialized = JSON.stringify({ e: row.error, r: row.result });
      expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
      expect(serialized.toLowerCase()).not.toContain("bearer ");
      expect(serialized).not.toMatch(/(api[_-]?key|password|secret)\s*[:=]\s*\S+/i);
    }
  });
});
