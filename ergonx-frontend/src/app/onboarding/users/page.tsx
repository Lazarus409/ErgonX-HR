"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, Copy, MailPlus, RefreshCw, ShieldCheck, UserRoundCheck, XCircle } from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import StatusBadge from "@/components/ui/StatusBadge";
import { getApiErrorMessage, institutionsApi } from "@/lib/api";
import { useApiResource } from "@/lib/useApiResource";
import type { InstitutionInvitation } from "@/types/institutions";
import { buttonClasses } from "@/components/ui/Button";
import { EXCLUDED_ROLE_CODES } from "@/lib/product";

type PendingAction =
  | { kind: "create" }
  | { kind: "resend"; invitation: InstitutionInvitation }
  | { kind: "revoke"; invitation: InstitutionInvitation }
  | null;

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function OnboardingUsersPage() {
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acceptanceUrl, setAcceptanceUrl] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [context, roles, invitations] = await Promise.all([
      institutionsApi.getCurrentInstitution(),
      institutionsApi.listInstitutionRoles(),
      institutionsApi.listInstitutionInvitations(),
    ]);
    return { context, roles: roles.results.filter((role) => role.is_active && !EXCLUDED_ROLE_CODES.has(role.code)), invitations: invitations.results };
  }, []);
  const { data, loading, error, reload } = useApiResource(load);
  const selectedRole = useMemo(() => data?.roles.find((role) => role.id === roleId) ?? null, [data, roleId]);

  const confirm = async () => {
    if (!pendingAction) return;
    setWorking(true);
    setActionError(null);
    try {
      if (pendingAction.kind === "create") {
        const result = await institutionsApi.createInstitutionInvitation({ email: email.trim(), role_id: roleId });
        setAcceptanceUrl(`${window.location.origin}/accept-invitation/${result.acceptance_token}`);
        setEmail("");
        setRoleId("");
      } else if (pendingAction.kind === "resend") {
        const result = await institutionsApi.resendInstitutionInvitation(pendingAction.invitation.id);
        setAcceptanceUrl(`${window.location.origin}/accept-invitation/${result.acceptance_token}`);
      } else {
        await institutionsApi.revokeInstitutionInvitation(pendingAction.invitation.id);
      }
      setPendingAction(null);
      reload();
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
      setPendingAction(null);
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "You may not have permission to manage setup invitations."} onRetry={reload} />;

  const owner = data.context.membership.user;
  const actionCopy = pendingAction?.kind === "create"
    ? { title: `Create invitation for ${email.trim()}?`, description: `Role: ${selectedRole?.name ?? "Not selected"}. Institution: ${data.context.institution.name}. A secure invitation link is created only after you confirm.`, label: "Create invitation", destructive: false }
    : pendingAction?.kind === "resend"
      ? { title: `Reissue invitation for ${pendingAction.invitation.email}?`, description: "The current pending invitation will be revoked and replaced with a new secure link.", label: "Reissue invitation", destructive: false }
      : pendingAction?.kind === "revoke"
        ? { title: `Revoke invitation for ${pendingAction.invitation.email}?`, description: "The current secure link will stop working. This does not change any active membership.", label: "Revoke invitation", destructive: true }
        : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/onboarding" className="inline-flex items-center gap-2 text-sm font-semibold text-ink-muted transition hover:text-ink-strong"><ArrowLeft className="h-4 w-4" />Back to setup</Link>
      <PageHeader eyebrow="Setup owners" title="Invite your implementation team" description="During onboarding, active members remain read-only. Full access management moves to Settings after setup." icon={UserRoundCheck} accent="brand" />

      <section className="rounded-2xl border border-line bg-surface p-5"><div className="flex items-start gap-3"><div className="rounded-xl bg-primary-soft p-3 text-primary-ink"><UserRoundCheck className="h-5 w-5" /></div><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-ink">Current institution admin</p><h2 className="mt-1 font-bold text-headline">{[owner?.first_name, owner?.last_name].filter(Boolean).join(" ") || owner?.email || "Setup owner"}</h2><p className="mt-1 text-sm text-ink-muted">{owner?.email ?? "Your active institution membership"} · {data.context.membership.role?.name ?? "Institution Admin"}</p></div></div></section>

      <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-primary-ink" /><div><h2 className="text-card-title font-bold text-headline">Add a setup owner</h2><p className="mt-1 text-sm text-ink-muted">Invitations create no active membership until accepted. Email delivery is not configured in this environment, so ErgonX will provide a secure link to share through an approved channel.</p></div></div><div className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_auto]"><label className="sr-only" htmlFor="invite-email">Email address</label><input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="owner@example.com" className="h-11 rounded-xl border border-line-strong px-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/15" /><label className="sr-only" htmlFor="invite-role">Initial role</label><select id="invite-role" value={roleId} onChange={(event) => setRoleId(event.target.value)} className="h-11 rounded-xl border border-line-strong px-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"><option value="">Select initial role</option>{data.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select><button type="button" disabled={!email.trim() || !roleId} onClick={() => setPendingAction({ kind: "create" })} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"><MailPlus className="h-4 w-4" />Review invitation</button></div>{selectedRole && <p className="mt-3 text-sm text-ink-muted"><span className="font-semibold text-ink">{selectedRole.name}:</span> {selectedRole.description || "Role permissions are managed in Settings after onboarding."}</p>}</section>

      {actionError && <ErrorState title="Invitation action failed" message={actionError} onRetry={reload} />}
      {acceptanceUrl && <section className="rounded-2xl border border-success/25 bg-success-soft p-5"><h2 className="font-semibold text-success-ink">Invitation created successfully</h2><p className="mt-1 text-sm text-success-ink">Copy the one-time secure link and share it through an approved channel. It is not stored in the interface after you leave this screen.</p><div className="mt-4 flex gap-2"><input aria-label="Secure invitation link" readOnly value={acceptanceUrl} className="h-9 min-w-0 flex-1 rounded-lg border border-success/25 bg-surface px-3 text-sm" /><button type="button" onClick={() => void navigator.clipboard.writeText(acceptanceUrl)} className={buttonClasses({ variant: "primary" })}><Copy className="h-4 w-4" />Copy</button></div></section>}

      <section className="overflow-hidden rounded-2xl border border-line bg-surface"><div className="border-b border-line-soft px-5 py-4"><h2 className="text-card-title font-bold text-headline">Invitation status</h2><p className="mt-1 text-sm text-ink-muted">Pending invitations can be reissued or revoked. Active member access is intentionally not editable here.</p></div>{data.invitations.length === 0 ? <EmptyState title="No invitations yet" description="Setup-owner invitations will appear here after creation." /> : <div className="divide-y divide-line-soft">{data.invitations.map((invitation) => <div key={invitation.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="font-medium text-ink-strong">{invitation.email}</p><p className="mt-1 text-sm text-ink-muted">{invitation.role?.name ?? "No role"} · Expires {formatDate(invitation.expires_at)}</p></div><StatusBadge status={invitation.status} /><div className="flex gap-2">{invitation.status === "PENDING" && <><button type="button" onClick={() => setPendingAction({ kind: "resend", invitation })} className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink"><RefreshCw className="h-3.5 w-3.5" />Reissue</button><button type="button" onClick={() => setPendingAction({ kind: "revoke", invitation })} className="inline-flex items-center gap-1.5 rounded-lg border border-danger/25 px-3 py-2 text-sm font-medium text-danger-ink"><XCircle className="h-3.5 w-3.5" />Revoke</button></>}</div></div>)}</div>}</section>
      {actionCopy && <ConfirmDialog open title={actionCopy.title} description={actionCopy.description} confirmLabel={actionCopy.label} destructive={actionCopy.destructive} loading={working} onConfirm={() => void confirm()} onCancel={() => setPendingAction(null)} />}
    </div>
  );
}
