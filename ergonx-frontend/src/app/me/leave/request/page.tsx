"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, Check, Clock3, FileText, Info, Paperclip, Plane, Route } from "lucide-react";
import Link from "next/link";

import { Button, buttonClasses } from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import PageHeader from "@/components/ui/PageHeader";
import { employeesApi, getApiErrorMessage, leaveApi, operationsApi } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { Employee } from "@/types/hr";
import type { LeaveBalance, LeaveType } from "@/types/leave";
import type { DocumentRecord } from "@/types/operations";

const MAX_REASON = 500;
const fieldClass = "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong outline-none focus:border-primary";

/** Request leave (Stitch S048): details form with balance, summary, policy notes and approval route. */
export default function RequestLeavePage() {
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [leaveType, setLeaveType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [attachment, setAttachment] = useState<DocumentRecord | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<"submit" | "draft" | null>(null);
  const [done, setDone] = useState<"submitted" | "draft" | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setReferenceLoading(true);
      try {
        const [types, linked] = await Promise.all([
          leaveApi.listLeaveTypes({ page_size: MAX_PAGE_SIZE, ordering: "name" }).then((page) => page.results.filter((type) => type.is_active)).catch(() => [] as LeaveType[]),
          employeesApi.getCurrentEmployee(),
        ]);
        const own = linked ? await leaveApi.listLeaveBalances({ employee: linked.id, year: new Date().getFullYear(), page_size: MAX_PAGE_SIZE }).then((page) => page.results).catch(() => [] as LeaveBalance[]) : [];
        if (!active) return;
        setLeaveTypes(types); setEmployee(linked); setBalances(own); setLeaveType(types[0]?.id ?? "");
      } finally {
        if (active) setReferenceLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  /** Calendar-day span. The backend validates it against the leave policy. */
  const days = (() => {
    if (!startDate || !endDate) return 0;
    const difference = new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime();
    return difference < 0 ? 0 : Math.floor(difference / 86_400_000) + 1;
  })();
  const selectedType = leaveTypes.find((type) => type.id === leaveType);
  const balance = balances.find((row) => row.leave_type === leaveType);

  const save = useCallback(async (submit: boolean) => {
    setError("");
    if (!employee) { setError("Your account is not linked to an employee record, so leave cannot be requested."); return; }
    if (!leaveType || !startDate || !endDate) { setError("Choose a leave type and both dates."); return; }
    if (days <= 0) { setError("The end date must be on or after the start date."); return; }
    if (submit && selectedType?.requires_attachment && !attachment) { setError("A supporting document is required for this leave type."); return; }
    setSaving(submit ? "submit" : "draft");
    try {
      // Creating leaves the request in DRAFT; submitting moves it into the approval workflow.
      const created = await leaveApi.createLeaveRequest({ employee: employee.id, leave_type: leaveType, start_date: startDate, end_date: endDate, requested_days: days, reason, attachment: attachment?.id ?? null });
      if (submit) await leaveApi.submitLeaveRequest(created.id);
      setDone(submit ? "submitted" : "draft");
    } catch (caught) {
      // Policy eligibility, balance and the cross-year rule are enforced by the backend.
      setError(getApiErrorMessage(caught));
    } finally {
      setSaving(null);
    }
  }, [employee, leaveType, startDate, endDate, days, reason, attachment, selectedType]);

  const selectAttachment = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    if (file.size > operationsApi.MAX_DOCUMENT_BYTES) { setError("Supporting documents must be 25 MB or smaller."); return; }
    setUploading(true); setUploadProgress(0);
    try { setAttachment(await operationsApi.uploadDocument(file, { category: "LEAVE_SUPPORTING", classification: "CONFIDENTIAL" }, setUploadProgress)); }
    catch (caught) { setError(getApiErrorMessage(caught)); }
    finally { setUploading(false); }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title={done === "submitted" ? "Leave request submitted" : "Draft saved"} description={done === "submitted" ? "Your request is with your approver." : "Your draft is saved; submit it from My leave when you are ready."} />
        <div className="rounded-xl border border-success/25 bg-success-soft p-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-success text-white" aria-hidden="true"><Check className="h-5 w-5" /></span>
          <p className="mt-4 text-sm text-success-ink">{done === "submitted" ? "You can follow its status on My leave." : "Drafts are not sent for approval."}</p>
          <Link href="/me/leave" className={buttonClasses({ variant: "primary", className: "mt-5" })}>View my leave</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Request leave" description="Submit a leave request for approval." actions={<Link href="/me/leave" className={buttonClasses({ variant: "secondary" })}><ArrowLeft size={16} />Back to my leave</Link>} />
      {!referenceLoading && !employee && <EmptyState title="No employee record linked" description="Your account is not linked to an employee record in this institution, so a leave request cannot be raised for you." />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="space-y-5 rounded-xl border border-line bg-surface p-6 shadow-elevation-1" aria-labelledby="leave-details">
          <div className="flex items-baseline justify-between"><h2 id="leave-details" className="text-section-title font-semibold text-ink-strong">Leave details</h2><span className="text-caption font-semibold uppercase tracking-[0.08em] text-ink-muted">Step 1 of 1</span></div>
          {error && <ErrorState variant="inline" title="Request not saved" message={error} />}
          <label className="block text-sm font-semibold text-ink-strong">Leave type <span className="text-danger">*</span>
            <select value={leaveType} onChange={(event) => setLeaveType(event.target.value)} disabled={referenceLoading || leaveTypes.length === 0} className={`mt-1.5 ${fieldClass}`}>
              {referenceLoading && <option value="">Loading…</option>}
              {!referenceLoading && leaveTypes.length === 0 && <option value="">No leave types configured</option>}
              {leaveTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-ink-strong">Start date <span className="text-danger">*</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={`mt-1.5 ${fieldClass}`} /></label>
            <label className="block text-sm font-semibold text-ink-strong">End date <span className="text-danger">*</span><input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} className={`mt-1.5 ${fieldClass}`} /></label>
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-surface-muted p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary-ink" aria-hidden="true"><CalendarDays className="h-5 w-5" /></span>
            <div><p className="text-caption font-semibold uppercase tracking-[0.08em] text-ink-muted">Total leave duration</p><p className="text-heading font-bold text-ink-strong">{days} day{days === 1 ? "" : "s"} <span className="text-support font-normal text-ink-muted">(calendar days; the policy confirms working days)</span></p></div>
          </div>
          <label className="block text-sm font-semibold text-ink-strong">
            <span className="flex justify-between">Reason<span className="font-mono text-caption font-normal text-ink-muted">{reason.length} / {MAX_REASON}</span></span>
            <textarea value={reason} maxLength={MAX_REASON} onChange={(event) => setReason(event.target.value)} rows={5} placeholder="Enter a reason for your leave request…" className="mt-1.5 w-full resize-none rounded-lg border border-line-strong px-3 py-2.5 text-sm font-normal outline-none focus:border-primary" />
          </label>
          <div>
            <p className="text-sm font-semibold text-ink-strong">Attachment {selectedType?.requires_attachment ? <span className="text-danger">*</span> : <span className="font-normal text-ink-muted">(optional)</span>}</p>
            {attachment ? (
              <div className="mt-1.5 flex items-center justify-between gap-3 rounded-lg border border-success/25 bg-success-soft px-3 py-2.5 text-sm"><span className="min-w-0 truncate text-success-ink">{attachment.original_filename}</span><button type="button" onClick={() => setAttachment(null)} className="shrink-0 font-medium text-success-ink underline">Remove</button></div>
            ) : (
              <label className="mt-1.5 flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface-muted/50 px-4 py-6 text-center hover:bg-surface-muted">
                <Paperclip className="h-5 w-5 text-primary" aria-hidden="true" />
                <span className="text-sm"><span className="font-semibold text-primary-ink">Choose a file</span> to upload</span>
                <span className="text-caption text-ink-muted">Any file type, up to 25 MB, stored in your institution&apos;s protected document area.</span>
                <input type="file" className="sr-only" disabled={uploading} onChange={(event) => void selectAttachment(event.target.files?.[0])} />
              </label>
            )}
            {uploading && <div className="mt-2" aria-live="polite"><div className="h-2 overflow-hidden rounded-full bg-surface-sunken"><div className="h-full bg-primary transition-all" style={{ width: `${uploadProgress}%` }} /></div><p className="mt-1 text-xs text-ink-muted">Uploading… {uploadProgress}%</p></div>}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line-soft pt-5">
            <Button loading={saving === "submit"} loadingLabel="Submitting…" disabled={saving !== null || referenceLoading || !employee} onClick={() => void save(true)}>Submit request</Button>
            <Button variant="secondary" loading={saving === "draft"} loadingLabel="Saving…" disabled={saving !== null || referenceLoading || !employee} onClick={() => void save(false)}>Save draft</Button>
            <Link href="/me/leave" className={buttonClasses({ variant: "ghost" })}>Cancel</Link>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1">
            <div className="flex items-center justify-between"><h2 className="text-card-title font-semibold text-ink-strong">Your leave balance</h2><Link href="/me/leave" className="text-caption font-semibold text-primary-ink hover:underline">View all balances</Link></div>
            <div className="mt-3 flex items-center gap-3 rounded-lg bg-surface-muted p-4">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-soft text-primary-ink" aria-hidden="true"><Plane className="h-5 w-5" /></span>
              <div><p className="text-caption font-semibold uppercase tracking-[0.08em] text-ink-muted">{selectedType?.name ?? "Leave"}</p><p className="text-heading font-bold text-ink-strong">{balance ? `${formatNumber(balance.available)} days` : "No balance yet"}</p></div>
            </div>
          </section>
          <section className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1">
            <h2 className="text-card-title font-semibold text-ink-strong">Leave selection summary</h2>
            <dl className="mt-3 space-y-2.5 text-support">
              <div className="flex justify-between gap-3"><dt className="inline-flex items-center gap-2 text-ink-muted"><CalendarDays className="h-4 w-4" aria-hidden="true" />Period</dt><dd className="text-right text-ink-strong">{startDate && endDate ? `${formatDate(startDate)} – ${formatDate(endDate)}` : "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="inline-flex items-center gap-2 text-ink-muted"><Clock3 className="h-4 w-4" aria-hidden="true" />Duration</dt><dd className="text-ink-strong">{days ? `${days} day${days === 1 ? "" : "s"}` : "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="inline-flex items-center gap-2 text-ink-muted"><Plane className="h-4 w-4" aria-hidden="true" />Leave type</dt><dd className="text-ink-strong">{selectedType?.name ?? "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="inline-flex items-center gap-2 text-ink-muted"><FileText className="h-4 w-4" aria-hidden="true" />Reason</dt><dd className="max-w-[60%] truncate text-ink-strong">{reason || "—"}</dd></div>
            </dl>
          </section>
          <section className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1">
            <h2 className="flex items-center gap-2 text-card-title font-semibold text-ink-strong"><Info className="h-5 w-5 text-primary" aria-hidden="true" />Policy notes</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-support text-ink-muted">
              {selectedType?.requires_approval !== false ? <li>This leave type needs approval before it is confirmed.</li> : <li>This leave type is approved automatically when submitted.</li>}
              {selectedType?.requires_attachment && <li>A supporting document is required.</li>}
              <li>{selectedType?.is_paid === false ? "This leave type is unpaid." : "This leave type is paid."}</li>
              <li>Your balance is updated when the request is approved. Eligibility and limits are checked by your leave policy on submission.</li>
            </ul>
          </section>
          <section className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1">
            <h2 className="flex items-center gap-2 text-card-title font-semibold text-ink-strong"><Route className="h-5 w-5 text-primary" aria-hidden="true" />Approval route</h2>
            <p className="mt-2 text-support text-ink-muted">Approvers are assigned when you submit: your institution&apos;s leave workflow if one is configured, otherwise your department head or line manager, then HR. You are never your own approver.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
