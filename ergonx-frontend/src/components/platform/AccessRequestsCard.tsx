"use client";

import { Check, Copy, Inbox, MailCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import Alert from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import { SectionTitle, platformTable } from "@/components/platform/ui";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { authApi, getApiErrorMessage, platformApi } from "@/lib/api";
import type { CreatedPlatformInstitutionAdminInvitation, InstitutionAccessRequest } from "@/lib/api/auth";

const statusTone: Record<InstitutionAccessRequest["status"], BadgeTone> = {
  PENDING: "warning",
  INVITED: "success",
  DECLINED: "neutral",
};

const sizeLabel: Record<string, string> = {
  "1-50": "1–50 employees",
  "51-200": "51–200 employees",
  "201-1000": "201–1,000 employees",
  "1000+": "1,000+ employees",
};

type Filter = "PENDING" | "ALL";

function countryName(code: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

/**
 * Organizations that asked for an invitation from the public Get Started page.
 * Approving issues the same Institution Admin invitation as the manual form.
 */
export default function AccessRequestsCard({ requests, onChanged }: { requests: InstitutionAccessRequest[]; onChanged: () => void }) {
  const [filter, setFilter] = useState<Filter>("PENDING");
  const [approving, setApproving] = useState<InstitutionAccessRequest | null>(null);
  const [declining, setDeclining] = useState<InstitutionAccessRequest | null>(null);
  const [hours, setHours] = useState("168");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ institution: string; invitation: CreatedPlatformInstitutionAdminInvitation } | null>(null);
  const [copied, setCopied] = useState(false);

  const pending = useMemo(() => requests.filter((item) => item.status === "PENDING"), [requests]);
  // null until known: whether approving emails the link or leaves it to copy.
  const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    platformApi.getOverview().then((overview) => { if (active) setEmailEnabled(overview.email_delivery_enabled); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const rows = filter === "PENDING" ? pending : requests;

  const close = () => {
    if (busy) return;
    setApproving(null);
    setDeclining(null);
    setDialogError(null);
    setReason("");
  };

  const approve = async () => {
    if (!approving) return;
    setBusy(true);
    setDialogError(null);
    try {
      const result = await authApi.approveInstitutionAccessRequest(approving.id, Number(hours));
      setIssued({ institution: approving.institution_name, invitation: result.invitation });
      setCopied(false);
      setApproving(null);
      onChanged();
    } catch (caught) {
      setDialogError(getApiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (!declining) return;
    setBusy(true);
    setDialogError(null);
    try {
      await authApi.declineInstitutionAccessRequest(declining.id, reason.trim());
      setDeclining(null);
      setReason("");
      onChanged();
    } catch (caught) {
      setDialogError(getApiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const acceptanceUrl = issued ? `${typeof window === "undefined" ? "" : window.location.origin}/create-organization/${issued.invitation.acceptance_token}` : null;
  const deliveryStatus = issued?.invitation.email_delivery_status;

  return (
    <>
      {issued && acceptanceUrl && (
        <Alert tone="success" title={`Invitation issued to ${issued.institution}`}>
          <p>{deliveryStatus === "SENT" ? `Invitation email sent to ${issued.invitation.email}. Keep this link only as a secure recovery option.` : deliveryStatus === "FAILED" ? "Email delivery failed. Copy and send this secure link through an approved channel." : "Email delivery is not configured yet. Copy and send this secure link through an approved channel."}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={acceptanceUrl} aria-label="Secure setup link" className="font-mono text-caption" />
            <Button variant="secondary" onClick={() => { void navigator.clipboard.writeText(acceptanceUrl).then(() => setCopied(true)); }} leadingIcon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}>{copied ? "Copied" : "Copy link"}</Button>
          </div>
        </Alert>
      )}

      <DataTable<InstitutionAccessRequest>
        className={platformTable}
        caption="Organization access requests"
        rows={rows}
        rowKey={(item) => item.id}
        minWidth={880}
        toolbar={
          <SectionTitle
            eyebrow="Get Started"
            title={<span className="flex items-center gap-2">Access requests{pending.length > 0 && <Badge size="sm" tone="warning">{pending.length} pending</Badge>}</span>}
            description="Organizations asking to join from the Get Started page."
            meta={<SegmentedControl<Filter> label="Filter requests" value={filter} onChange={setFilter} options={[{ value: "PENDING", label: "Pending" }, { value: "ALL", label: "All" }]} />}
          />
        }
        empty={{ title: filter === "PENDING" ? "No pending requests" : "No requests yet", description: "Requests submitted from the Get Started page appear here for review.", icon: Inbox }}
        columns={[
          {
            key: "organization",
            header: "Organization",
            sortValue: (item) => item.institution_name,
            cell: (item) => (
              <span className="block max-w-xs">
                <span className="block font-semibold text-ink-strong">{item.institution_name}</span>
                <span className="block text-caption text-ink-muted">{[countryName(item.country_code), sizeLabel[item.organization_size]].filter(Boolean).join(" · ")}</span>
                {item.message && <span className="mt-1 line-clamp-2 block text-caption text-ink-muted" title={item.message}>“{item.message}”</span>}
              </span>
            ),
          },
          {
            key: "contact",
            header: "Contact",
            sortValue: (item) => item.contact_name,
            cell: (item) => (
              <span className="flex items-center gap-3">
                <Avatar name={item.contact_name} size="sm" />
                <span className="min-w-0">
                  <span className="block font-semibold text-ink-strong">{item.contact_name}{item.job_title && <span className="font-normal text-ink-muted"> · {item.job_title}</span>}</span>
                  <span className="block text-caption text-ink-muted">{item.email}{item.phone && ` · ${item.phone}`}</span>
                  {item.has_account && item.status === "PENDING" && <span className="block text-caption font-medium text-warning-ink">Already has an ErgonX account</span>}
                </span>
              </span>
            ),
          },
          { key: "received", header: "Received", hideBelow: "lg", sortValue: (item) => item.created_at, cell: (item) => formatDate(item.created_at) },
          {
            key: "status",
            header: "Status",
            cell: (item) => (
              <span title={item.decline_reason || undefined}>
                <Badge size="sm" tone={statusTone[item.status]}>{item.status.charAt(0) + item.status.slice(1).toLowerCase()}</Badge>
                {item.reviewed_by_email && <span className="mt-1 block text-caption text-ink-muted">by {item.reviewed_by_email}</span>}
              </span>
            ),
          },
          {
            key: "actions",
            header: <span className="sr-only">Actions</span>,
            cell: (item) => item.status === "PENDING" ? (
              <span className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" leadingIcon={<X className="h-4 w-4" />} onClick={() => { setDialogError(null); setDeclining(item); }}>Decline</Button>
                <Button size="sm" leadingIcon={<MailCheck className="h-4 w-4" />} disabled={item.has_account} onClick={() => { setDialogError(null); setApproving(item); }}>Approve</Button>
              </span>
            ) : null,
          },
        ]}
      />

      <Dialog
        open={approving !== null}
        onClose={close}
        dismissible={!busy}
        size="sm"
        title="Approve and send invitation"
        description={approving ? `${approving.email} will receive a single-use link to set up ${approving.institution_name} and become its Institution Admin.` : ""}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
            <Button onClick={() => void approve()} loading={busy} loadingLabel={emailEnabled === false ? "Approving…" : "Sending…"} data-autofocus>{emailEnabled === false ? "Approve and get link" : "Send invitation"}</Button>
          </>
        }
      >
        {dialogError && <Alert tone="danger" title="Could not approve" className="mb-4">{dialogError}</Alert>}
        {emailEnabled === false && <Alert tone="warning" title="Email is not set up on this server" className="mb-4">The invitation will not be emailed. After approving you get the setup link to copy and send to {approving?.email ?? "the requester"} yourself.</Alert>}
        <Field label="Link validity">
          <Select value={hours} onChange={(event) => setHours(event.target.value)}>
            <option value="24">24 hours</option>
            <option value="72">3 days</option>
            <option value="168">7 days</option>
            <option value="336">14 days</option>
          </Select>
        </Field>
      </Dialog>

      <Dialog
        open={declining !== null}
        onClose={close}
        dismissible={!busy}
        size="sm"
        title="Decline request"
        description={declining ? `Decline the request from ${declining.institution_name}? No invitation will be sent.` : ""}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={() => void decline()} loading={busy} loadingLabel="Declining…">Decline request</Button>
          </>
        }
      >
        {dialogError && <Alert tone="danger" title="Could not decline" className="mb-4">{dialogError}</Alert>}
        <Field label="Reason" optional helper="Kept on the request for your records.">
          <Textarea rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}
