/**
 * HIGH-5 regression suite: the two agent-task execution routes are one route.
 *
 * The bug this locks down: `POST /api/agent-tasks/[id]/execute` called
 * `executeAgentTask()` directly and therefore skipped the orchestrator's
 * allowlisted-action resolution, permission/approval gates, execution limits,
 * `AgentExecution` audit persistence and idempotency keys.
 *
 * These tests drive the real route handlers and assert the two endpoints are
 * indistinguishable: same validation, same authorization, same audit rows and
 * same idempotent replay. No provider is contacted: every request uses
 * DRY_RUN, which runs the full gate chain without calling anything external.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/lib/db";
import { hashPassword } from "@/lib/server/password";

const hasDb = Boolean(process.env.DATABASE_URL);

const cookieJar: { current: Record<string, string> } = { current: {} };
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      const value = cookieJar.current[name];
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function makeRequest(url: string, init: { method?: string; body?: unknown; cookies?: Record<string, string>; rawBody?: string } = {}) {
  cookieJar.current = init.cookies ?? {};
  const headers = new Headers();
  if (init.body !== undefined || init.rawBody !== undefined) headers.set("content-type", "application/json");
  if (init.cookies) {
    headers.set("cookie", Object.entries(init.cookies).map(([k, v]) => `${k}=${v}`).join("; "));
  }
  return new Request(url, {
    method: init.method ?? "GET",
    headers,
    body: init.rawBody !== undefined ? init.rawBody : init.body === undefined ? null : JSON.stringify(init.body),
  });
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

describe.skipIf(!hasDb)("HIGH-5 execution route parity (real PostgreSQL)", () => {
  const prisma = getPrisma();
  const createdUsers: string[] = [];
  const createdAgents: string[] = [];
  const createdTasks: string[] = [];
  let agentId = "";

  beforeEach(() => {
    cookieJar.current = {};
  });

  afterAll(async () => {
    for (const id of createdTasks) await prisma.agentTask.delete({ where: { id } }).catch(() => undefined);
    for (const id of createdAgents) await prisma.agent.delete({ where: { id } }).catch(() => undefined);
    for (const id of createdUsers) await prisma.user.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  async function seed(tag: string) {
    const password = "password-P-123";
    const user = await prisma.user.create({
      data: {
        email: `routeparity-${tag}-${suffix}@example.com`.toLowerCase(),
        name: `Route parity ${tag}`,
        passwordHash: await hashPassword(password),
        role: "USER",
        status: "ACTIVE",
      },
    });
    createdUsers.push(user.id);

    const { POST: login } = await import("@/app/api/auth/login/route");
    const loginResponse = await login(
      makeRequest("http://localhost/api/auth/login", { method: "POST", body: { email: user.email, password } }),
    );
    expect(loginResponse.status).toBe(200);
    const cookie = { ail_session: sessionToken(loginResponse) };

    if (!agentId) {
      const agent = await prisma.agent.create({
        data: { name: `Parity Agent ${suffix}`, type: "RESEARCH", status: "ACTIVE" },
      });
      agentId = agent.id;
      createdAgents.push(agent.id);
    }

    const task = await prisma.agentTask.create({
      data: {
        id: `parity_${tag}_${suffix}`,
        agentId,
        ownerId: user.id,
        contractVersion: 1,
        taskType: "RESEARCH",
        objective: "Produce a deterministic parity report",
        instructions: "Summarize the recorded inputs. Do not take any external action.",
        inputs: { topic: "parity" },
        status: "READY",
        maxRetries: 1,
        maxOutputChars: 500,
        requiresApproval: false,
        approvalState: "NOT_REQUIRED",
      },
    });
    createdTasks.push(task.id);

    return { user, cookie, task };
  }

  it("rejects unauthenticated requests identically on both routes", async () => {
    const { POST: legacy } = await import("@/app/api/agent-tasks/[id]/execute/route");
    const { POST: hardened } = await import("@/app/api/agent-tasks/[id]/executions/route");

    const legacyResponse = await legacy(
      makeRequest("http://localhost/api/agent-tasks/x/execute", { method: "POST", body: { mode: "DRY_RUN" } }),
      { params: { id: "x" } },
    );
    const hardenedResponse = await hardened(
      makeRequest("http://localhost/api/agent-tasks/x/executions", { method: "POST", body: { mode: "DRY_RUN" } }),
      { params: { id: "x" } },
    );

    expect(legacyResponse.status).toBe(401);
    expect(hardenedResponse.status).toBe(legacyResponse.status);
    expect(await legacyResponse.json()).toEqual(await hardenedResponse.json());
  });

  it("rejects an invalid task id identically on both routes", async () => {
    const { cookie } = await seed("invalid-id");
    const { POST: legacy } = await import("@/app/api/agent-tasks/[id]/execute/route");
    const { POST: hardened } = await import("@/app/api/agent-tasks/[id]/executions/route");

    const tooLong = "t".repeat(65);
    const legacyResponse = await legacy(
      makeRequest("http://localhost/api/agent-tasks/x/execute", { method: "POST", body: { mode: "DRY_RUN" }, cookies: cookie }),
      { params: { id: tooLong } },
    );
    const hardenedResponse = await hardened(
      makeRequest("http://localhost/api/agent-tasks/x/executions", { method: "POST", body: { mode: "DRY_RUN" }, cookies: cookie }),
      { params: { id: tooLong } },
    );

    expect(legacyResponse.status).toBe(400);
    expect(hardenedResponse.status).toBe(400);
    expect(await legacyResponse.json()).toEqual({ error: "Invalid task id" });
    expect(await hardenedResponse.json()).toEqual({ error: "Invalid task id" });
  });

  it("rejects an invalid mode identically on both routes", async () => {
    const { cookie, task } = await seed("invalid-mode");
    const { POST: legacy } = await import("@/app/api/agent-tasks/[id]/execute/route");
    const { POST: hardened } = await import("@/app/api/agent-tasks/[id]/executions/route");

    const legacyResponse = await legacy(
      makeRequest(`http://localhost/api/agent-tasks/${task.id}/execute`, { method: "POST", body: { mode: "EXFILTRATE" }, cookies: cookie }),
      { params: { id: task.id } },
    );
    const hardenedResponse = await hardened(
      makeRequest(`http://localhost/api/agent-tasks/${task.id}/executions`, { method: "POST", body: { mode: "EXFILTRATE" }, cookies: cookie }),
      { params: { id: task.id } },
    );

    expect(legacyResponse.status).toBe(400);
    expect(hardenedResponse.status).toBe(400);
    expect(await legacyResponse.json()).toEqual({ error: "mode must be LIVE or DRY_RUN" });
    expect(await hardenedResponse.json()).toEqual({ error: "mode must be LIVE or DRY_RUN" });
  });

  it("rejects an oversized body identically on both routes", async () => {
    const { cookie, task } = await seed("oversized");
    const { POST: legacy } = await import("@/app/api/agent-tasks/[id]/execute/route");
    const { POST: hardened } = await import("@/app/api/agent-tasks/[id]/executions/route");

    const big = JSON.stringify({ mode: "DRY_RUN", padding: "x".repeat(5_000) });
    const legacyResponse = await legacy(
      makeRequest(`http://localhost/api/agent-tasks/${task.id}/execute`, { method: "POST", rawBody: big, cookies: cookie }),
      { params: { id: task.id } },
    );
    const hardenedResponse = await hardened(
      makeRequest(`http://localhost/api/agent-tasks/${task.id}/executions`, { method: "POST", rawBody: big, cookies: cookie }),
      { params: { id: task.id } },
    );

    expect(legacyResponse.status).toBe(413);
    expect(hardenedResponse.status).toBe(413);
  });

  it("masks a cross-tenant task as not found on both routes", async () => {
    const owner = await seed("owner");
    const other = await seed("other");
    const { POST: legacy } = await import("@/app/api/agent-tasks/[id]/execute/route");
    const { POST: hardened } = await import("@/app/api/agent-tasks/[id]/executions/route");

    const legacyResponse = await legacy(
      makeRequest(`http://localhost/api/agent-tasks/${owner.task.id}/execute`, { method: "POST", body: { mode: "DRY_RUN" }, cookies: other.cookie }),
      { params: { id: owner.task.id } },
    );
    const hardenedResponse = await hardened(
      makeRequest(`http://localhost/api/agent-tasks/${owner.task.id}/executions`, { method: "POST", body: { mode: "DRY_RUN" }, cookies: other.cookie }),
      { params: { id: owner.task.id } },
    );

    expect(legacyResponse.status).toBe(404);
    expect(hardenedResponse.status).toBe(404);
    expect(await legacyResponse.json()).toEqual({ error: "Not found" });
  });

  it("persists an auditable AgentExecution row through the legacy route", async () => {
    const { user, cookie, task } = await seed("legacy-audit");
    const { POST: legacy } = await import("@/app/api/agent-tasks/[id]/execute/route");

    const response = await legacy(
      makeRequest(`http://localhost/api/agent-tasks/${task.id}/execute`, { method: "POST", body: { mode: "DRY_RUN" }, cookies: cookie }),
      { params: { id: task.id } },
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as { executionId: string | null; status: string; mode: string };
    expect(body.executionId).toBeTruthy();
    expect(body.mode).toBe("DRY_RUN");

    // The audit row the legacy path used to skip entirely.
    const execution = await prisma.agentExecution.findUniqueOrThrow({ where: { id: body.executionId! } });
    expect(execution.taskId).toBe(task.id);
    expect(execution.ownerId).toBe(user.id);
    expect(execution.dryRun).toBe(true);
    expect(execution.idempotencyKey).toBeTruthy();
  });

  it("returns identical bodies from both routes for the same task and mode", async () => {
    const { cookie, task } = await seed("identical");
    const { POST: legacy } = await import("@/app/api/agent-tasks/[id]/execute/route");
    const { POST: hardened } = await import("@/app/api/agent-tasks/[id]/executions/route");

    const legacyResponse = await legacy(
      makeRequest(`http://localhost/api/agent-tasks/${task.id}/execute`, { method: "POST", body: { mode: "DRY_RUN" }, cookies: cookie }),
      { params: { id: task.id } },
    );
    const legacyBody = await legacyResponse.json();

    // The hardened route then resolves the same idempotency key and replays the
    // recorded execution — proving both routes share one execution boundary.
    const hardenedResponse = await hardened(
      makeRequest(`http://localhost/api/agent-tasks/${task.id}/executions`, { method: "POST", body: { mode: "DRY_RUN" }, cookies: cookie }),
      { params: { id: task.id } },
    );
    const hardenedBody = (await hardenedResponse.json()) as { executionId: string | null };

    expect(legacyResponse.status).toBe(hardenedResponse.status);
    expect((legacyBody as { executionId: string }).executionId).toBe(hardenedBody.executionId);
    // Exactly one execution row exists for the task.
    expect(await prisma.agentExecution.count({ where: { taskId: task.id } })).toBe(1);
  });

  it("blocks a task that is waiting for approval on both routes, persisting no execution", async () => {
    const { cookie, task } = await seed("awaiting-approval");
    await prisma.agentTask.update({ where: { id: task.id }, data: { status: "WAITING_APPROVAL" } });

    const { POST: legacy } = await import("@/app/api/agent-tasks/[id]/execute/route");
    const { POST: hardened } = await import("@/app/api/agent-tasks/[id]/executions/route");

    const legacyResponse = await legacy(
      makeRequest(`http://localhost/api/agent-tasks/${task.id}/execute`, { method: "POST", body: { mode: "DRY_RUN" }, cookies: cookie }),
      { params: { id: task.id } },
    );
    const hardenedResponse = await hardened(
      makeRequest(`http://localhost/api/agent-tasks/${task.id}/executions`, { method: "POST", body: { mode: "DRY_RUN" }, cookies: cookie }),
      { params: { id: task.id } },
    );

    expect(legacyResponse.status).toBe(200);
    expect(hardenedResponse.status).toBe(200);
    const legacyBody = (await legacyResponse.json()) as { status: string; executionId: string | null; message: string };
    const hardenedBody = (await hardenedResponse.json()) as { status: string; executionId: string | null; message: string };
    expect(legacyBody.status).toBe("BLOCKED");
    expect(legacyBody.executionId).toBeNull();
    expect(legacyBody.message).toContain("approval");
    expect(hardenedBody.status).toBe(legacyBody.status);
    expect(hardenedBody.executionId).toBeNull();
    // No execution was persisted for a blocked task.
    expect(await prisma.agentExecution.count({ where: { taskId: task.id } })).toBe(0);
  });
});
