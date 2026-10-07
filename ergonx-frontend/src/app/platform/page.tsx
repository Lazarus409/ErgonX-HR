"use client";

import Link from "next/link";
import { ArrowUpRight, Ban, Check, Clock3, Copy, Inbox, MailPlus, RotateCw, UsersRound } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/guards/AuthProvider";
import AccessRequestsCard from "@/components/platform/AccessRequestsCard";
import { formatDateTime } from "@/components/platform/format";
import { PlatformCard, PlatformHero, SectionTitle, StatTile, platformFieldLabel as fieldLabel, platformSolid, platformTable } from "@/components/platform/ui";
import Alert from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { DataTable, DataToolbar } from "@/components/ui/DataTable";
import ErrorState from "@/components/ui/ErrorState";
import { Field, Input, Select } from "@/components/ui/Field";
import LoadingState from "@/components/ui/LoadingState";
import { Dialog } from "@/components/ui/Overlay";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { authApi, getApiErrorMessage } from "@/lib/api";
import type { PlatformInstitutionAdminInvitation } from "@/lib/api/auth";
import { useApiResource } from "@/lib/useApiResource";

type Invitation = PlatformInstitutionAdminInvitation;
type StatusFilter = "ALL" | Invitation["status"];
type IssuedLink = { email: string; url: string; delivery: "SENT" | "FAILED" | "MANUAL_DELIVERY_REQUIRED" };

const statusTone: Record<Invitation["status"], BadgeTone> = {
  ACCEPTED: "success",
  PENDING: "warning",
  EXPIRED: "neutral",
  REVOKED: "danger",
};

const validityOptions = (
  <>
    <option value="24">24 hours</option>
    <option value="72">3 days</option>
    <option value="168">7 days</option>
    <option value="336">14 days</option>
  </>
);

const bigControl = "h-12 rounded-xl bg-surface-muted";

function IssuedLinkNotice({ issued, onDismiss }: { issued: IssuedLink; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const message = issued.delivery === "SENT"
    ? `Invitation emailed to ${issued.email}. Keep this link only as a secure recovery option.`
    : issued.delivery === "FAILED"
      ? "Email delivery failed. Copy and send this secure link through an approved channel."
      : "Email delivery is not configured yet. Copy and send this secure link through an approved channel.";
  return (
    <div className="mt-6 rounded-2xl border border-success/30 bg-success-soft p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-full bg-success p-1 text-white" aria-hidden="true"><Check className="h-3.5 w-3.5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-success-ink">Secure setup link created</p>
          <p className="mt-1 text-xs text-success-ink">{message} It is shown only once.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input readOnly value={issued.url} aria-label="Secure setup link" className="h-11 min-w-0 flex-1 rounded-xl border border-success/30 bg-surface px-3 text-xs text-ink" />
            <button type="button" onClick={() => { void navigator.clipboard.writeText(issued.url).then(() => setCopied(true)); }} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-success/40 bg-surface px-4 text-sm font-semibold text-success-ink transition hover:bg-success-soft">
              {copied ? <><Check className="h-4 w-4" />Copied</> : <><Copy className="h-4 w-4" />Copy link</>}
            </button>
            <button type="button" onClick={onDismiss} className="inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold text-success-ink hover:underline">Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Super Admin home: invite organizations, review requests and manage every setup link. */
export default function PlatformInvitationsPage() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [hours, setHours] = useState("168");
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const [reissuing, setReissuing] = useState<Invitation | null>(null);
  const [reissueHours, setReissueHours] = useState("168");
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(() => authApi.listInstitutionAdminInvitations(), []);
  const { data, loading, error, reload } = useApiResource(load);
  const loadRequests = useCallback(() => authApi.listInstitutionAccessRequests(), []);
  const { data: requests, loading: loadingRequests, error: requestsError, reload: reloadRequests } = useApiResource(loadRequests);

  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = { ALL: 0, PENDING: 0, ACCEPTED: 0, EXPIRED: 0, REVOKED: 0 };
    for (const invitation of data ?? []) {
      result.ALL += 1;
      result[invitation.status] += 1;
    }
    return result;
  }, [data]);
  const pendingRequests = requests?.filter((item) => item.status === "PENDING").length ?? 0;

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data ?? []).filter((invitation) =>
      (status === "ALL" || invitation.status === status)
      && (!term || invitation.email.toLowerCase().includes(term) || (invitation.institution_name ?? "").toLowerCase().includes(term)),
    );
  }, [data, search, status]);

  const showLink = (link: { email: string; acceptance_token: string; email_delivery_status: IssuedLink["delivery"] }) => {
    setIssued({ email: link.email, url: `${window.location.origin}/create-organization/${link.acceptance_token}`, delivery: link.email_delivery_status });
  };

  const createInvitation = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setActionError(null);
    setIssued(null);
    try {
      const invitation = await authApi.createInstitutionAdminInvitation({ email: email.trim(), expires_in_hours: Number(hours) });
      showLink(invitation);
      setEmail("");
      reload();
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    setRowError(null);
    try {
      await authApi.revokeInstitutionAdminInvitation(revoking.id);
      reload();
    } catch (caught) {
      setRowError(getApiErrorMessage(caught));
    } finally {
      setBusy(false);
      setRevoking(null);
    }
  };

  const reissue = async () => {
    if (!reissuing) return;
    setBusy(true);
    setRowError(null);
    try {
      const result = await authApi.reissueInstitutionAdminInvitation(reissuing.id, Number(reissueHours));
      showLink(result.invitation);
      reload();
      reloadRequests();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      setRowError(getApiErrorMessage(caught));
    } finally {
      setBusy(false);
      setReissuing(null);
    }
  };

  // Full loading state only on first load: a reload after an action must not wipe the one-time link.
  if ((loading && !data) || (loadingRequests && !requests)) return <LoadingState />;

  const requestsSection = requestsError || !requests
    ? <ErrorState message={requestsError ?? "Could not load access requests."} onRetry={reloadRequests} />
    : <AccessRequestsCard requests={requests} onChanged={() => { reloadRequests(); reload(); }} />;

  return (
    <>
      <PlatformHero title={`Good to see you, ${user?.firstName || "Super"}.`} subtitle="Manage organizations and their administrator access from one place." />

      <section className="grid gap-4 sm:grid-cols-2 lg:max-w-4xl lg:grid-cols-4" aria-label="Invitation summary">
        <StatTile label="Requests awaiting review" value={pendingRequests} icon={Inbox} tone="violet" />
        <StatTile label="Total invitations" value={counts.ALL} icon={UsersRound} tone="sky" />
        <StatTile label="Awaiting activation" value={counts.PENDING} icon={Clock3} tone="amber" />
        <StatTile label="Organizations started" value={counts.ACCEPTED} icon={Check} tone="emerald" />
      </section>

      {pendingRequests > 0 && requestsSection}

      <PlatformCard eyebrow="New organization" title="Invite an Institution Admin" description="The recipient creates their organization and becomes its primary administrator through a single-use secure link." icon={MailPlus}>
        {actionError && <Alert tone="danger" title="Invitation could not be created" className="mb-5">{actionError}<p className="mt-1 text-caption">Use an email address that does not already have an ErgonX account.</p></Alert>}
        <form onSubmit={createInvitation} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_11.5rem_auto] md:items-end">
          <label className="block"><span className={fieldLabel}>Administrator work email</span><Input required type="email" size="lg" className={bigControl} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="administrator@organization.com" /></label>
          <label className="block"><span className={fieldLabel}>Link validity</span><Select size="lg" className={bigControl} value={hours} onChange={(event) => setHours(event.target.value)}>{validityOptions}</Select></label>
          <button type="submit" disabled={creating} className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold shadow-lg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${platformSolid}`}>
            {creating ? "Creating…" : <>Create invite <ArrowUpRight className="h-4 w-4" /></>}
          </button>
        </form>
        {issued && <IssuedLinkNotice issued={issued} onDismiss={() => setIssued(null)} />}
      </PlatformCard>

      {rowError && <Alert tone="danger" title="That didn't work">{rowError}</Alert>}

      {error || !data ? (
        <ErrorState message={error ?? "Could not load invitations."} onRetry={reload} />
      ) : (
        <DataTable<Invitation>
          className={platformTable}
          caption="Institution Admin invitations"
          rows={rows}
          rowKey={(invitation) => invitation.id}
          minWidth={900}
          toolbar={
            <div className="space-y-4">
              <SectionTitle eyebrow="Activity" title="Institution Admin invitations" meta={`${counts.ALL} invitation${counts.ALL === 1 ? "" : "s"} recorded`} />
              {counts.ALL > 0 && (
                <DataToolbar
                  search={search}
                  onSearchChange={setSearch}
                  searchPlaceholder="Search email or organization…"
                  filters={
                    <SegmentedControl<StatusFilter>
                      label="Invitation status"
                      value={status}
                      onChange={setStatus}
                      options={(["ALL", "PENDING", "ACCEPTED", "EXPIRED", "REVOKED"] as const).map((value) => ({ value, label: `${value === "ALL" ? "All" : value.charAt(0) + value.slice(1).toLowerCase()} · ${counts[value]}` }))}
                    />
                  }
                />
              )}
            </div>
          }
          empty={data.length === 0
            ? { title: "No invitations yet", description: "Create the first secure setup link to begin onboarding an organization.", icon: MailPlus }
            : { title: "No matching invitations", description: "Try a different search or status." }}
          columns={[
            { key: "email", header: "Administrator", sortValue: (invitation) => invitation.email, cell: (invitation) => <span className="block min-w-0"><span className="block truncate font-semibold text-ink-strong">{invitation.email}</span><span className="mt-0.5 block text-xs text-ink-muted">Institution Admin</span></span> },
            { key: "status", header: "Status", sortValue: (invitation) => invitation.status, cell: (invitation) => <Badge size="sm" tone={statusTone[invitation.status] ?? "neutral"}>{invitation.status}</Badge> },
            { key: "expires", header: "Expiration", sortValue: (invitation) => invitation.expires_at, cell: (invitation) => <span className="text-ink-muted">{formatDateTime(invitation.expires_at)}</span> },
            { key: "created", header: "Created", hideBelow: "md", sortValue: (invitation) => invitation.created_at, cell: (invitation) => <span className="text-ink-muted">{formatDateTime(invitation.created_at)}</span> },
            {
              key: "by",
              header: "Created by",
              hideBelow: "lg",
              cell: (invitation) => (
                <span className="block text-ink-muted">
                  {invitation.invited_by_email ?? "Platform administrator"}
                  {invitation.institution_id && <Link className="mt-0.5 block text-xs font-semibold text-primary-ink hover:underline" href={`/platform/organizations/${invitation.institution_id}`}>{invitation.institution_name} →</Link>}
                </span>
              ),
            },
            {
              key: "actions",
              header: <span className="sr-only">Actions</span>,
              cell: (invitation) => invitation.status === "ACCEPTED" ? null : (
                <span className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" leadingIcon={<RotateCw className="h-3.5 w-3.5" />} onClick={() => { setReissueHours("168"); setReissuing(invitation); }}>Re-issue</Button>
                  {invitation.status === "PENDING" && <Button size="sm" variant="ghost" leadingIcon={<Ban className="h-3.5 w-3.5" />} onClick={() => setRevoking(invitation)}>Revoke</Button>}
                </span>
              ),
            },
          ]}
        />
      )}

      {pendingRequests === 0 && requestsSection}

      <ConfirmDialog
        open={revoking !== null}
        destructive
        loading={busy}
        title="Revoke this invitation?"
        description={`The setup link sent to ${revoking?.email ?? ""} will stop working immediately. You can issue a new one later.`}
        confirmLabel="Revoke link"
        onConfirm={() => void revoke()}
        onCancel={() => setRevoking(null)}
      />

      <Dialog
        open={reissuing !== null}
        onClose={() => { if (!busy) setReissuing(null); }}
        dismissible={!busy}
        size="sm"
        title="Re-issue invitation"
        description={reissuing ? `A new secure link will be created for ${reissuing.email}.${reissuing.status === "PENDING" ? " The current link will stop working." : ""}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReissuing(null)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void reissue()} loading={busy} loadingLabel="Issuing…">Issue new link</Button>
          </>
        }
      >
        <Field label="Link validity"><Select value={reissueHours} onChange={(event) => setReissueHours(event.target.value)}>{validityOptions}</Select></Field>
      </Dialog>
    </>
  );
}
