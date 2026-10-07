"use client";

import { LogOut, Monitor, Smartphone } from "lucide-react";
import { useCallback, useState } from "react";

import { useAuth } from "@/components/guards/AuthProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { getApiErrorMessage } from "@/lib/api";
import { listSessions, revokeOtherSessions, revokeSession, type UserSessionRow } from "@/lib/api/auth";
import { formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";

/** "Chrome on Windows" from a user-agent string; good enough to recognise a device. */
export function describeDevice(userAgent: string): { label: string; mobile: boolean } {
  const ua = userAgent || "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  return { label: os ? `${browser} on ${os}` : ua ? browser : "Unknown device", mobile: /Mobile|Android|iPhone/.test(ua) };
}

/** Security Center: the signed-in user's sessions, with per-session and bulk sign-out. */
export default function ActiveSessions() {
  const { logout } = useAuth();
  const load = useCallback(() => listSessions(), []);
  const { data, loading, error, reload } = useApiResource(load);
  const [pending, setPending] = useState<UserSessionRow | "others" | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const sessions = data?.sessions ?? [];
  const others = sessions.filter((session) => !session.current).length;

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setActionError("");
    try {
      if (pending === "others") await revokeOtherSessions();
      else {
        const result = await revokeSession(pending.id);
        if (result.current) {
          logout();
          return;
        }
      }
      setPending(null);
      reload();
    } catch (err) {
      setActionError(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1 sm:p-6" aria-labelledby="sessions-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-ink"><Monitor size={19} aria-hidden="true" /></span>
          <div>
            <h2 id="sessions-heading" className="text-card-title font-semibold text-ink-strong">Active sessions</h2>
            <p className="mt-1 text-sm text-ink-muted">Browsers and devices signed in to your account. Signing one out ends it immediately.</p>
          </div>
        </div>
        {others > 0 && <Button variant="secondary" size="sm" leadingIcon={<LogOut className="h-4 w-4" />} onClick={() => setPending("others")}>Sign out all other sessions</Button>}
      </div>
      {actionError && <p role="alert" className="mt-4 rounded-lg border border-danger/25 bg-danger-soft p-3 text-sm text-danger-ink">{actionError}</p>}
      <div className="mt-5">
        {loading && !data ? <LoadingState variant="inline" label="Loading sessions" /> : error ? <ErrorState variant="inline" title="Unable to load sessions" message={error} onRetry={reload} /> : (
          <ul className="divide-y divide-line-soft rounded-lg border border-line">
            {sessions.map((session) => {
              const device = describeDevice(session.user_agent);
              const Icon = device.mobile ? Smartphone : Monitor;
              return (
                <li key={session.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Icon className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-strong">{device.label}{session.current && <Badge tone="success" dot size="sm">This device</Badge>}</p>
                    <p className="text-caption text-ink-muted">{session.ip_address ?? "Unknown network"} · signed in {formatDateTime(session.created_at)} · last active {formatDateTime(session.last_seen_at)}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setPending(session)}>{session.current ? "Sign out" : "Sign out session"}</Button>
                </li>
              );
            })}
            {sessions.length === 0 && <li className="px-4 py-3 text-sm text-ink-muted">No active sessions.</li>}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={pending !== null}
        title={pending === "others" ? "Sign out all other sessions?" : pending?.current ? "Sign out of this device?" : "Sign out this session?"}
        description={pending === "others" ? `${others} other session${others === 1 ? "" : "s"} will be signed out immediately.` : "That browser will need to sign in again."}
        confirmLabel="Sign out"
        tone="destructive"
        loading={busy}
        onConfirm={() => void confirm()}
        onCancel={() => { setPending(null); setActionError(""); }}
      />
    </section>
  );
}
