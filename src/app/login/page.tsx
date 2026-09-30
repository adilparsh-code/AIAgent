"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui";
import { apiSend } from "@/lib/http";
import { safeReturnTo } from "@/lib/safe-return-to";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // MEDIUM-10: untrusted `returnTo` is resolved to a same-origin path only.
  const returnTo = safeReturnTo(searchParams.get("returnTo"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // TOTP-2FA: after a valid password with 2FA enabled, the server returns a
  // short-lived pre-auth token; the session exists only after this code
  // verifies. The token grants nothing by itself — it is not a cookie.
  const [preAuthToken, setPreAuthToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await apiSend<{ totpRequired?: boolean; preAuthToken?: string; user?: unknown }>(
        "/api/auth/login",
        "POST",
        { email, password },
      );
      if (data.totpRequired && data.preAuthToken) {
        setPreAuthToken(data.preAuthToken);
        setBusy(false);
        return;
      }
      // Full navigation so server components pick up the new session cookie.
      window.location.assign(returnTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setBusy(false);
    }
  }

  async function handleTotpSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/auth/totp/login", "POST", { preAuthToken, code: totpCode });
      // Full navigation so server components pick up the new session cookie.
      window.location.assign(returnTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setBusy(false);
    }
  }

  if (preAuthToken) {
    return (
      <div className="mx-auto max-w-sm space-y-6 py-16">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Two-factor authentication</h1>
          <p className="text-sm text-slate-600">
            Enter your authenticator code to finish signing in.
          </p>
        </div>
        <form onSubmit={handleTotpSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="space-y-1">
            <label htmlFor="totp-code" className="text-sm font-medium text-slate-700">
              Authenticator code
            </label>
            <input
              id="totp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              placeholder="6-digit code"
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm tracking-widest focus:border-blue-500 focus:outline-none"
            />
            <p className="text-xs text-slate-500">
              You can enter a one-time recovery code here if you lost your device.
            </p>
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? "Verifying…" : "Verify and sign in"}
          </Button>
          <p className="text-sm text-slate-600">
            <button
              type="button"
              className="font-medium text-blue-600 hover:underline"
              onClick={() => {
                setPreAuthToken(null);
                setTotpCode("");
                setError(null);
              }}
            >
              Back to sign in
            </button>
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm space-y-6 py-16">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold">Sign in to AI Income Lab</h1>
        <p className="text-sm text-slate-600">
          Your opportunities, research, and experiments — private to your account.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-sm text-slate-600">
          No account?{" "}
          <Link href={`/register${returnTo !== "/" ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`} className="font-medium text-blue-600 hover:underline">
            Register
          </Link>
        </p>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
