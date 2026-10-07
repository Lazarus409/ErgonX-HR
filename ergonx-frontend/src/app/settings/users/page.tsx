"use client";

import { useCallback, useState } from "react";

import { Landmark, Mail, ShieldCheck, UserPlus, UsersRound, X } from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PageHeader from "@/components/ui/PageHeader";
import Tabs from "@/components/ui/Tabs";
import { Avatar } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import StatusBadge from "@/components/ui/StatusBadge";
import { getApiErrorMessage, institutionsApi } from "@/lib/api";
import { useApiResource } from "@/lib/useApiResource";
import type { InstitutionMembership } from "@/types/institutions";
import { buttonClasses } from "@/components/ui/Button";
import { EXCLUDED_ROLE_CODES } from "@/lib/product";

const setupOwnerRoles = [
  { code: "HR_ADMIN", label: "HR Admin", scope: "HR, Leave, Attendance and Recruitment" },
  { code: "FINANCE_MANAGER", label: "Finance Manager", scope: "Payroll and Accounting oversight" },
  { code: "ACCOUNTANT", label: "Accountant", scope: "Accounting operations and finance records" },
  { code: "AUDITOR", label: "Auditor", scope: "Read-only compliance and audit review" },
  { code: "DIRECTOR", label: "Director", scope: "Executive oversight and approvals" },
].filter((role) => !EXCLUDED_ROLE_CODES.has(role.code));

function memberName(firstName: string | undefined, lastName: string | undefined, email: string | undefined): string {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name || email || "Unknown user";
}

export default function MembershipSettingsPage() {
  type InvitationAction = "member" | "link" | "resend" | "revoke";
  const [editing, setEditing] = useState<InstitutionMembership | null>(null);
  const [roleId, setRoleId] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [isPrimary, setIsPrimary] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState("");
  const [inviting, setInviting] = useState(false);
  const [acceptanceUrl, setAcceptanceUrl] = useState<string | null>(null);
  const [invitationAction, setInvitationAction] = useState<InvitationAction | null>(null);
  const [pendingInvitationId, setPendingInvitationId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"members" | "invitations">("members");
  const [inviteOpen, setInviteOpen] = useState(false);
  const load = useCallback(async () => {
    const [memberships, roles, invitations] = await Promise.all([
      institutionsApi.listInstitutionMemberships(),
      institutionsApi.listInstitutionRoles(),
      institutionsApi.listInstitutionInvitations(),
    ]);
    return { memberships, roles: roles.results.filter((role) => role.is_active && !EXCLUDED_ROLE_CODES.has(role.code)), invitations };
  }, []);
  const { data, loading, error, reload } = useApiResource(load);

  if (loading) return <LoadingState />;
  if (error || !data) {
    return <ErrorState message={error ?? "You may not have permission to review institution memberships."} onRetry={reload} />;
  }

  const openEdit = (membership: InstitutionMembership) => { setEditing(membership); setRoleId(membership.role?.id ?? ""); setStatus(membership.status); setIsPrimary(membership.is_primary); setActionError(null); };
  const save = async () => {
    if (!editing || !roleId) return;
    setSaving(true); setActionError(null);
    try { await institutionsApi.updateInstitutionMembership(editing.id, { role_id: roleId, status, is_primary: isPrimary }); setConfirming(false); setEditing(null); reload(); } catch (caught) { setActionError(getApiErrorMessage(caught)); setConfirming(false); } finally { setSaving(false); }
  };
  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!inviteEmail.trim() || !inviteRoleId || inviting) { setActionError("Enter an account email and choose a role."); return; }
    setActionError(null); setInvitationAction("member");
  };
  const createLink = async () => {
    if (!inviteEmail.trim() || !inviteRoleId || inviting) { setActionError("Enter an account email and choose a role."); return; }
    setActionError(null); setInvitationAction("link");
  };
  const confirmInvitationAction = async () => {
    if (!invitationAction || inviting) return;
    setInviting(true); setActionError(null); setActionNotice(null);
    try {
      if (invitationAction === "member") {
        await institutionsApi.inviteInstitutionMember({ email: inviteEmail.trim(), role_id: inviteRoleId });
        setActionNotice("Invitation sent successfully.");
        setInviteEmail(""); setInviteRoleId("");
      } else if (invitationAction === "link") {
        const invitation = await institutionsApi.createInvitationLink({ email: inviteEmail.trim(), role_id: inviteRoleId });
        setAcceptanceUrl(`${window.location.origin}/accept-invitation/${invitation.acceptance_token}`);
        setActionNotice("Invitation link created successfully.");
        setInviteEmail(""); setInviteRoleId("");
      } else if (pendingInvitationId) {
        if (invitationAction === "resend") {
          const result = await institutionsApi.resendInstitutionInvitation(pendingInvitationId);
          setAcceptanceUrl(`${window.location.origin}/accept-invitation/${result.acceptance_token}`);
          setActionNotice("Invitation reissued successfully.");
        } else {
          await institutionsApi.revokeInstitutionInvitation(pendingInvitationId);
          setActionNotice("Invitation revoked successfully.");
        }
      }
      setInvitationAction(null); setPendingInvitationId(null); await reload();
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
      setInvitationAction(null); setPendingInvitationId(null);
    } finally { setInviting(false); }
  };
  const invitationConfirmCopy = invitationAction === "member"
    ? { title: `Invite ${inviteEmail.trim()}?`, description: `Email: ${inviteEmail.trim()} · Role: ${data.roles.find((role) => role.id === inviteRoleId)?.name ?? "Selected role"}`, label: "Send invitation", destructive: false }
    : invitationAction === "link"
      ? { title: `Create an invitation link for ${inviteEmail.trim()}?`, description: `Email: ${inviteEmail.trim()} · Role: ${data.roles.find((role) => role.id === inviteRoleId)?.name ?? "Selected role"}`, label: "Create invitation link", destructive: false }
      : invitationAction === "resend"
        ? { title: "Reissue this invitation?", description: "The current pending invitation will be revoked and replaced with a new secure link.", label: "Reissue invitation", destructive: false }
        : invitationAction === "revoke"
          ? { title: "Revoke this invitation?", description: "The recipient will no longer be able to use the current invitation link.", label: "Revoke invitation", destructive: true }
          : null;

  const invitationCount = data.invitations.results.length;
  const pendingInvitations = data.invitations.results.filter((invitation) => invitation.status === "PENDING").length;

  return (
    <div className="space-y-6">
      <PageHeader title="Users & Access" description="Manage who can access ErgonX and what they can do." />

      <Tabs
        label="Users and access sections"
        value={tab}
        onChange={(value) => setTab(value as "members" | "invitations")}
        items={[
          { value: "members", label: <><UsersRound className="h-[18px] w-[18px]" aria-hidden="true" />Members</>, count: data.memberships.count },
          { value: "invitations", label: <><Mail className="h-[18px] w-[18px]" aria-hidden="true" />Invitations</>, count: pendingInvitations || invitationCount },
        ]}
      />

      <div className="flex items-start gap-4 rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary" aria-hidden="true"><UsersRound className="h-7 w-7" /></span>
        <div className="min-w-0">
          <h2 className="text-card-title font-bold text-headline">Manage your team&apos;s access</h2>
          <p className="mt-0.5 text-support text-heading-support">Invite users, assign roles and manage access for your institution. Permissions come from the role assigned to each membership.</p>
        </div>
      </div>

      {actionNotice && <p role="status" className="rounded-xl border border-success/25 bg-success-soft p-4 text-sm font-medium text-success-ink">{actionNotice}</p>}

      {acceptanceUrl && <div className="rounded-2xl border border-primary/25 bg-primary-soft p-5"><p className="font-medium text-primary-ink">One-time acceptance link</p><p className="mt-1 text-sm text-primary-ink">Copy and send this through an approved channel. It is not shown again after leaving this screen.</p><div className="mt-3 flex gap-2"><input readOnly value={acceptanceUrl} className="h-10 min-w-0 flex-1 rounded-lg border border-primary/25 bg-surface px-3 text-sm" /><button type="button" onClick={() => void navigator.clipboard.writeText(acceptanceUrl)} className={buttonClasses({ variant: "primary" })}>Copy</button></div></div>}

      {tab === "members" && (
        <>
          {inviteOpen && (
            <section className="space-y-5 rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-card-title font-bold text-headline">Invite user</h2>
                  <p className="mt-0.5 text-support text-heading-support">Choose a setup-owner role to preselect it, or pick any role below, then enter the recipient&apos;s email.</p>
                </div>
                <button type="button" onClick={() => setInviteOpen(false)} className="rounded-lg p-2 text-ink-muted hover:bg-surface-hover hover:text-ink-strong" aria-label="Close invite panel"><X className="h-4 w-4" /></button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {setupOwnerRoles.map((owner) => {
                  const role = data.roles.find((item) => item.code === owner.code);
                  return <button key={owner.code} type="button" disabled={!role} onClick={() => { setInviteRoleId(role?.id ?? ""); setActionError(null); }} className={`rounded-xl border p-4 text-left transition ${inviteRoleId === role?.id ? "border-primary bg-primary-soft" : "border-line hover:border-line-strong hover:bg-surface-hover"} disabled:cursor-not-allowed disabled:opacity-50`}><p className="font-semibold text-headline">{owner.label}</p><p className="mt-2 text-xs leading-5 text-ink-muted">{owner.scope}</p></button>;
                })}
              </div>
              <form onSubmit={invite} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="Existing account email" aria-label="Account email" className="h-10 rounded-lg border border-line-strong px-3 text-sm" />
                <select value={inviteRoleId} onChange={(event) => setInviteRoleId(event.target.value)} aria-label="Role" className="h-10 rounded-lg border border-line-strong px-3 text-sm"><option value="">Select role</option>{data.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select>
                <div className="flex gap-2"><button disabled={inviting} className={buttonClasses({ variant: "primary" })}>{inviting ? "Inviting…" : "Invite member"}</button><button type="button" disabled={inviting} onClick={() => void createLink()} className={buttonClasses({ variant: "secondary" })}>Create link</button></div>
                {actionError && !editing && <p className="text-sm text-danger-ink md:col-span-3">{actionError}</p>}
                <p className="text-xs text-ink-muted md:col-span-3">Invitations are created for existing ErgonX accounts. Email delivery will be added when the delivery contract is available.</p>
              </form>
            </section>
          )}

          <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-elevation-1">
            <div className="flex flex-col gap-3 border-b border-line-soft px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-card-title font-bold text-headline">Institution members</h2>
                <p className="mt-0.5 text-support text-ink-muted">{data.memberships.count} membership{data.memberships.count === 1 ? "" : "s"} found.</p>
              </div>
              {!inviteOpen && <button type="button" onClick={() => setInviteOpen(true)} className={buttonClasses({ variant: "primary", size: "lg" })}><UserPlus className="h-5 w-5" aria-hidden="true" />Invite user</button>}
            </div>
            {data.memberships.results.length === 0 ? (
              <EmptyState size="compact" title="No memberships found" description="Users with institution access will appear here." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="bg-surface-muted/80 text-left">
                      <th scope="col" className="px-5 py-3 text-caption font-semibold text-ink-strong">Name</th>
                      <th scope="col" className="px-5 py-3 text-caption font-semibold text-ink-strong">Role</th>
                      <th scope="col" className="px-5 py-3 text-caption font-semibold text-ink-strong">Status</th>
                      <th scope="col" className="px-5 py-3 text-caption font-semibold text-ink-strong">Primary institution</th>
                      <th scope="col" className="px-5 py-3 text-right text-caption font-semibold text-ink-strong">Edit access</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {data.memberships.results.map((membership) => {
                      const user = membership.user;
                      const name = memberName(user?.first_name, user?.last_name, user?.email);
                      return (
                        <tr key={membership.id}>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <Avatar name={name} size="md" />
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-headline">{name}</p>
                                <p className="truncate text-caption text-ink-muted">{user?.email ?? "User information unavailable"}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3.5"><p className="text-ink-strong">{membership.role?.name ?? "No role assigned"}</p><p className="text-caption text-ink-muted">{membership.role?.code ?? "—"}</p></td>
                          <td className="px-5 py-3.5"><StatusBadge status={membership.status} /></td>
                          <td className="px-5 py-3.5">{membership.is_primary ? <span className="inline-flex items-center gap-2 text-ink"><Landmark className="h-4 w-4 text-primary" aria-hidden="true" />Primary</span> : <span className="text-ink-subtle">—</span>}</td>
                          <td className="px-5 py-3.5 text-right"><button type="button" onClick={() => openEdit(membership)} className={buttonClasses({ variant: "secondary", size: "sm" })}>Edit access</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {editing && <div className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1"><div className="flex items-start justify-between"><div><h2 className="text-card-title font-bold text-headline">Update access</h2><p className="mt-1 text-sm text-ink-muted">{memberName(editing.user?.first_name, editing.user?.last_name, editing.user?.email)}</p></div><button onClick={() => setEditing(null)} className="text-sm font-medium text-ink-muted">Cancel</button></div><div className="mt-5 grid gap-4 md:grid-cols-3"><label className="text-sm font-medium text-ink">Role<select value={roleId} onChange={(event) => setRoleId(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-line-strong px-3">{data.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><label className="text-sm font-medium text-ink">Status<select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-line-strong px-3"><option value="INVITED">Invited</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="INACTIVE">Inactive</option></select></label><label className="flex items-center gap-2 pt-7 text-sm font-medium text-ink"><input type="checkbox" checked={isPrimary} onChange={(event) => setIsPrimary(event.target.checked)} /> Primary institution</label></div>{actionError && <p className="mt-3 text-sm text-danger-ink">{actionError}</p>}<div className="mt-5 flex justify-end"><button disabled={!roleId} onClick={() => setConfirming(true)} className={buttonClasses({ variant: "primary" })}>Review changes</button></div></div>}
        </>
      )}

      {tab === "invitations" && (
        <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-elevation-1">
          <div className="border-b border-line-soft px-5 py-4"><h2 className="text-card-title font-bold text-headline">Invitation status</h2><p className="mt-0.5 text-support text-ink-muted">Pending invitations show their expiry and can be reissued or revoked. Established member access is managed on the Members tab.</p></div>
          {data.invitations.results.length === 0 ? <EmptyState size="compact" icon={Mail} title="No invitation records" description="Pending invitations will appear here after creation." /> : <div className="divide-y divide-line-soft">{data.invitations.results.map((invitation) => <div key={invitation.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center"><span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary sm:flex" aria-hidden="true"><Mail className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="font-semibold text-headline">{invitation.email}</p><p className="mt-0.5 text-sm text-ink-muted">{invitation.role?.name ?? "No role"} · Expires {new Date(invitation.expires_at).toLocaleString()}</p></div><StatusBadge status={invitation.status} /><div className="flex gap-2">{invitation.status === "PENDING" && <><button type="button" onClick={() => { setPendingInvitationId(invitation.id); setInvitationAction("resend"); }} className={buttonClasses({ variant: "secondary", size: "sm" })}>Reissue</button><button type="button" onClick={() => { setPendingInvitationId(invitation.id); setInvitationAction("revoke"); }} className="h-8 rounded-lg border border-danger/30 px-3 text-support font-semibold text-danger-ink hover:bg-danger-soft">Revoke</button></>}</div></div>)}</div>}
        </section>
      )}

      <div className="flex items-start gap-4 rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary" aria-hidden="true"><ShieldCheck className="h-6 w-6" /></span>
        <div className="min-w-0">
          <h2 className="text-card-title font-bold text-headline">Security and access notes</h2>
          <p className="mt-0.5 text-support text-heading-support">Invitation links are single-use and expire. Access changes are confirmed before they apply, and the final active Institution Admin cannot be removed.</p>
        </div>
      </div>

      <ConfirmDialog open={confirming} title="Update membership access?" description="This will change the member’s role, status, or primary institution selection. The backend prevents removing the final active Institution Admin." confirmLabel="Update access" destructive={status === "SUSPENDED" || status === "INACTIVE"} loading={saving} onConfirm={() => void save()} onCancel={() => setConfirming(false)} />
      {invitationConfirmCopy && <ConfirmDialog open title={invitationConfirmCopy.title} description={invitationConfirmCopy.description} confirmLabel={invitationConfirmCopy.label} destructive={invitationConfirmCopy.destructive} loading={inviting} onConfirm={() => void confirmInvitationAction()} onCancel={() => { setInvitationAction(null); setPendingInvitationId(null); }} />}
    </div>
  );
}
