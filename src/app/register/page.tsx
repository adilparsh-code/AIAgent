"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui";
import { apiSend } from "@/lib/http";
import { safeReturnTo } from "@/lib/safe-return-to";

function RegisterForm() {
  const searchParams = useSearchParams();
  // MEDIUM-10: untrusted `returnTo` is resolved to a same-origin path only.
  const returnTo = safeReturnTo(searchParams.get("returnTo"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/auth/register", "POST", { email, password, name });
      window.location.assign(returnTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-6 py-16">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="text-sm text-slate-600">
          Evidence-driven opportunity research, private to you.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-1">
          <label htmlFor="name" className="text-sm font-medium text-slate-700">
            Name <span className="text-slate-400">(optional)</span>
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
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
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <p className="text-xs text-slate-500">At least 8 characters.</p>
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </Button>
        <p className="text-sm text-slate-600">
          Already registered?{" "}
          <Link href={`/login${returnTo !== "/" ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`} className="font-medium text-blue-600 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
