"use client";

import { KeyRound, Save, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import ActiveSessions from "@/components/auth/ActiveSessions";
import SignInActivity from "@/components/auth/SignInActivity";
import ErrorState from "@/components/ui/ErrorState";
import PageHeader from "@/components/ui/PageHeader";
import { authApi, beginMFASetup, confirmMFASetup, disableMFA, getApiErrorMessage, getMFAStatus, setMFAMethod } from "@/lib/api";
import PasswordStrength from "@/components/ui/PasswordStrength";
import type { MFAStatus } from "@/lib/api/auth";
import { QRCodeSVG } from "qrcode.react";
import { buttonClasses } from "@/components/ui/Button";

export default function SecuritySettingsPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError(null); setSaved(false);
    if (newPassword !== confirmation) { setError("The new password and confirmation do not match."); return; }
    setSaving(true);
    try { await authApi.changePassword({ current_password: currentPassword, new_password: newPassword }); setCurrentPassword(""); setNewPassword(""); setConfirmation(""); setSaved(true); }
    catch (caught) { setError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };
  return <div className="mx-auto max-w-6xl space-y-6"><PageHeader title="Security" description="Manage your password, multi-factor protection and signed-in sessions." /><div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]"><div className="min-w-0 space-y-6">{error && <ErrorState title="Unable to change password" message={error} />}<form onSubmit={save} className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6"><div className="flex gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-ink"><KeyRound size={19} /></span><div><h2 className="text-card-title font-bold text-headline">Change password</h2><p className="mt-1 text-sm leading-6 text-ink-muted">Confirm your current password before setting a new one.</p></div></div><div className="mt-6 space-y-5"><Field label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" /><Field label="New password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" /><PasswordStrength value={newPassword} /><Field label="Confirm new password" value={confirmation} onChange={setConfirmation} autoComplete="new-password" /></div><div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-5"><a href="/forgot-password" className="text-sm font-semibold text-primary-ink hover:text-primary">Forgot your current password?</a><button type="submit" disabled={saving || !currentPassword || !newPassword || !confirmation} className={buttonClasses({ variant: "primary" })}><Save size={16} />{saving ? "Changing…" : "Change password"}</button></div>{saved && <p className="mt-4 rounded-xl border border-success/25 bg-success-soft p-3 text-sm text-success-ink">Your password was changed successfully.</p>}</form><MFASection /><ActiveSessions /></div><aside className="space-y-6 lg:sticky lg:top-20 lg:self-start"><SignInActivity /></aside></div></div>;
}

function Field({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string }) { return <label className="block text-sm font-medium text-ink"><span>{label}</span><input required type="password" value={value} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} className="mt-1.5 block w-full h-9 rounded-lg border border-line-strong px-3 text-sm text-ink-strong" /></label>; }

type MFAFlow = "authenticator" | "email" | "disable" | null;

const secondaryButton = "rounded-xl border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-60";
const codeInputClass = "h-11 max-w-48 rounded-lg border border-line-strong bg-surface px-3 font-mono text-sm tracking-widest text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

function MFASection() {
  const [mfa, setMfa] = useState<MFAStatus>({ enabled: false, pending: false });
  const [flow, setFlow] = useState<MFAFlow>(null);
  const [code, setCode] = useState("");
  const [emailTarget, setEmailTarget] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  useEffect(() => { getMFAStatus().then(setMfa).catch(() => undefined); }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setNotice(null);
    try { await action(); } catch (caught) { setNotice({ tone: "error", text: getApiErrorMessage(caught) }); } finally { setBusy(false); }
  };
  const startAuthenticator = () => run(async () => { const setup = await beginMFASetup(); setMfa((current) => ({ ...current, ...setup, enabled: false, pending: true })); setFlow("authenticator"); setCode(""); });
  const confirmAuthenticator = () => run(async () => { const status = await confirmMFASetup(code); setMfa({ ...status, method: status.method ?? "AUTHENTICATOR_APP" }); setFlow(null); setCode(""); setNotice({ tone: "info", text: "Authenticator MFA is enabled." }); });
  const sendEmailCode = () => run(async () => { const sent = await setMFAMethod("EMAIL_OTP"); setEmailTarget(sent.email ?? ""); setFlow("email"); setCode(""); setNotice({ tone: "info", text: `We sent a six-digit code to ${sent.email ?? "your email"}. It expires in 5 minutes.` }); });
  const confirmEmail = () => run(async () => { setMfa(await setMFAMethod("EMAIL_OTP", code)); setFlow(null); setCode(""); setNotice({ tone: "info", text: "Email OTP MFA is enabled. A code will be emailed each time you sign in." }); });
  const disable = () => run(async () => { setMfa(await disableMFA(disablePassword)); setFlow(null); setCode(""); setDisablePassword(""); setNotice({ tone: "info", text: "Multi-factor authentication is disabled." }); });
  const cancelFlow = () => { setFlow(null); setCode(""); setDisablePassword(""); setNotice(null); };

  const codeField = (label: string) => <label className="grid gap-1 text-sm font-medium">{label}<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} maxLength={6} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className={codeInputClass} /></label>;

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-3"><ShieldCheck className="text-primary-ink" /><div><h2 className="text-card-title font-bold text-headline">Multi-factor authentication</h2><p className="mt-1 text-sm leading-6 text-ink-muted">Use an authenticator app or email code for an additional sign-in challenge. This is optional.</p></div></div>

      {mfa.enabled && <p className="mt-5 rounded-xl bg-success-soft p-3 text-sm text-success-ink">{mfa.method === "EMAIL_OTP" ? "Email OTP MFA is enabled for this account." : "Authenticator MFA is enabled for this account."}</p>}

      {flow !== "email" && flow !== "disable" && <div className="mt-4 flex flex-wrap gap-2">
        {!mfa.enabled && <button type="button" disabled={busy} onClick={() => void startAuthenticator()} className={buttonClasses({ variant: "primary" })}>{mfa.pending ? "Show setup QR code" : "Set up authenticator"}</button>}
        {mfa.method !== "EMAIL_OTP" || !mfa.enabled ? <button type="button" disabled={busy} onClick={() => void sendEmailCode()} className={secondaryButton}>{mfa.enabled ? "Switch to email OTP" : "Enable email OTP"}</button> : null}
        {mfa.enabled && <button type="button" disabled={busy} onClick={() => { setFlow("disable"); setNotice(null); }} className="rounded-xl border border-danger/40 px-4 py-2.5 text-sm font-semibold text-danger-ink disabled:opacity-60">Disable MFA</button>}
      </div>}

      {flow === "disable" && mfa.enabled && <form className="mt-5 space-y-3 rounded-xl border border-danger/25 bg-danger-soft/40 p-4" onSubmit={(event) => { event.preventDefault(); void disable(); }}>
        <p className="text-sm text-ink-muted">Confirm your current password to turn off multi-factor authentication. Your account will then be protected by its password alone.</p>
        <label className="grid max-w-sm gap-1 text-sm font-medium">Current password<input type="password" required value={disablePassword} onChange={(event) => setDisablePassword(event.target.value)} autoComplete="current-password" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong" /></label>
        <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || !disablePassword} className={buttonClasses({ variant: "danger" })}>Turn off MFA</button><button type="button" onClick={cancelFlow} disabled={busy} className={secondaryButton}>Cancel</button></div>
      </form>}

      {flow === "authenticator" && !mfa.enabled && mfa.otpauth_uri && <div className="mt-5 space-y-3 rounded-xl bg-surface-muted p-4">
        <div className="flex flex-wrap items-start gap-5"><div className="rounded-xl bg-white p-3 shadow-sm"><QRCodeSVG value={mfa.otpauth_uri} size={176} marginSize={2} level="M" bgColor="#ffffff" fgColor="#000000" title="Authenticator setup QR code" /></div><div className="min-w-0 flex-1"><ol className="list-decimal space-y-1 pl-4 text-sm text-ink-muted"><li>Open Google Authenticator, Microsoft Authenticator, or another TOTP app.</li><li>Scan this QR code, or enter the manual key below.</li><li>Enter the six-digit code the app shows to finish setup.</li></ol><p className="mt-3 text-xs font-medium text-ink-muted">Manual setup key</p><code className="block break-all font-mono text-sm text-ink-strong">{mfa.secret}</code></div></div>
        {codeField("Verification code")}
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void confirmAuthenticator()} disabled={busy || code.length !== 6} className={buttonClasses({ variant: "primary" })}>Confirm and enable</button><button type="button" onClick={cancelFlow} disabled={busy} className={secondaryButton}>Cancel</button></div>
      </div>}

      {flow === "email" && <div className="mt-5 space-y-3 rounded-xl bg-surface-muted p-4">
        <p className="text-sm text-ink-muted">Enter the six-digit code sent to <span className="font-semibold text-ink-strong">{emailTarget || "your email"}</span> to confirm you can receive sign-in codes.</p>
        {codeField("Email verification code")}
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void confirmEmail()} disabled={busy || code.length !== 6} className={buttonClasses({ variant: "primary" })}>Confirm and enable</button><button type="button" onClick={() => void sendEmailCode()} disabled={busy} className={secondaryButton}>Resend code</button><button type="button" onClick={cancelFlow} disabled={busy} className={secondaryButton}>Cancel</button></div>
      </div>}

      {notice && <p className={`mt-3 text-sm ${notice.tone === "error" ? "text-danger-ink" : "text-ink-muted"}`}>{notice.text}</p>}
    </section>
  );
}
