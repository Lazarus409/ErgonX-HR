"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/components/guards/AuthProvider";
import { getApiErrorMessage } from "@/lib/api";
import type { SessionBootstrap } from "@/types/auth";
import AuthShell, { AuthHeading } from "@/components/brand/AuthShell";
import Alert from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input } from "@/components/ui/Field";
import { IDLE_MINUTES } from "@/components/guards/IdleSignOut";

/** Landing chosen by the API from effective permissions (decision BQ-01). */
const LANDING_ROUTES: Record<string, string> = {
  PLATFORM: "/platform",
  EXECUTIVE: "/dashboard",
  INSIGHTS: "/insights",
  ME: "/me",
  HOME: "/",
};

function resolvePostLoginHref(bootstrap: SessionBootstrap): string {
  return LANDING_ROUTES[bootstrap.defaultLanding] ?? "/";
}

/** Only same-origin paths: "//host" and "/\host" would leave the site. */
function safeNext(next: string | null): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : null;
}

/**
 * Email + password (+ MFA) sign-in. The "platform" variant is the Super Admin
 * entrance at /admin: it only lets ErgonX Super Admins through and always lands
 * on the console; any other account is signed straight back out.
 */
export default function SignInForm({ variant = "workspace" }: { variant?: "workspace" | "platform" }) {
  const platform = variant === "platform";
  const { login, logout } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [emailOtp, setEmailOtp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [remember, setRemember] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    // Read once on arrival; avoids a Suspense boundary for useSearchParams.
    if (new URLSearchParams(window.location.search).get("reason") === "idle") {
      queueMicrotask(() => setNotice(`You were signed out after ${IDLE_MINUTES} minutes of inactivity. Sign in again to continue.`));
    }
  }, []);

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }

    try {
      setLoading(true);
      const bootstrap = await login(email, password, mfaCode || undefined, remember);
      if (platform) {
        if (bootstrap.defaultLanding !== "PLATFORM") {
          logout();
          setError("This sign-in is only for ErgonX Super Admins.");
          return;
        }
        router.replace("/platform");
        return;
      }
      const next = safeNext(new URLSearchParams(window.location.search).get("next"));
      router.replace(next ?? resolvePostLoginHref(bootstrap));
    } catch (err: unknown) {
      const apiError = err as { code?: string };
      if (apiError.code === "mfa_required") { setMfaRequired(true); setEmailOtp(false); setError("Enter the six-digit code from your authenticator app."); }
      else if (apiError.code === "email_otp_required") { setMfaRequired(true); setEmailOtp(true); setError("Enter the six-digit verification code sent to your email."); }
      else if (apiError.code === "institution_suspended") {
        // Credentials were valid but the organization is suspended: drop the session.
        logout();
        setError(getApiErrorMessage(err));
      }
      else setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const resendEmailCode = async () => {
    setError("");
    setMfaCode("");
    try {
      setLoading(true);
      await login(email, password, undefined, remember);
    } catch (err: unknown) {
      const apiError = err as { code?: string; fieldErrors?: Record<string, unknown> | null };
      if (apiError.code === "email_otp_required") {
        // The API keeps the open code for a minute after sending it instead of mailing another.
        const wait = Number(apiError.fieldErrors?.resend_available_in ?? 0);
        setError(wait > 0 && wait < 55
          ? `Your last code is still valid. You can request a new one in ${wait} seconds.`
          : "Enter the six-digit verification code sent to your email. A new code was sent; earlier codes no longer work.");
      }
      else setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      {platform
        ? <AuthHeading eyebrow="Platform administration" title="Super Admin sign in" description="Sign in to the ErgonX platform console to manage organizations, access requests and invitations." />
        : <AuthHeading title="Welcome back" description="Sign in to continue to your ErgonX workspace." />}
      <form onSubmit={handleSubmit} className="space-y-5">
        {notice && !error && <Alert tone="info">{notice}</Alert>}
        {error && <Alert tone={error.startsWith("Enter the six-digit") ? "info" : "danger"}>{error}{platform && error.startsWith("This sign-in is only") && <> Staff and organization users <Link href="/login" className="font-semibold underline">sign in here</Link>.</>}</Alert>}
        <Field label="Email address">
          <Input id="email" required type="email" size="lg" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" autoComplete="email" leadingIcon={<Mail />} />
        </Field>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-support font-semibold text-ink-strong">Password</label>
            <Link href="/forgot-password" className="text-support font-semibold text-primary-ink hover:underline">Forgot password?</Link>
          </div>
          <Input
            id="password"
            required
            size="lg"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
            leadingIcon={<LockKeyhole />}
            trailingSlot={
              <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="rounded-lg p-2 text-ink-subtle transition-colors hover:bg-surface-hover hover:text-ink-strong" aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            }
          />
        </div>
        {mfaRequired && (
          <div>
          <Field label={emailOtp ? "Email verification code" : "Authenticator code"}>
            <Input id="mfa-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required size="lg" value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" autoComplete="one-time-code" className="text-center text-lg tracking-[0.4em] tabular-nums" />
          </Field>
          {emailOtp && <button type="button" disabled={loading} onClick={() => void resendEmailCode()} className="mt-2 text-support font-semibold text-primary-ink hover:underline disabled:opacity-60">Resend code</button>}
          </div>
        )}
        <Checkbox
          id="remember"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
          label="Keep me signed in"
          description={`For 7 days on this device. Leave unticked on a shared computer: you'll be signed out when the browser closes or after ${IDLE_MINUTES} minutes of inactivity.`}
        />
        <Button type="submit" variant="strong" size="lg" block loading={loading} loadingLabel="Signing in…" trailingIcon={<ArrowRight className="h-4 w-4" />}>{platform ? "Sign in to the console" : "Sign in"}</Button>
      </form>
      {footer(platform)}
    </AuthShell>
  );
}

function footer(platform: boolean): ReactNode {
  return platform
    ? <p className="mt-8 text-center text-support text-ink-muted">Not a Super Admin? <Link href="/login" className="font-semibold text-primary-ink hover:underline">Go to the regular sign-in</Link></p>
    : <p className="mt-8 text-center text-support text-ink-muted">New to ErgonX? <Link href="/get-started" className="font-semibold text-primary-ink hover:underline">Get started</Link></p>;
}
