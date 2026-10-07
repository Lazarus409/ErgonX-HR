"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  History,
  MessageSquare,
  Paperclip,
  Pencil,
  Send,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import StatusBadge from "@/components/ui/StatusBadge";
import { Avatar } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Menu, MenuItem } from "@/components/ui/Overlay";
import { attendanceApi, getApiErrorMessage, operationsApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { EM_DASH, formatDateTime, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";

type Decision = "approve" | "reject" | "changes" | null;

function hm(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return EM_DASH;
  const sign = minutes < 0 ? "-" : "";
  const value = Math.abs(minutes);
  return `${sign}${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`;
}

function windowLabel(window: { start: string | null; end: string | null } | null | undefined) {
  if (!window || !window.start) return "No time recorded";
  return `${window.start} – ${window.end ?? "no clock-out"}`;
}

function localTime(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Concept "Attendance adjustment review" (option 3). Rendered for reviewers
 * under /attendance and for the requesting employee under /me/attendance.
 */
export default function AdjustmentReview({ id, backHref, backLabel, linkBase }: { id: string; backHref: string; backLabel: string; linkBase: string }) {
  const load = useCallback(async () => {
    const adjustment = await attendanceApi.getAttendanceAdjustment(id);
    const [review, evidence] = await Promise.all([
      attendanceApi.getAdjustmentReview(id).catch(() => null),
      adjustment.evidence ? operationsApi.getDocument(adjustment.evidence).catch(() => null) : Promise.resolve(null),
    ]);
    return { adjustment, review, evidence };
  }, [id]);
  const { data, loading, error, reload } = useApiResource(load);

  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<Decision>(null);
  const [running, setRunning] = useState(false);
  const [actionError, setActionError] = useState("");
  const [delegates, setDelegates] = useState<Array<{ id: string; name: string; role: string }> | null>(null);
  const [delegateTarget, setDelegateTarget] = useState<{ id: string; name: string } | null>(null);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ reason: "", check_in: "", check_out: "" });
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  if (loading && !data) {
    return <div className="flex min-h-[50vh] items-center justify-center" role="status"><div className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-primary" /></div>;
  }
  if (error || !data) {
    return (
      <div className="space-y-5">
        <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden="true" />{backLabel}</Link>
        <ErrorState message={error ?? "This adjustment could not be loaded."} onRetry={reload} />
      </div>
    );
  }

  const { adjustment, review, evidence } = data;
  const status = adjustment.status;
  const isPending = status === "PENDING";
  const isReturned = status === "RETURNED";
  const decided = status === "APPROVED" || status === "REJECTED";
  const canDecide = Boolean(review?.can_decide);
  const canDelegate = Boolean(review?.can_delegate);
  const date = review?.attendance_date ?? adjustment.attendance_date ?? "";
  const employeeName = review?.employee_name ?? adjustment.employee_name ?? EM_DASH;
  const proposedNotes = typeof adjustment.proposed_values.notes === "string" ? adjustment.proposed_values.notes : "";

  const run = async () => {
    if (!decision) return;
    setRunning(true);
    setActionError("");
    try {
      if (decision === "approve") await attendanceApi.approveAdjustment(id, note.trim());
      if (decision === "reject") await attendanceApi.rejectAdjustment(id, note.trim());
      if (decision === "changes") await attendanceApi.requestAdjustmentChanges(id, note.trim());
      setDecision(null);
      setNote("");
      reload();
    } catch (caught) {
      setDecision(null);
      setActionError(getApiErrorMessage(caught));
    } finally {
      setRunning(false);
    }
  };

  const delegateNow = async () => {
    if (!delegateTarget) return;
    setRunning(true);
    try {
      await attendanceApi.delegateAdjustment(id, delegateTarget.id, note.trim());
      setDelegateTarget(null);
      setNote("");
      reload();
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
      setDelegateTarget(null);
    } finally {
      setRunning(false);
    }
  };

  const needNote = (next: Decision) => {
    if (!note.trim()) {
      setActionError(next === "reject" ? "Add a note explaining why the adjustment is declined." : "Add a note explaining what needs to change.");
      return;
    }
    setActionError("");
    setDecision(next);
  };

  const startEdit = () => {
    setForm({ reason: adjustment.reason, check_in: localTime(adjustment.proposed_values.check_in), check_out: localTime(adjustment.proposed_values.check_out) });
    setEvidenceId(adjustment.evidence ?? null);
    setEditing(true);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const document = await operationsApi.uploadDocument(file, { category: "ATTENDANCE_EVIDENCE", classification: "CONFIDENTIAL", entity_type: "attendance.AttendanceAdjustment", entity_id: id });
      setEvidenceId(document.id);
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
    } finally {
      setUploading(false);
    }
  };

  const resubmit = async () => {
    setRunning(true);
    setActionError("");
    try {
      const toIso = (time: string) => (time ? new Date(`${date}T${time}:00`).toISOString() : undefined);
      const proposed: Record<string, unknown> = {};
      if (toIso(form.check_in)) proposed.check_in = toIso(form.check_in);
      if (toIso(form.check_out)) proposed.check_out = toIso(form.check_out);
      if (proposedNotes) proposed.notes = proposedNotes;
      await attendanceApi.resubmitAdjustment(id, { reason: form.reason.trim(), proposed_values: proposed, evidence: evidenceId });
      setEditing(false);
      reload();
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
    } finally {
      setRunning(false);
    }
  };

  const downloadEvidence = async () => {
    if (!evidence) return;
    const blob = await operationsApi.downloadDocument(evidence.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = evidence.original_filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden="true" />{backLabel}</Link>
        {review?.queue.total ? (
          <div className="flex items-center gap-4 text-sm font-semibold">
            <span className="text-ink-muted">{review.queue.position ? `${review.queue.position} of ${review.queue.total} pending` : `${review.queue.total} pending`}</span>
            {review.queue.previous_id && <Link href={`${linkBase}/${review.queue.previous_id}`} className="inline-flex items-center gap-1 text-primary-ink hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden="true" />Previous</Link>}
            {review.queue.next_id && <Link href={`${linkBase}/${review.queue.next_id}`} className="inline-flex items-center gap-1 text-primary-ink hover:underline">Next<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>}
          </div>
        ) : null}
      </div>

      {/* Identity strip */}
      <section className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <Avatar name={employeeName} size="lg" className="h-16 w-16 text-heading" />
          <div>
            <h1 className="text-[1.75rem] font-bold leading-tight text-headline">{review?.employee_id ? <Link href={`/hr/employees/${review.employee_id}`} className="hover:underline">{employeeName}</Link> : employeeName}</h1>
            <p className="mt-1 text-support text-ink-muted">{[review?.position, review?.department, review?.employee_number].filter(Boolean).join(" · ") || EM_DASH}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6 lg:divide-x lg:divide-line-soft">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-6 w-6 text-section-icon" aria-hidden="true" />
            <div><p className="text-caption text-ink-muted">Work date</p><p className="font-bold text-ink-strong">{date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : EM_DASH}</p></div>
            <span className="flex gap-1">
              {review?.employee_dates.previous_id ? <Link href={`${linkBase}/${review.employee_dates.previous_id}`} aria-label="Previous adjustment for this employee" className="rounded p-1 text-primary-ink hover:bg-surface-hover"><ChevronLeft className="h-4 w-4" /></Link> : <span className="p-1 text-ink-subtle"><ChevronLeft className="h-4 w-4" /></span>}
              {review?.employee_dates.next_id ? <Link href={`${linkBase}/${review.employee_dates.next_id}`} aria-label="Next adjustment for this employee" className="rounded p-1 text-primary-ink hover:bg-surface-hover"><ChevronRight className="h-4 w-4" /></Link> : <span className="p-1 text-ink-subtle"><ChevronRight className="h-4 w-4" /></span>}
            </span>
          </div>
          <div className="lg:pl-6"><p className="text-caption text-ink-muted">Adjustment ID</p><p className="font-bold tabular-nums text-ink-strong">{review?.reference ?? adjustment.reference ?? EM_DASH}</p></div>
          <div className="lg:pl-6"><StatusBadge status={isPending ? "PENDING_REVIEW" : status} /></div>
        </div>
      </section>

      {actionError && <div role="alert" className="rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger-ink">{actionError}</div>}
      {isReturned && adjustment.decision_note && (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning-ink"><p className="font-semibold">Changes requested{adjustment.approved_by_name ? ` by ${adjustment.approved_by_name}` : ""}</p><p className="mt-0.5">{adjustment.decision_note}</p></div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Section number={1} title="Exception summary" description="Compare scheduled, recorded and requested hours for this date.">
            <div className="grid gap-4 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-center">
              <HoursCell icon={CalendarDays} label="Scheduled" minutes={review?.scheduled?.minutes} window={review?.scheduled?.off_day ? "Off day" : windowLabel(review?.scheduled)} arrow />
              <HoursCell icon={Clock3} label="Recorded" minutes={review?.recorded?.minutes} window={windowLabel(review?.recorded)} arrow />
              <HoursCell icon={FileText} label="Requested" minutes={review?.requested?.minutes} window={windowLabel(review?.requested)} />
              <div className="border-line-soft sm:border-l sm:pl-5">
                <p className="text-support text-ink">Difference<span className="block text-caption text-ink-muted">(requested vs recorded)</span></p>
                <p className={cx("mt-1 text-[1.75rem] font-bold tabular-nums", (review?.difference_minutes ?? 0) >= 0 ? "text-success-ink" : "text-danger-ink")}>{review?.difference_minutes === null || review?.difference_minutes === undefined ? EM_DASH : `${review.difference_minutes >= 0 ? "+" : ""}${hm(review.difference_minutes)}`}</p>
              </div>
            </div>
          </Section>

          <Section number={2} title="Policy and compliance" description="System check against attendance and leave policies.">
            {review ? (
              <>
                <div className={cx("flex items-center gap-4 rounded-xl border px-4 py-3.5", review.compliant ? "border-success/30 bg-success-soft" : "border-warning/30 bg-warning-soft")}>
                  <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white", review.compliant ? "bg-success" : "bg-warning")} aria-hidden="true">{review.compliant ? <Check className="h-6 w-6" /> : <X className="h-6 w-6" />}</span>
                  <div><p className="text-heading font-bold text-ink-strong">{review.compliant ? "Compliant" : "Needs attention"}</p><p className="text-support text-ink">{review.compliant ? "This request complies with attendance policy rules." : "One or more checks need review before a decision."}</p></div>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-3 sm:divide-x sm:divide-line-soft">
                  {review.policy_checks.map((check) => (
                    <div key={check.code} className="sm:pl-4 sm:first:pl-0">
                      <p className="text-support text-ink-muted">{check.label}</p>
                      <p className={cx("mt-1 flex items-center gap-2 text-sm font-semibold", check.status === "pass" ? "text-success-ink" : "text-danger-ink")}>
                        <span className={cx("flex h-5 w-5 items-center justify-center rounded-full text-white", check.status === "pass" ? "bg-success" : "bg-danger")} aria-hidden="true">{check.status === "pass" ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}</span>
                        {check.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            ) : <p className="text-support text-ink-muted">Policy checks are unavailable for your role.</p>}
          </Section>

          <Section number={3} title="Adjustment details">
            <dl className="space-y-2.5">
              <DetailRow label="Adjustment type" value={humanizeEnum(adjustment.adjustment_type ?? "TIME_CORRECTION")} />
              <DetailRow label="Reason" value={adjustment.reason || EM_DASH} />
              <DetailRow label="Hours to add" value={review?.difference_minutes !== null && review?.difference_minutes !== undefined ? hm(Math.max(review.difference_minutes, 0)) : EM_DASH} />
              <DetailRow label="Requested on" value={formatDateTime(adjustment.created_at)} />
              <DetailRow label="Requested by" value={adjustment.requested_by_name ?? EM_DASH} />
              <DetailRow label="Approver" value={adjustment.assigned_to_name ?? (decided ? adjustment.approved_by_name ?? EM_DASH : "Any attendance approver")} />
              <DetailRow label="Notes" value={proposedNotes || EM_DASH} />
            </dl>
          </Section>
        </div>

        <div className="space-y-5">
          <Section number={4} title="Evidence" icon={Paperclip} badge={<span className="rounded-md bg-surface-muted px-2 py-0.5 text-caption font-semibold text-ink-muted">{adjustment.evidence ? "1 file" : "0 files"}</span>}>
            {evidence ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
                <span className="flex min-w-0 items-center gap-3"><FileText className="h-8 w-8 shrink-0 text-ink-subtle" aria-hidden="true" /><span className="min-w-0"><span className="block truncate font-semibold text-ink-strong">{evidence.original_filename}</span><span className="text-caption text-ink-muted">{(evidence.size_bytes / 1024).toFixed(0)} KB · {formatDateTime(evidence.created_at)}</span></span></span>
                <button type="button" onClick={() => void downloadEvidence()} aria-label="Download evidence" className="rounded-lg p-2 text-primary-ink hover:bg-surface-hover"><Download className="h-5 w-5" /></button>
              </div>
            ) : <p className="rounded-xl border border-dashed border-line-strong px-4 py-4 text-center text-support text-ink-muted">No evidence attached.</p>}
          </Section>

          <Section number={5} title="Employee comments" icon={MessageSquare}>
            <p className="whitespace-pre-line text-sm text-ink">{adjustment.reason || EM_DASH}</p>
            <p className="mt-2 text-caption text-ink-muted">{formatDateTime(adjustment.resubmitted_at ?? adjustment.created_at)}</p>
          </Section>

          <Section number={6} title="Review timeline" icon={History}>
            <ol className="relative space-y-4 border-l border-line pl-5">
              <TimelineItem done title="Adjustment submitted" detail={`By ${adjustment.requested_by_name ?? "employee"} · ${formatDateTime(adjustment.created_at)}`} />
              {adjustment.changes_requested_at && <TimelineItem done title="Changes requested" detail={`${adjustment.approved_by_name && isReturned ? `By ${adjustment.approved_by_name} · ` : ""}${formatDateTime(adjustment.changes_requested_at)}`} />}
              {adjustment.resubmitted_at && <TimelineItem done title="Resubmitted" detail={formatDateTime(adjustment.resubmitted_at)} />}
              <TimelineItem done={decided} active={isPending} title="Under review" detail={isPending ? (canDecide ? "Pending your action" : adjustment.assigned_to_name ? `Assigned to ${adjustment.assigned_to_name}` : "Awaiting an attendance approver") : isReturned ? "Waiting for the employee" : "Completed"} />
              <TimelineItem done={decided} title="Decision recorded" detail={decided ? `${humanizeEnum(status)} by ${adjustment.approved_by_name ?? EM_DASH}${adjustment.acted_at ? ` · ${formatDateTime(adjustment.acted_at)}` : ""}${adjustment.decision_note ? ` — ${adjustment.decision_note}` : ""}` : "Will be shown here after a decision is made"} />
            </ol>
          </Section>

          {(canDecide || canDelegate) && (
            <Section number={7} title="Your decision" icon={UserRound} description="Review the information and select an action.">
              <textarea rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a note (required to decline or request changes)" aria-label="Decision note" className="mb-3 w-full rounded-lg border border-line-strong px-3 py-2 text-sm" />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <DecisionButton tone="primary" icon={Check} label="Approve" onClick={() => { setActionError(""); setDecision("approve"); }} disabled={!canDecide} />
                <DecisionButton tone="danger" icon={X} label="Decline" onClick={() => needNote("reject")} disabled={!canDecide} />
                <DecisionButton icon={MessageSquare} label="Request changes" onClick={() => needNote("changes")} disabled={!canDecide} />
                <Menu label="Delegate adjustment" align="end" trigger={(props) => <DecisionButton {...props} icon={Users} label="Delegate" trailing onClick={() => { props.onClick(); if (!delegates) void attendanceApi.listAdjustmentDelegates(id).then(setDelegates).catch(() => setDelegates([])); }} disabled={!canDelegate} />}>
                  {(close) => (
                    <div className="max-h-72 overflow-y-auto p-1.5">
                      {delegates === null ? <p className="px-3 py-2 text-support text-ink-muted">Loading reviewers…</p> : delegates.length === 0 ? <p className="px-3 py-2 text-support text-ink-muted">No other attendance approvers.</p> : delegates.map((candidate) => (
                        <MenuItem key={candidate.id} description={candidate.role} onSelect={() => { close(); setDelegateTarget(candidate); }}>{candidate.name}</MenuItem>
                      ))}
                    </div>
                  )}
                </Menu>
              </div>
            </Section>
          )}

          {isReturned && review?.is_requester && (
            <Section number={7} title="Update and resubmit" icon={Pencil} description="Make the requested changes, then send the adjustment back for review.">
              {editing ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm font-semibold text-ink-strong">Clock-in<input type="time" value={form.check_in} onChange={(event) => setForm((current) => ({ ...current, check_in: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-line-strong px-3 font-normal" /></label>
                    <label className="text-sm font-semibold text-ink-strong">Clock-out<input type="time" value={form.check_out} onChange={(event) => setForm((current) => ({ ...current, check_out: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-line-strong px-3 font-normal" /></label>
                  </div>
                  <label className="block text-sm font-semibold text-ink-strong">Reason<textarea rows={3} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 font-normal" /></label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-primary-ink"><Upload className="h-4 w-4" aria-hidden="true" />{uploading ? "Uploading…" : evidenceId ? "Replace evidence" : "Attach evidence"}<input type="file" className="sr-only" disabled={uploading} onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
                  <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button><Button loading={running} loadingLabel="Sending…" leadingIcon={<Send className="h-4 w-4" />} onClick={() => void resubmit()}>Resubmit</Button></div>
                </div>
              ) : <Button leadingIcon={<Pencil className="h-4 w-4" />} onClick={startEdit}>Edit adjustment</Button>}
            </Section>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={decision !== null}
        title={{ approve: "Approve adjustment?", reject: "Decline adjustment?", changes: "Request changes?" }[decision ?? "approve"]}
        description={{
          approve: "The requested times are applied to the attendance record and worked, late and overtime minutes are recalculated.",
          reject: "The attendance record stays as recorded and your note is kept with the decision.",
          changes: "The adjustment returns to the employee with your note so they can update and resubmit it.",
        }[decision ?? "approve"]}
        confirmLabel={{ approve: "Approve", reject: "Decline", changes: "Request changes" }[decision ?? "approve"]}
        destructive={decision === "reject"}
        loading={running}
        onConfirm={() => void run()}
        onCancel={() => setDecision(null)}
      />
      <ConfirmDialog
        open={delegateTarget !== null}
        title={`Delegate to ${delegateTarget?.name ?? ""}?`}
        description="They are notified and shown as the assigned reviewer. The change is recorded in the audit trail."
        confirmLabel="Delegate"
        loading={running}
        onConfirm={() => void delegateNow()}
        onCancel={() => setDelegateTarget(null)}
      />
    </div>
  );
}

function Section({ number, title, description, icon: Icon, badge, children }: { number: number; title: string; description?: string; icon?: typeof Clock3; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2.5 text-heading font-bold text-headline">{Icon && <Icon className="h-5 w-5 text-section-icon" aria-hidden="true" />}{number}. {title}</h2>
          {description && <p className="mt-0.5 text-support text-heading-support">{description}</p>}
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

function HoursCell({ icon: Icon, label, minutes, window, arrow }: { icon: typeof Clock3; label: string; minutes: number | null | undefined; window: string; arrow?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div>
        <p className="flex items-center gap-2 text-support font-medium text-ink"><Icon className="h-5 w-5 text-section-icon" aria-hidden="true" />{label}</p>
        <p className="mt-1 text-[1.625rem] font-bold tabular-nums text-ink-strong">{hm(minutes)}</p>
        <p className="text-caption text-ink-muted">{window}</p>
      </div>
      {arrow && <ArrowRight className="hidden h-4 w-4 shrink-0 text-section-icon sm:block" aria-hidden="true" />}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 text-sm"><dt className="text-ink-muted">{label}</dt><dd className="whitespace-pre-line text-ink-strong">{value}</dd></div>;
}

function TimelineItem({ title, detail, done, active }: { title: string; detail: string; done?: boolean; active?: boolean }) {
  return (
    <li className="relative">
      <span className={cx("absolute -left-[1.65rem] top-0.5 h-3.5 w-3.5 rounded-full border-2", done ? "border-primary bg-primary" : active ? "border-primary bg-surface" : "border-line-strong bg-surface")} aria-hidden="true" />
      <p className={cx("text-sm font-semibold", done || active ? "text-ink-strong" : "text-ink-muted")}>{title}</p>
      <p className="text-caption text-ink-muted">{detail}</p>
    </li>
  );
}

function DecisionButton({ icon: Icon, label, tone, trailing, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: typeof Clock3; label: string; tone?: "primary" | "danger"; trailing?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "flex h-[4.5rem] flex-col items-center justify-center gap-1 rounded-xl border text-support font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        tone === "primary" ? "border-primary bg-primary text-white hover:bg-primary-hover" : tone === "danger" ? "border-danger/60 text-danger-ink hover:bg-danger-soft" : "border-line-strong text-primary-ink hover:bg-surface-hover",
      )}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="flex items-center gap-1">{label}{trailing && <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}</span>
    </button>
  );
}
