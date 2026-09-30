"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/http";

/**
 * Account Security — TOTP two-factor authentication (TOTP-2FA hardening).
 * The raw secret is shown only during setup; after enrollment the server
 * never returns it again. Recovery codes are displayed exactly once.
 */

interface TotpStatus {
  totpEnabled: boolean;
  pendingSetup: boolean;
  recoveryCodesRemaining: number;
}

interface SetupResponse {
  otpauthUri: string;
  accountLabel: string;
}

interface CodesResponse {
  recoveryCodes?: string[];
}

const RECOVERY_FILE_HEADER =
  "AI Income Lab — two-factor recovery codes.\nEach code works exactly once, in place of your authenticator code at sign-in.";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none";

export default function SecuritySettings() {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [setupPassword, setSetupPassword] = useState("");
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secretText, setSecretText] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [showDisable, setShowDisable] = useState(false);
  const [regenPassword, setRegenPassword] = useState("");
  const [regenCode, setRegenCode] = useState("");
  const [showRegen, setShowRegen] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const data = await apiGet<TotpStatus>("/api/auth/totp");
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load 2FA status");
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  async function startSetup(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await apiSend<SetupResponse>("/api/auth/totp/setup", "POST", { password: setupPassword });
      setSetup(data);
      // Render the otpauth:// URI as a QR code client-side; the secret never
      // leaves this page except in the QR/URI the user scans.
      const QRCode = (await import("qrcode")).default;
      const url = await QRCode.toDataURL(data.otpauthUri, { margin: 1, width: 200 });
      setQrDataUrl(url);
      setSecretText(data.otpauthUri.split("secret=")[1]?.split("&")[0] ?? "");
      setSetupPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start 2FA setup");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await apiSend<CodesResponse>("/api/auth/totp/confirm", "POST", { code: confirmCode });
      setRecoveryCodes(data.recoveryCodes ?? null);
      setSetup(null);
      setQrDataUrl(null);
      setSecretText("");
      setConfirmCode("");
      setNotice("Two-factor authentication is now enabled. Store your recovery codes somewhere safe — they are shown only once.");
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm 2FA setup");
    } finally {
      setBusy(false);
    }
  }

  async function disableTotp(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiSend<{ revokedSessions: number }>("/api/auth/totp/disable", "POST", {
        password: disablePassword,
        code: disableCode,
      });
      setShowDisable(false);
      setDisablePassword("");
      setDisableCode("");
      setNotice(`Two-factor authentication disabled. ${result.revokedSessions} other session(s) signed out.`);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable 2FA");
    } finally {
      setBusy(false);
    }
  }

  async function regenerate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await apiSend<CodesResponse>("/api/auth/totp/recovery", "POST", {
        password: regenPassword,
        code: regenCode,
      });
      setRecoveryCodes(data.recoveryCodes ?? null);
      setShowRegen(false);
      setRegenPassword("");
      setRegenCode("");
      setNotice("New recovery codes generated. All previous codes no longer work.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate recovery codes");
    } finally {
      setBusy(false);
    }
  }

  function downloadRecoveryCodes() {
    if (!recoveryCodes) return;
    const blob = new Blob(
      [`${RECOVERY_FILE_HEADER}\n\n${recoveryCodes.join("\n")}\n`],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ai-income-lab-recovery-codes.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const inputRow = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} className={inputClass} />
  );

  return (
    <div className="space-y-3 p-5">
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {notice && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>
      )}

      {recoveryCodes && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">Save your recovery codes now — shown only once.</p>
          <div className="flex flex-wrap gap-2">
            {recoveryCodes.map((code) => (
              <code key={code} className="rounded bg-white px-2 py-1 text-xs text-slate-800">{code}</code>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={downloadRecoveryCodes}>Download</Button>
            <Button variant="secondary" onClick={() => window.print()}>Print</Button>
            <Button variant="secondary" onClick={() => setRecoveryCodes(null)}>Done</Button>
          </div>
        </div>
      )}

      {!status ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : status.totpEnabled ? (
        <div className="space-y-3">
          <p className="text-sm">
            <span className="font-medium text-emerald-700">Enabled.</span>{" "}
            <span className="text-slate-600">
              Sign-in requires your password plus a 6-digit authenticator code
              {status.recoveryCodesRemaining > 0
                ? ` · ${status.recoveryCodesRemaining} unused recovery code(s)`
                : " · no unused recovery codes remain"}
              .
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => { setShowRegen((v) => !v); setShowDisable(false); }}>
              Regenerate recovery codes
            </Button>
            <Button variant="danger" onClick={() => { setShowDisable((v) => !v); setShowRegen(false); }}>
              Disable 2FA
            </Button>
          </div>

          {showRegen && (
            <form onSubmit={regenerate} className="space-y-3 rounded-lg border border-slate-200 p-4">
              <p className="text-xs text-slate-500">
                Requires your password and a current authenticator code. Previous codes stop working immediately.
              </p>
              {inputRow({ type: "password", placeholder: "Current password", autoComplete: "current-password", value: regenPassword, onChange: (e) => setRegenPassword(e.target.value), required: true })}
              {inputRow({ inputMode: "numeric", placeholder: "6-digit authenticator code", autoComplete: "one-time-code", value: regenCode, onChange: (e) => setRegenCode(e.target.value), required: true })}
              <Button type="submit" disabled={busy}>Regenerate</Button>
            </form>
          )}

          {showDisable && (
            <form onSubmit={disableTotp} className="space-y-3 rounded-lg border border-red-200 p-4">
              <p className="text-xs text-slate-500">
                Requires your password and a current authenticator code. All other sessions are signed out.
              </p>
              {inputRow({ type: "password", placeholder: "Current password", autoComplete: "current-password", value: disablePassword, onChange: (e) => setDisablePassword(e.target.value), required: true })}
              {inputRow({ inputMode: "numeric", placeholder: "6-digit authenticator code", autoComplete: "one-time-code", value: disableCode, onChange: (e) => setDisableCode(e.target.value), required: true })}
              <Button type="submit" variant="danger" disabled={busy}>Disable 2FA</Button>
            </form>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {status.pendingSetup ? "A setup was started but not confirmed — starting again issues a fresh code." : "Not enabled."}{" "}
            <span className="text-slate-500">Compatible with Google Authenticator, 1Password, Authy and other TOTP apps.</span>
          </p>

          {!setup ? (
            <form onSubmit={startSetup} className="space-y-3 rounded-lg border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Step 1 — confirm your password to begin.</p>
              {inputRow({ type: "password", placeholder: "Current password", autoComplete: "current-password", value: setupPassword, onChange: (e) => setSetupPassword(e.target.value), required: true })}
              <Button type="submit" disabled={busy}>Continue</Button>
            </form>
          ) : (
            <div className="space-y-3 rounded-lg border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Step 2 — scan with your authenticator app, or enter the setup key manually.</p>
              {qrDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrDataUrl} alt="2FA QR code" width={200} height={200} className="rounded border border-slate-200" />
              )}
              {secretText && (
                <p className="break-all text-xs text-slate-600">
                  <span className="font-medium">Setup key:</span> <code>{secretText}</code>
                </p>
              )}
              <form onSubmit={confirmSetup} className="space-y-3">
                <p className="text-xs text-slate-500">Step 3 — enter the current 6-digit code to finish.</p>
                {inputRow({ inputMode: "numeric", placeholder: "6-digit code", autoComplete: "one-time-code", value: confirmCode, onChange: (e) => setConfirmCode(e.target.value), required: true })}
                <div className="flex gap-2">
                  <Button type="submit" disabled={busy}>Verify &amp; enable</Button>
                  <Button variant="secondary" onClick={() => { setSetup(null); setQrDataUrl(null); setSecretText(""); setConfirmCode(""); }}>Cancel</Button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
