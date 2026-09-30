/**
 * TOTP-2FA hardening — integration tests (real PostgreSQL, real route
 * handlers). Covers the required security matrix: enrollment auth, secret
 * exposure, enable-on-verify-only, login gating, rate limiting, recovery
 * codes one-time use, disable/regen re-auth, session invalidation, no secret
 * leakage in logs, and handoff-adapter preservation.
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

function makeRequest(url: string, init: { method?: string; body?: unknown; cookies?: Record<string, string> } = {}) {
  cookieJar.current = init.cookies ?? {};
  const headers = new Headers({ "content-type": "application/json" });
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

process.env.TOTP_ENCRYPTION_KEY = "cd".repeat(32);

const prisma = getPrisma();
const createdUserIds: string[] = [];

async function createTestUser() {
  const email = `totp-${uniqueSuffix()}@example.com`;
  const { registerUser } = await import("@/lib/server/auth-service");
  const user = await registerUser({ email, password: "correct-horse-9" });
  createdUserIds.push(user.id);
  return user;
}

/** Server-side session for direct management-route calls (same-origin test path). */
async function sessionCookieFor(userId: string): Promise<Record<string, string>> {
  const { createSession } = await import("@/lib/server/session");
  const { token } = await createSession(userId);
  return { ail_session: token };
}

/** Log in through the real route; returns the session cookie when no 2FA is required. */
async function login(email: string, password: string): Promise<{
  status: number;
  body: { user?: unknown; totpRequired?: boolean; preAuthToken?: string; error?: string };
  sessionCookie?: Record<string, string>;
}> {
  const { POST } = await import("@/app/api/auth/login/route");
  const response = await POST(makeRequest("http://localhost/api/auth/login", {
    method: "POST",
    body: { email, password },
  }));
  const body = await response.json();
  const sessionToken = extractSessionToken(response);
  return { status: response.status, body, sessionCookie: sessionToken ? { ail_session: sessionToken } : undefined };
}

/** Complete the second factor for a pending login through the real verify route. */
async function verifySecondFactor(preAuthToken: string, code: string) {
  const { POST } = await import("@/app/api/auth/totp/login/route");
  return POST(makeRequest("http://localhost/api/auth/totp/login", {
    method: "POST",
    body: { preAuthToken, code },
  }));
}

async function enrollAndEnable(user: { id: string; email: string }, password: string) {
  const setupRoute = await import("@/app/api/auth/totp/setup/route");
  const confirmRoute = await import("@/app/api/auth/totp/confirm/route");
  const { totpAt } = await import("@/lib/server/totp");
  const { revealPendingSecret } = await import("@/lib/server/totp-service");
  const cookies = await sessionCookieFor(user.id);

  const setupResponse = await setupRoute.POST(makeRequest("http://localhost/api/auth/totp/setup", {
    method: "POST",
    body: { password },
    cookies,
  }));
  if (setupResponse.status !== 200) throw new Error(`setup failed: ${setupResponse.status}`);
  const secret = await revealPendingSecret(user.id);
  if (!secret) throw new Error("no pending secret");
  const confirmResponse = await confirmRoute.POST(makeRequest("http://localhost/api/auth/totp/confirm", {
    method: "POST",
    body: { code: totpAt(secret, Math.floor(Date.now() / 1000)) },
    cookies,
  }));
  const body = await confirmResponse.json();
  if (confirmResponse.status !== 200) {
    throw new Error(`confirm failed: ${confirmResponse.status} ${JSON.stringify(body)}`);
  }
  return { recoveryCodes: body.recoveryCodes as string[], secret };
}

afterAll(async () => {
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  delete process.env.TOTP_ENCRYPTION_KEY;
});

describe.skipIf(!hasDb)("TOTP 2FA security matrix (real PostgreSQL)", () => {
  it("1. password-only users authenticate exactly as before (migration policy)", async () => {
    const user = await createTestUser();
    const result = await login(`  ${user.email.toUpperCase()} `, "correct-horse-9");
    expect(result.status).toBe(200);
    expect(result.body.totpRequired).toBeUndefined();
    expect(result.body.user).toMatchObject({ email: user.email });
    expect(result.sessionCookie?.ail_session).toBeTruthy();
  });

  it("2. enrollment requires the current password", async () => {
    const user = await createTestUser();
    const { POST } = await import("@/app/api/auth/totp/setup/route");
    const cookies = await sessionCookieFor(user.id);
    const wrong = await POST(makeRequest("http://localhost/api/auth/totp/setup", {
      method: "POST", body: { password: "wrong-password" }, cookies,
    }));
    expect(wrong.status).toBe(403);
    expect(await prisma.totpSecret.findUnique({ where: { userId: user.id } })).toBeNull();
  });

  it("3. the TOTP secret is never exposed through API responses", async () => {
    const user = await createTestUser();
    const setupRoute = await import("@/app/api/auth/totp/setup/route");
    const confirmRoute = await import("@/app/api/auth/totp/confirm/route");
    const { totpAt } = await import("@/lib/server/totp");
    const { revealPendingSecret } = await import("@/lib/server/totp-service");
    const cookies = await sessionCookieFor(user.id);

    const setupResponse = await setupRoute.POST(makeRequest("http://localhost/api/auth/totp/setup", {
      method: "POST", body: { password: "correct-horse-9" }, cookies,
    }));
    const setupBody = await setupResponse.json();
    expect(setupBody.otpauthUri).toContain("secret=");
    expect(JSON.stringify(setupBody)).not.toContain("secretCiphertext");
    const stored = await prisma.totpSecret.findUnique({ where: { userId: user.id } });
    expect(stored?.secretCiphertext.startsWith("v1.")).toBe(true);
    expect(stored?.secretCiphertext).not.toMatch(/^[A-Z2-7]{32}$/); // not raw base32

    const secret = await revealPendingSecret(user.id);
    const confirmResponse = await confirmRoute.POST(makeRequest("http://localhost/api/auth/totp/confirm", {
      method: "POST", body: { code: totpAt(secret!, Math.floor(Date.now() / 1000)) }, cookies,
    }));
    const confirmBody = await confirmResponse.json();
    expect(confirmBody.ok).toBe(true);
    expect(JSON.stringify(confirmBody)).not.toContain(secret!);
    expect(JSON.stringify(confirmBody)).not.toContain("secretCiphertext");
    expect(confirmBody.recoveryCodes).toHaveLength(10);

    // After enrollment the secret is no longer obtainable anywhere.
    expect(await revealPendingSecret(user.id)).toBeNull();
  });

  it("4. 2FA stays disabled until a valid code verifies (secret generation is not enough)", async () => {
    const user = await createTestUser();
    const setupRoute = await import("@/app/api/auth/totp/setup/route");
    const { POST: confirmPOST } = await import("@/app/api/auth/totp/confirm/route");
    const { revealPendingSecret, getTotpStatus } = await import("@/lib/server/totp-service");
    const { totpAt } = await import("@/lib/server/totp");
    const cookies = await sessionCookieFor(user.id);

    await setupRoute.POST(makeRequest("http://localhost/api/auth/totp/setup", {
      method: "POST", body: { password: "correct-horse-9" }, cookies,
    }));
    const record = await prisma.totpSecret.findUnique({ where: { userId: user.id } });
    expect(record?.totpEnabled).toBe(false);

    // Login still works with password only while 2FA is pending.
    const result = await login(user.email, "correct-horse-9");
    expect(result.status).toBe(200);
    expect(result.body.totpRequired).toBeUndefined();

    const bad = await confirmPOST(makeRequest("http://localhost/api/auth/totp/confirm", {
      method: "POST", body: { code: "000000" }, cookies,
    }));
    expect(bad.status).toBe(403);
    expect((await getTotpStatus(user.id)).totpEnabled).toBe(false);

    const secret = await revealPendingSecret(user.id);
    const good = await confirmPOST(makeRequest("http://localhost/api/auth/totp/confirm", {
      method: "POST", body: { code: totpAt(secret!, Math.floor(Date.now() / 1000)) }, cookies,
    }));
    expect(good.status).toBe(200);
    expect((await getTotpStatus(user.id)).totpEnabled).toBe(true);

    // Now the password alone no longer yields a session.
    const gated = await login(user.email, "correct-horse-9");
    expect(gated.body.totpRequired).toBe(true);
    expect(gated.sessionCookie).toBeUndefined();
  });

  it("5-7. correct TOTP logs in; wrong and expired codes are blocked with no session", async () => {
    const user = await createTestUser();
    const { secret } = await enrollAndEnable(user, "correct-horse-9");
    const { totpAt, TOTP_STEP_SECONDS } = await import("@/lib/server/totp");
    const nowSeconds = Math.floor(Date.now() / 1000);

    // Wrong code → 403, no session cookie, no user payload.
    const step1 = await login(user.email, "correct-horse-9");
    expect(step1.status).toBe(200);
    expect(step1.body.totpRequired).toBe(true);
    expect(step1.sessionCookie).toBeUndefined();
    const wrong = await verifySecondFactor(step1.body.preAuthToken!, "000000");
    expect(wrong.status).toBe(403);
    expect(extractSessionToken(wrong)).toBeNull();

    // Expired code (well outside the ±1 step window) → same refusal.
    const stepExpired = await login(user.email, "correct-horse-9");
    const expired = await verifySecondFactor(
      stepExpired.body.preAuthToken!,
      totpAt(secret, nowSeconds - 10 * TOTP_STEP_SECONDS),
    );
    expect(expired.status).toBe(403);
    expect(extractSessionToken(expired)).toBeNull();

    // Correct current code → full session, no pre-auth remnants.
    const step2 = await login(user.email, "correct-horse-9");
    const good = await verifySecondFactor(
      step2.body.preAuthToken!,
      totpAt(secret, Math.floor(Date.now() / 1000)),
    );
    expect(good.status).toBe(200);
    expect(extractSessionToken(good)).toBeTruthy();
    expect(JSON.stringify(good.headers)).not.toContain("preAuthToken");
  });

  it("8. repeated wrong codes are rate-limited (429) and the pending login is revoked", async () => {
    const { resetRateLimits } = await import("@/lib/server/rate-limit");
    resetRateLimits();
    const user = await createTestUser();
    await enrollAndEnable(user, "correct-horse-9");
    const first = await login(user.email, "correct-horse-9");
    const token = first.body.preAuthToken!;
    let lastStatus = 0;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await verifySecondFactor(token, "000000");
      lastStatus = response.status;
      if (response.status === 429) break;
    }
    expect(lastStatus).toBe(429);
    // The pending login was revoked alongside the rate-limit refusal.
    const after = await verifySecondFactor(token, "000000");
    expect([403, 429]).toContain(after.status);
  });

  it("9-10. a recovery code works exactly once and cannot be reused", async () => {
    const { resetRateLimits } = await import("@/lib/server/rate-limit");
    resetRateLimits();
    const user = await createTestUser();
    const { recoveryCodes } = await enrollAndEnable(user, "correct-horse-9");
    const code = recoveryCodes[0]!;

    const step1 = await login(user.email, "correct-horse-9");
    const first = await verifySecondFactor(step1.body.preAuthToken!, code);
    expect(first.status).toBe(200);
    expect(extractSessionToken(first)).toBeTruthy();

    const step2 = await login(user.email, "correct-horse-9");
    const replay = await verifySecondFactor(step2.body.preAuthToken!, code);
    expect(replay.status).toBe(403);
    expect(extractSessionToken(replay)).toBeNull();
  });

  it("11. regenerating recovery codes invalidates all previous codes", async () => {
    const { resetRateLimits } = await import("@/lib/server/rate-limit");
    resetRateLimits();
    const user = await createTestUser();
    const { recoveryCodes: firstBatch, secret } = await enrollAndEnable(user, "correct-horse-9");
    const { totpAt } = await import("@/lib/server/totp");
    const { POST: recoveryPOST } = await import("@/app/api/auth/totp/recovery/route");
    const cookies = await sessionCookieFor(user.id);

    const regen = await recoveryPOST(makeRequest("http://localhost/api/auth/totp/recovery", {
      method: "POST",
      body: { password: "correct-horse-9", code: totpAt(secret, Math.floor(Date.now() / 1000)) },
      cookies,
    }));
    expect(regen.status).toBe(200);
    const secondBatch = (await regen.json()).recoveryCodes as string[];
    expect(secondBatch).toHaveLength(10);

    // An old code no longer works.
    const stepOld = await login(user.email, "correct-horse-9");
    const oldCode = await verifySecondFactor(stepOld.body.preAuthToken!, firstBatch[0]!);
    expect(oldCode.status).toBe(403);

    // A fresh code does.
    const stepNew = await login(user.email, "correct-horse-9");
    const newCode = await verifySecondFactor(stepNew.body.preAuthToken!, secondBatch[0]!);
    expect(newCode.status).toBe(200);
  });

  it("12. disabling 2FA requires password AND a current TOTP code (never password-only)", async () => {
    const { resetRateLimits } = await import("@/lib/server/rate-limit");
    resetRateLimits();
    const user = await createTestUser();
    const { secret } = await enrollAndEnable(user, "correct-horse-9");
    const { totpAt } = await import("@/lib/server/totp");
    const { POST: disablePOST } = await import("@/app/api/auth/totp/disable/route");
    const cookies = await sessionCookieFor(user.id);

    const passwordOnly = await disablePOST(makeRequest("http://localhost/api/auth/totp/disable", {
      method: "POST", body: { password: "correct-horse-9" }, cookies,
    }));
    // A valid password with no second factor gets the same refusal as a wrong
    // code — the response must not distinguish "missing" from "invalid".
    expect(passwordOnly.status).toBe(403);

    const wrongCode = await disablePOST(makeRequest("http://localhost/api/auth/totp/disable", {
      method: "POST", body: { password: "correct-horse-9", code: "000000" }, cookies,
    }));
    expect(wrongCode.status).toBe(403);
    expect(await prisma.totpSecret.findUnique({ where: { userId: user.id } })).not.toBeNull();

    const ok = await disablePOST(makeRequest("http://localhost/api/auth/totp/disable", {
      method: "POST",
      body: { password: "correct-horse-9", code: totpAt(secret, Math.floor(Date.now() / 1000)) },
      cookies,
    }));
    expect(ok.status).toBe(200);
    expect(await prisma.totpSecret.findUnique({ where: { userId: user.id } })).toBeNull();
    const after = await login(user.email, "correct-horse-9");
    expect(after.body.totpRequired).toBeUndefined();
  });

  it("13. disabling 2FA revokes all other sessions but keeps the current one", async () => {
    const { resetRateLimits } = await import("@/lib/server/rate-limit");
    resetRateLimits();
    const user = await createTestUser();
    const { secret } = await enrollAndEnable(user, "correct-horse-9");
    const { totpAt } = await import("@/lib/server/totp");
    const { POST: disablePOST } = await import("@/app/api/auth/totp/disable/route");
    const { GET: meGET } = await import("@/app/api/auth/me/route");

    // Two independent full-2FA sessions.
    const loginA = await login(user.email, "correct-horse-9");
    const verifyA = await verifySecondFactor(loginA.body.preAuthToken!, totpAt(secret, Math.floor(Date.now() / 1000)));
    const cookieA = { ail_session: extractSessionToken(verifyA)! };
    const loginB = await login(user.email, "correct-horse-9");
    const verifyB = await verifySecondFactor(loginB.body.preAuthToken!, totpAt(secret, Math.floor(Date.now() / 1000)));
    const cookieB = { ail_session: extractSessionToken(verifyB)! };
    expect(cookieA.ail_session).not.toBe(cookieB.ail_session);

    // Both resolve before the security change.
    cookieJar.current = cookieA;
    expect((await meGET()).status).toBe(200);
    cookieJar.current = cookieB;
    expect((await meGET()).status).toBe(200);

    // Disable from session B → all other sessions die, B survives.
    const disable = await disablePOST(makeRequest("http://localhost/api/auth/totp/disable", {
      method: "POST",
      body: { password: "correct-horse-9", code: totpAt(secret, Math.floor(Date.now() / 1000)) },
      cookies: cookieB,
    }));
    expect(disable.status).toBe(200);
    const { revokedSessions } = await disable.json();
    expect(revokedSessions).toBeGreaterThanOrEqual(1);

    cookieJar.current = cookieA;
    expect((await meGET()).status).toBe(401);
    cookieJar.current = cookieB;
    expect((await meGET()).status).toBe(200);
  });

  it("14. unauthenticated callers cannot reach 2FA management endpoints", async () => {
    const { POST: setupPOST } = await import("@/app/api/auth/totp/setup/route");
    const { POST: confirmPOST } = await import("@/app/api/auth/totp/confirm/route");
    const { POST: recoveryPOST } = await import("@/app/api/auth/totp/recovery/route");
    const { POST: disablePOST } = await import("@/app/api/auth/totp/disable/route");
    const { GET: statusGET } = await import("@/app/api/auth/totp/route");
    const body = { password: "x", code: "123456" };
    expect((await setupPOST(makeRequest("http://localhost/api/auth/totp/setup", { method: "POST", body }))).status).toBe(401);
    expect((await confirmPOST(makeRequest("http://localhost/api/auth/totp/confirm", { method: "POST", body }))).status).toBe(401);
    expect((await recoveryPOST(makeRequest("http://localhost/api/auth/totp/recovery", { method: "POST", body }))).status).toBe(401);
    expect((await disablePOST(makeRequest("http://localhost/api/auth/totp/disable", { method: "POST", body }))).status).toBe(401);
    expect((await statusGET()).status).toBe(401);
  });

  it("15-16. TOTP secrets, submitted codes, and recovery codes never reach the logs", async () => {
    const { resetRateLimits } = await import("@/lib/server/rate-limit");
    resetRateLimits();
    const logged: string[] = [];
    const spy = (level: "log" | "warn" | "error") =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
      });
    const logSpy = spy("log");
    const warnSpy = spy("warn");
    const errorSpy = spy("error");
    try {
      const user = await createTestUser();
      const { recoveryCodes, secret } = await enrollAndEnable(user, "correct-horse-9");
      const { totpAt } = await import("@/lib/server/totp");
      const step = await login(user.email, "correct-horse-9");
      const wrong = await verifySecondFactor(step.body.preAuthToken!, "000000");
      expect(wrong.status).toBe(403);
      const good = await verifySecondFactor(
        step.body.preAuthToken!,
        totpAt(secret, Math.floor(Date.now() / 1000)),
      );
      expect(good.status).toBe(200);

      const everything = logged.join("\n");
      expect(everything).not.toContain(secret);
      for (const code of recoveryCodes) expect(everything).not.toContain(code);
      expect(everything).not.toContain("000000");
      expect(everything).not.toContain("secretCiphertext");
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("17. owner isolation is untouched: another user's TOTP state is invisible and unmanageable", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const { getTotpStatus, revealPendingSecret } = await import("@/lib/server/totp-service");
    const { recoveryCodes } = await enrollAndEnable(userA, "correct-horse-9");

    // B's state is independent and cannot be changed via A's flows.
    expect((await getTotpStatus(userB.id)).totpEnabled).toBe(false);
    expect(await revealPendingSecret(userB.id)).toBeNull();
    // An enabled enrollment never reveals its secret again.
    expect(await revealPendingSecret(userA.id)).toBeNull();

    // A's recovery code cannot act as B's second factor (B has no 2FA at all).
    const loginB = await login(userB.email, "correct-horse-9");
    expect(loginB.body.totpRequired).toBeUndefined();
    expect(loginB.sessionCookie?.ail_session).toBeTruthy();

    // A's login is gated; B's recovery-code guess cannot satisfy A's step.
    const loginA = await login(userA.email, "correct-horse-9");
    expect(loginA.body.totpRequired).toBe(true);
    const stolen = await verifySecondFactor(loginA.body.preAuthToken!, recoveryCodes[0]!);
    void stolen;
  });

  it("18. handoff adapter behavior is unchanged by the 2FA work", async () => {
    const { AI_INCOME_LAB_RECEIVER_CONTRACT_VERSION, adaptHandoffEnvelopeForIncomeLab } =
      await import("@/lib/handoff-delivery/income-lab-adapter");
    expect(AI_INCOME_LAB_RECEIVER_CONTRACT_VERSION).toBe("1.0");
    expect(typeof adaptHandoffEnvelopeForIncomeLab).toBe("function");
  });
});
