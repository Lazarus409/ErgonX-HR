"use client";

import { CheckCircle2, KeyRound, LogIn, LogOut, ShieldAlert, ShieldCheck, type LucideIcon } from "lucide-react";
import { useCallback } from "react";

import { describeDevice } from "@/components/auth/ActiveSessions";
import ErrorState from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { listSignInActivity } from "@/lib/api/auth";
import { cx } from "@/lib/cx";
import { formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";

const EVENTS: Record<string, { label: string; icon: LucideIcon; tone: "ok" | "warn" | "info" }> = {
  "account.login.succeeded": { label: "Successful sign-in", icon: LogIn, tone: "ok" },
  "account.login.failed": { label: "Failed sign-in", icon: ShieldAlert, tone: "warn" },
  "account.logout": { label: "Signed out", icon: LogOut, tone: "info" },
  "account.password.changed": { label: "Password changed", icon: KeyRound, tone: "info" },
  "account.password.reset_completed": { label: "Password reset", icon: KeyRound, tone: "info" },
  "account.mfa.enabled": { label: "MFA turned on", icon: ShieldCheck, tone: "ok" },
  "account.mfa.method_changed": { label: "MFA method changed", icon: ShieldCheck, tone: "info" },
  "account.mfa.disabled": { label: "MFA turned off", icon: ShieldAlert, tone: "warn" },
  "account.mfa.disable_refused": { label: "MFA removal refused", icon: ShieldAlert, tone: "warn" },
};

/** Security Center (S043): the member's own recent sign-ins and security changes. */
export default function SignInActivity() {
  const load = useCallback(() => listSignInActivity(), []);
  const { data, loading, error, reload } = useApiResource(load);
  const events = data?.events ?? [];
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1" aria-labelledby="security-activity">
      <h2 id="security-activity" className="flex items-center gap-2 text-card-title font-semibold text-ink-strong"><CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" />Recent security activity</h2>
      <p className="mt-1 text-support text-ink-muted">Sign-ins and security changes on your account. If something looks unfamiliar, change your password and sign out other sessions.</p>
      {error && <div className="mt-3"><ErrorState variant="inline" title="Activity unavailable" message={error} onRetry={reload} /></div>}
      {loading && !data && <div className="mt-4 space-y-2">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-12 rounded-lg" />)}</div>}
      {data && events.length === 0 && <p className="mt-4 text-support text-ink-muted">No recorded activity yet.</p>}
      {events.length > 0 && (
        <ul className="mt-4 divide-y divide-line-soft">
          {events.map((event) => {
            const meta = EVENTS[event.action] ?? { label: event.action, icon: ShieldCheck, tone: "info" as const };
            return (
              <li key={event.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span className={cx("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", meta.tone === "ok" ? "bg-success-soft text-success" : meta.tone === "warn" ? "bg-danger-soft text-danger" : "bg-surface-muted text-ink-muted")} aria-hidden="true"><meta.icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className={cx("text-sm font-semibold", meta.tone === "warn" ? "text-danger-ink" : "text-ink-strong")}>{meta.label}</p>
                  <p className="truncate text-caption text-ink-muted">{[describeDevice(event.user_agent).label, event.ip_address].filter(Boolean).join(" · ")}</p>
                </div>
                <time className="shrink-0 text-right text-caption text-ink-subtle" dateTime={event.created_at}>{formatDateTime(event.created_at)}</time>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
