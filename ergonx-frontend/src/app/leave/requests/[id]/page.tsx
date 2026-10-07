"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Info,
  MessageCircle,
  Minus,
  Paperclip,
  Pencil,
  Send,
  ShieldCheck,
  UserPlus,
  Users,
  X,
  XCircle,
} from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import StatusBadge from "@/components/ui/StatusBadge";
import { Avatar } from "@/components/ui/Card";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Menu, MenuItem } from "@/components/ui/Overlay";
import { PrintButton, PrintFooter, PrintMasthead } from "@/components/brand/PrintDocument";
import { useAuth } from "@/components/guards/AuthProvider";
import { employeesApi, getApiErrorMessage, isApiRequestError, leaveApi, operationsApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { EM_DASH, formatDate, formatDateTime, formatNumber, humanizeEnum } from "@/lib/format";
import type { Employee } from "@/types/hr";
import type { LeaveApproval, LeaveDelegateCandidate, LeaveRequest, LeaveRequestComment, LeaveReviewContext, LeaveType } from "@/types/leave";
import type { DocumentRecord } from "@/types/operations";
import { useApiResource } from "@/lib/useApiResource";

type PendingAction = "submit" | "approve" | "reject" | "cancel" | "changes" | null;
type ReviewTab = "calendar" | "details" | "team";

interface RequestDetail {
  request: LeaveRequest;
  employee: Employee | null;
  leaveType: LeaveType | null;
  approvals: LeaveApproval[];
  attachment: DocumentRecord | null;
  review: LeaveReviewContext | null;
  comments: LeaveRequestComment[];
}

/**
 * Loads the request plus everything the review screen shows. Related reads are
 * tolerated individually: a role that cannot see the review context or the
 * approval trail still sees the request itself.
 */
async function loadDetail(id: string): Promise<RequestDetail> {
  const request = await leaveApi.getLeaveRequest(id);
  const [employee, leaveType, approvals, attachment, review, comments] = await Promise.all([
    employeesApi.getEmployee(request.employee).catch(() => null),
    leaveApi.getLeaveType(request.leave_type).catch(() => null),
    leaveApi.listLeaveApprovals({ leave_request: id, ordering: "sequence", page_size: 100 }).then((page) => page.results).catch(() => []),
    request.attachment ? operationsApi.getDocument(request.attachment).catch(() => null) : Promise.resolve(null),
    leaveApi.getLeaveReview(id).catch(() => null),
    leaveApi.listLeaveComments(id).catch(() => []),
  ]);
  return { request, employee, leaveType, approvals, attachment, review, comments };
}

const NOTE_LIMIT = 500;

function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Working days (Mon–Fri) between two ISO dates, inclusive. */
function workingDays(start: string, end: string) {
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  let count = 0;
  for (const day = new Date(from); day <= to; day.setDate(day.getDate() + 1)) if (day.getDay() % 6 !== 0) count += 1;
  return count;
}

export default function LeaveRequestReviewPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { user } = useAuth();

  const load = useCallback(() => loadDetail(id), [id]);
  const { data: detail, loading, error, reload } = useApiResource(load);
  const [tab, setTab] = useState<ReviewTab>("calendar");
  const [month, setMonth] = useState<Date | null>(null);

  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionRunning, setActionRunning] = useState(false);
  const [actionError, setActionError] = useState("");
  const [note, setNote] = useState("");

  const [delegates, setDelegates] = useState<LeaveDelegateCandidate[] | null>(null);
  const [delegateTarget, setDelegateTarget] = useState<LeaveDelegateCandidate | null>(null);

  const [commentOpen, setCommentOpen] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);

  const [editingDraft, setEditingDraft] = useState(false);
  const [draft, setDraft] = useState({ start_date: "", end_date: "", requested_days: "", reason: "" });
  const [draftSaving, setDraftSaving] = useState(false);


  const runAction = useCallback(async () => {
    if (!pendingAction || !id) return;
    setActionRunning(true);
    setActionError("");
    try {
      const comment = note.trim();
      if (pendingAction === "submit") await leaveApi.submitLeaveRequest(id);
      if (pendingAction === "approve") await leaveApi.approveLeaveRequest(id, comment);
      if (pendingAction === "reject") await leaveApi.rejectLeaveRequest(id, comment);
      if (pendingAction === "changes") await leaveApi.requestLeaveChanges(id, comment);
      if (pendingAction === "cancel") await leaveApi.cancelLeaveRequest(id);
      setPendingAction(null);
      setNote("");
      reload();
    } catch (caught) {
      setPendingAction(null);
      setActionError(isApiRequestError(caught) ? caught.message : getApiErrorMessage(caught));
    } finally {
      setActionRunning(false);
    }
  }, [pendingAction, id, note, reload]);

  const confirmDelegate = async () => {
    if (!delegateTarget) return;
    setActionRunning(true);
    setActionError("");
    try {
      await leaveApi.delegateLeaveRequest(id, delegateTarget.id, note.trim());
      setDelegateTarget(null);
      setNote("");
      reload();
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
      setDelegateTarget(null);
    } finally {
      setActionRunning(false);
    }
  };

  const postComment = async () => {
    if (!commentBody.trim()) return;
    setCommentSaving(true);
    try {
      await leaveApi.addLeaveComment(id, commentBody.trim());
      reload();
      setCommentBody("");
      setCommentOpen(false);
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
    } finally {
      setCommentSaving(false);
    }
  };

  const saveDraft = async () => {
    setDraftSaving(true);
    setActionError("");
    try {
      await leaveApi.updateLeaveRequest(id, { start_date: draft.start_date, end_date: draft.end_date, requested_days: draft.requested_days, reason: draft.reason });
      setEditingDraft(false);
      reload();
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
    } finally {
      setDraftSaving(false);
    }
  };

  const shownMonth = useMemo(() => month ?? (detail ? new Date(`${detail.request.start_date.slice(0, 7)}-01T00:00:00`) : new Date()), [month, detail]);

  if (loading && !detail) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" role="status">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-primary" />
          <p className="mt-4 text-sm text-ink-muted">Loading leave request…</p>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-6">
        <Link href="/leave/requests" className="inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to leave requests</Link>
        <ErrorState message={error ?? "This leave request could not be loaded."} onRetry={reload} />
      </div>
    );
  }

  const { request, employee, leaveType, approvals, attachment, review, comments } = detail;
  const status = request.status;
  const isDraft = status === "DRAFT";
  const isPending = status === "PENDING";
  const isOwner = review ? review.is_requester : Boolean(employee?.user && employee.user === user?.id);
  const canDecide = isPending && Boolean(review?.can_decide);
  const canDelegate = isPending && Boolean(review?.can_delegate);
  const canCancel = isDraft || isPending;
  const employeeName = employee ? employeesApi.employeeDisplayName(employee) : review?.employee_name ?? EM_DASH;
  const days = workingDays(request.start_date, request.end_date);
  const reference = review?.reference ?? request.reference ?? "";

  const downloadAttachment = async () => {
    if (!attachment) return;
    const blob = await operationsApi.downloadDocument(attachment.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = attachment.original_filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openDelegates = async () => {
    if (delegates) return;
    setDelegates(await leaveApi.listLeaveDelegates(id).catch(() => []));
  };

  const requireNote = (action: "reject" | "changes") => {
    if (!note.trim()) {
      setActionError(action === "reject" ? "Add a note explaining why the request is declined." : "Add a note explaining what needs to change.");
      return;
    }
    setActionError("");
    setPendingAction(action);
  };

  return (
    <div className={cx("space-y-5", (canDecide || canDelegate) && "pb-28")}>
      <PrintMasthead documentTitle="Leave request form" reference={reference} />

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/leave/requests" className="inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to leave requests</Link>
        <div className="flex items-center gap-5 text-sm font-semibold">
          {review?.queue.total ? <span className="text-ink-muted">{review.queue.position ? `${review.queue.position} of ${review.queue.total} in your queue` : `${review.queue.total} in your queue`}</span> : null}
          {review?.queue.previous_id ? <Link href={`/leave/requests/${review.queue.previous_id}`} className="inline-flex items-center gap-1 text-primary-ink hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden="true" />Previous request</Link> : null}
          {review?.queue.next_id ? <Link href={`/leave/requests/${review.queue.next_id}`} className="inline-flex items-center gap-1 text-primary-ink hover:underline">Next request<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link> : null}
          <PrintButton />
        </div>
      </div>

      <header>
        <h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">Leave Request Review</h1>
        <p className="mt-1.5 text-[1.0625rem] text-ink-muted">Review the request details, check team availability and policy compliance before making a decision.</p>
      </header>

      {actionError && <div role="alert" className="rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger-ink">{actionError}</div>}

      {isDraft && request.changes_requested_note && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning-ink">
          <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div><p className="font-semibold">Changes requested{request.changes_requested_at ? ` on ${formatDate(request.changes_requested_at)}` : ""}</p><p className="mt-0.5">{request.changes_requested_note}</p></div>
        </div>
      )}

      {/* Request summary strip */}
      <section className="grid gap-5 rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 md:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))] md:divide-x md:divide-line-soft">
        <div className="flex items-center gap-4">
          <Avatar name={employeeName} size="lg" className="h-20 w-20 text-heading" />
          <div className="min-w-0">
            <p className="text-heading font-bold text-headline">{employee ? <Link href={`/hr/employees/${employee.id}`} className="hover:underline">{employeeName}</Link> : employeeName}</p>
            <p className="text-support text-ink">{review?.position ?? EM_DASH}</p>
            <p className="text-support text-ink-muted">{review?.department ?? EM_DASH}</p>
            <p className="mt-1 text-caption text-ink-muted">{employee?.employee_number ?? review?.employee_number ?? EM_DASH}{review?.employment_type ? ` · ${humanizeEnum(review.employment_type)}` : ""}</p>
          </div>
        </div>
        <SummaryCell label="Leave type" icon={CalendarDays} value={leaveType?.name ?? EM_DASH} />
        <SummaryCell label="Dates" icon={CalendarDays} value={<>{formatDate(request.start_date)} –<br />{formatDate(request.end_date)}</>} />
        <SummaryCell label="Duration" icon={Clock3} value={<>{formatNumber(request.requested_days)} day{Number(request.requested_days) === 1 ? "" : "s"}<span className="block text-caption font-normal text-ink-muted">({days} working day{days === 1 ? "" : "s"})</span></>} />
        <div className="md:pl-5">
          <p className="text-caption text-ink-muted">Status</p>
          <div className="mt-2"><StatusBadge status={status} /></div>
          <p className="mt-2 text-caption text-ink-muted">{request.submitted_at ? `Submitted on ${formatDate(request.submitted_at)}` : "Not yet submitted"}</p>
          {reference && <p className="text-caption text-ink-muted">Ref: {reference}</p>}
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-5">
          {/* Tabs */}
          <section className="rounded-2xl border border-line bg-surface shadow-elevation-1">
            <div role="tablist" aria-label="Review sections" className="flex gap-7 border-b border-line px-5">
              {([["calendar", "Calendar view"], ["details", "Request details"], ["team", "Team availability"]] as const).map(([value, label]) => (
                <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={cx("relative h-12 text-[0.9375rem] font-semibold", tab === value ? "text-primary-ink" : "text-ink-muted hover:text-ink-strong")}>
                  {label}
                  <span aria-hidden="true" className={cx("absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-primary", tab === value ? "opacity-100" : "opacity-0")} />
                </button>
              ))}
            </div>
            <div className="p-5">
              {tab === "calendar" && (
                <ReviewCalendar
                  month={shownMonth}
                  onMonth={setMonth}
                  request={request}
                  employeeName={employeeName}
                  leaveTypeName={leaveType?.name ?? "Leave"}
                  team={review?.team_on_leave ?? []}
                />
              )}
              {tab === "details" && (
                <div className="space-y-5">
                  {editingDraft ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="text-sm font-semibold text-ink-strong">Start date<input type="date" value={draft.start_date} onChange={(event) => setDraft((current) => ({ ...current, start_date: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-line-strong px-3 font-normal" /></label>
                      <label className="text-sm font-semibold text-ink-strong">End date<input type="date" value={draft.end_date} onChange={(event) => setDraft((current) => ({ ...current, end_date: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-line-strong px-3 font-normal" /></label>
                      <label className="text-sm font-semibold text-ink-strong">Days requested<input type="number" min="0.5" step="0.5" value={draft.requested_days} onChange={(event) => setDraft((current) => ({ ...current, requested_days: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-line-strong px-3 font-normal" /></label>
                      <label className="text-sm font-semibold text-ink-strong sm:col-span-2">Reason<textarea rows={3} value={draft.reason} onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-line-strong px-3 py-2 font-normal" /></label>
                      <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="secondary" onClick={() => setEditingDraft(false)}>Cancel</Button><Button loading={draftSaving} loadingLabel="Saving…" onClick={() => void saveDraft()}>Save draft</Button></div>
                    </div>
                  ) : (
                    <dl className="grid gap-x-10 gap-y-4 sm:grid-cols-2">
                      <DetailRow label="Employee" value={`${employeeName} (${employee?.employee_number ?? EM_DASH})`} />
                      <DetailRow label="Leave type" value={leaveType?.name ?? EM_DASH} />
                      <DetailRow label="Start date" value={formatDate(request.start_date)} />
                      <DetailRow label="End date" value={formatDate(request.end_date)} />
                      <DetailRow label="Days requested" value={formatNumber(request.requested_days)} />
                      <DetailRow label="Submitted" value={request.submitted_at ? formatDateTime(request.submitted_at) : EM_DASH} />
                      <DetailRow label="Paid leave" value={leaveType ? (leaveType.is_paid ? "Yes" : "No") : EM_DASH} />
                      <DetailRow label="Requires approval" value={leaveType ? (leaveType.requires_approval ? "Yes" : "No") : EM_DASH} />
                      <div className="sm:col-span-2"><DetailRow label="Reason" value={request.reason || EM_DASH} /></div>
                    </dl>
                  )}
                  {isDraft && isOwner && !editingDraft && <Button variant="secondary" leadingIcon={<Pencil className="h-4 w-4" />} onClick={() => { setDraft({ start_date: request.start_date, end_date: request.end_date, requested_days: String(Number(request.requested_days)), reason: request.reason }); setEditingDraft(true); }}>Edit draft</Button>}
                </div>
              )}
              {tab === "team" && (
                (review?.team_on_leave.length ?? 0) === 0 ? (
                  <div className="py-10 text-center"><span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary-soft text-primary"><Users className="h-7 w-7" aria-hidden="true" /></span><p className="mt-4 font-bold text-headline">No team members on leave</p><p className="mt-1 text-support text-ink-muted">Nobody else in {review?.department ?? "this department / functional area"} has pending or approved leave this month.</p></div>
                ) : (
                  <ul className="divide-y divide-line-soft">
                    {review!.team_on_leave.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <span className="flex items-center gap-3"><Avatar name={item.employee_name} size="md" /><span><span className="block font-semibold text-headline">{item.employee_name}</span><span className="text-caption text-ink-muted">{item.leave_type} · {formatDate(item.start_date)} – {formatDate(item.end_date)}</span></span></span>
                        <span className="flex items-center gap-2">{item.overlaps && <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-caption font-semibold text-warning-ink">Overlaps</span>}<StatusBadge status={item.status} size="sm" /></span>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
          </section>

          {isDraft && isOwner && (
            <div className="flex flex-wrap justify-end gap-2 print:hidden">
              <Button variant="secondary" leadingIcon={<XCircle className="h-4 w-4" />} onClick={() => setPendingAction("cancel")}>Cancel request</Button>
              <Button leadingIcon={<Send className="h-4 w-4" />} onClick={() => setPendingAction("submit")}>{request.changes_requested_note ? "Resubmit" : "Submit"}</Button>
            </div>
          )}
          {isPending && !canDecide && canCancel && isOwner && (
            <div className="flex justify-end print:hidden"><Button variant="secondary" leadingIcon={<XCircle className="h-4 w-4" />} onClick={() => setPendingAction("cancel")}>Cancel request</Button></div>
          )}
        </div>

        {/* Right rail */}
        <aside className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
          <RailSection icon={BarChart3} title="Leave balance">
            <p className="text-caption text-ink-muted">{leaveType?.name ?? "Leave"} (days){review?.balance ? ` · ${review.balance.year}` : ""}</p>
            {review?.balance ? (
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <BalanceCell label="Entitlement" value={formatNumber(review.balance.entitlement)} />
                <BalanceCell label="Used" value={formatNumber(review.balance.used)} />
                <BalanceCell label="Available" value={formatNumber(review.balance.available)} strong />
              </div>
            ) : (
              <><p className="mt-1 text-heading font-bold text-ink-strong">Not available</p><p className="text-support text-ink-muted">Leave balance information is not available for this employee at this time.</p></>
            )}
          </RailSection>

          <RailSection icon={ShieldCheck} title="Policy compliance">
            {review?.policy_checks.length ? (
              <ul className="space-y-2">
                {review.policy_checks.map((check) => (
                  <li key={check.code} className="flex items-start gap-3 rounded-xl bg-surface-muted/60 px-3 py-2.5">
                    <span className={cx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", check.status === "pass" ? "bg-success-soft text-success" : check.status === "warn" ? "bg-warning-soft text-warning-ink" : check.status === "fail" ? "bg-danger-soft text-danger" : "bg-surface-muted text-ink-muted")} aria-hidden="true">
                      {check.status === "pass" ? <Check className="h-3.5 w-3.5" /> : check.status === "warn" ? <Info className="h-3.5 w-3.5" /> : check.status === "fail" ? <X className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                    </span>
                    {/* "not_evaluated": the rule could not be checked; it is never shown as compliant. */}
                    <span className="min-w-0"><span className="block text-sm font-semibold text-ink-strong">{check.label}{check.status === "not_evaluated" && <span className="ml-2 text-caption font-medium text-ink-muted">Not evaluated</span>}</span><span className="block text-caption text-ink-muted">{check.detail}</span></span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyRail icon={Info} title="Policy checks unavailable" text="We're unable to run policy checks for this request at this time." />
            )}
          </RailSection>

          <RailSection icon={Paperclip} title={`Supporting documents (${attachment || request.attachment ? 1 : 0})`}>
            {request.attachment ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
                <span className="flex min-w-0 items-center gap-2"><FileText className="h-5 w-5 shrink-0 text-section-icon" aria-hidden="true" /><span className="truncate text-sm font-medium text-ink-strong">{attachment?.original_filename ?? "Supporting document"}</span></span>
                {attachment && <button type="button" onClick={() => void downloadAttachment()} className={buttonClasses({ variant: "secondary", size: "sm" })}>Download</button>}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-center"><FileText className="mx-auto h-6 w-6 text-ink-subtle" aria-hidden="true" /><p className="mt-2 text-sm font-semibold text-ink-strong">No supporting documents</p><p className="text-caption text-ink-muted">There are no documents attached to this request.</p></div>
            )}
          </RailSection>

          <RailSection icon={MessageCircle} title={`Comments (${comments.length})`} action={<button type="button" onClick={() => setCommentOpen((open) => !open)} className="text-sm font-semibold text-primary-ink hover:underline print:hidden">Add comment</button>}>
            {commentOpen && (
              <div className="mb-3 space-y-2">
                <textarea rows={3} maxLength={2000} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Write a comment visible to the employee and reviewers…" aria-label="Comment" className="w-full rounded-lg border border-line-strong px-3 py-2 text-sm" />
                <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => setCommentOpen(false)}>Cancel</Button><Button size="sm" loading={commentSaving} disabled={!commentBody.trim()} onClick={() => void postComment()}>Post</Button></div>
              </div>
            )}
            {comments.length === 0 ? (
              <EmptyRail icon={MessageCircle} title="No comments yet" text="Be the first to add a comment to this request." />
            ) : (
              <ul className="space-y-3">
                {comments.map((comment) => (
                  <li key={comment.id} className="flex gap-2.5"><Avatar name={comment.author_name} size="sm" /><div className="min-w-0 rounded-xl bg-surface-muted/60 px-3 py-2"><p className="text-caption"><span className="font-semibold text-ink-strong">{comment.author_name}</span> <span className="text-ink-muted">· {formatDateTime(comment.created_at)}</span></p><p className="mt-0.5 whitespace-pre-line text-sm text-ink">{comment.body}</p></div></li>
                ))}
              </ul>
            )}
          </RailSection>

          <RailSection icon={Clock3} title={`Approval history (${approvals.filter((item) => item.acted_at).length})`}>
            {approvals.length === 0 ? (
              <EmptyRail icon={Clock3} title="No approval history" text="This request has not been reviewed yet." />
            ) : (
              <ol className="relative space-y-4 border-l border-line pl-5">
                {approvals.map((approval) => (
                  <li key={approval.id} className="relative">
                    <span className={cx("absolute -left-[1.6rem] top-1 h-3 w-3 rounded-full ring-4 ring-surface", approval.status === "APPROVED" ? "bg-success" : approval.status === "REJECTED" ? "bg-danger" : approval.status === "PENDING" ? "bg-primary" : "bg-line-strong")} aria-hidden="true" />
                    <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-ink-strong">Step {approval.sequence}{approval.approver_name ? ` · ${approval.approver_name}` : ""}</p><StatusBadge status={approval.status} size="sm" /></div>
                    {approval.delegated_from && <p className="text-caption text-ink-muted">Delegated to this approver</p>}
                    <p className="text-caption text-ink-muted">{approval.acted_at ? formatDateTime(approval.acted_at) : "Awaiting action"}</p>
                    {approval.comment && <p className="mt-1 text-support text-ink">{approval.comment}</p>}
                  </li>
                ))}
              </ol>
            )}
          </RailSection>
        </aside>
      </div>

      {(canDecide || canDelegate) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgb(15_35_69/0.25)] backdrop-blur print:hidden lg:left-[var(--shell-sidebar-expanded)]">
          <div className="mx-auto flex max-w-[1360px] flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative flex min-w-0 flex-1 items-center gap-3">
              <MessageCircle className="h-5 w-5 shrink-0 text-section-icon" aria-hidden="true" />
              <input value={note} maxLength={NOTE_LIMIT} onChange={(event) => setNote(event.target.value)} placeholder="Add an optional note (visible to the employee)" aria-label="Decision note" className="h-11 w-full rounded-lg border border-line-strong px-3 pr-16 text-sm" />
              <span className="pointer-events-none absolute right-3 text-caption text-ink-muted">{note.length}/{NOTE_LIMIT}</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {canDelegate && (
                <Menu label="Delegate approval" align="end" trigger={(props) => <Button {...props} size="lg" variant="secondary" leadingIcon={<UserPlus className="h-4 w-4" />} trailingIcon={<ChevronDown className="h-4 w-4" />} onClick={() => { props.onClick(); void openDelegates(); }}>Delegate</Button>}>
                  {(close) => (
                    <div className="max-h-72 overflow-y-auto p-1.5">
                      {delegates === null ? <p className="px-3 py-2 text-support text-ink-muted">Loading approvers…</p> : delegates.length === 0 ? <p className="px-3 py-2 text-support text-ink-muted">No other leave approvers are available.</p> : delegates.map((candidate) => (
                        <MenuItem key={candidate.id} description={candidate.role} onSelect={() => { close(); setDelegateTarget(candidate); }}>{candidate.name}</MenuItem>
                      ))}
                    </div>
                  )}
                </Menu>
              )}
              {canDecide && (
                <>
                  <Button size="lg" variant="secondary" leadingIcon={<Pencil className="h-4 w-4" />} onClick={() => requireNote("changes")}>Request changes</Button>
                  <Button size="lg" variant="secondary" className="border-danger/60 text-danger-ink hover:border-danger hover:bg-danger-soft" leadingIcon={<X className="h-4 w-4" />} onClick={() => requireNote("reject")}>Decline</Button>
                  <Button size="lg" className="bg-success hover:bg-success/90" leadingIcon={<Check className="h-4 w-4" />} onClick={() => { setActionError(""); setPendingAction("approve"); }}>Approve</Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingAction !== null}
        title={{ approve: "Approve leave request?", reject: "Decline leave request?", submit: request.changes_requested_note ? "Resubmit leave request?" : "Submit leave request?", changes: "Request changes?", cancel: "Cancel leave request?" }[pendingAction ?? "cancel"]}
        description={{
          approve: "Approving consumes the employee's leave balance for the requested days.",
          reject: "The request will be rejected and your note kept with the decision.",
          submit: "The request enters the approval workflow and can no longer be edited.",
          changes: "The request returns to the employee as a draft with your note. They can edit and resubmit it.",
          cancel: "Cancelling releases any balance held for this request. This cannot be undone.",
        }[pendingAction ?? "cancel"]}
        confirmLabel={{ approve: "Approve", reject: "Decline", submit: "Submit", changes: "Request changes", cancel: "Cancel request" }[pendingAction ?? "cancel"]}
        destructive={pendingAction === "reject" || pendingAction === "cancel"}
        loading={actionRunning}
        onConfirm={() => void runAction()}
        onCancel={() => setPendingAction(null)}
      />
      <ConfirmDialog
        open={delegateTarget !== null}
        title={`Delegate to ${delegateTarget?.name ?? ""}?`}
        description="The current approval step moves to this approver. They are notified, and the change is recorded in the audit trail."
        confirmLabel="Delegate"
        loading={actionRunning}
        onConfirm={() => void confirmDelegate()}
        onCancel={() => setDelegateTarget(null)}
      />
      <PrintFooter />
    </div>
  );
}

function SummaryCell({ label, icon: Icon, value }: { label: string; icon: typeof CalendarDays; value: React.ReactNode }) {
  return (
    <div className="md:pl-5">
      <p className="text-caption text-ink-muted">{label}</p>
      <span className="mt-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-primary" aria-hidden="true"><Icon className="h-5 w-5" /></span>
      <p className="mt-2 text-sm font-semibold text-ink-strong">{value}</p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-caption text-ink-muted">{label}</dt><dd className="mt-1 text-sm text-ink-strong">{value}</dd></div>;
}

function RailSection({ icon: Icon, title, action, children }: { icon: typeof CalendarDays; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-line-soft pb-4 last:border-b-0 last:pb-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2.5 text-card-title font-bold text-headline"><Icon className="h-5 w-5 text-section-icon" aria-hidden="true" />{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyRail({ icon: Icon, title, text }: { icon: typeof CalendarDays; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-surface-muted/60 px-3 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-ink-muted" aria-hidden="true"><Icon className="h-4 w-4" /></span>
      <div><p className="text-sm font-semibold text-ink-strong">{title}</p><p className="text-caption text-ink-muted">{text}</p></div>
    </div>
  );
}

function BalanceCell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className={cx("rounded-xl px-2 py-2.5", strong ? "bg-primary-soft" : "bg-surface-muted/70")}><p className={cx("text-heading font-bold tabular-nums", strong ? "text-primary-ink" : "text-ink-strong")}>{value}</p><p className="text-caption text-ink-muted">{label}</p></div>;
}

/** Month grid: the requested span plus colleagues' pending and approved leave. */
function ReviewCalendar({ month, onMonth, request, employeeName, leaveTypeName, team }: {
  month: Date;
  onMonth: (month: Date) => void;
  request: LeaveRequest;
  employeeName: string;
  leaveTypeName: string;
  team: LeaveReviewContext["team_on_leave"];
}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first); start.setDate(first.getDate() - lead);
  const weeks = Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => { const date = new Date(start); date.setDate(start.getDate() + week * 7 + day); return date; }));
  const todayIso = iso(new Date());
  const inRange = (value: string, from: string, to: string) => value >= from && value <= to;
  const shift = (delta: number) => onMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-heading font-bold text-headline">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => onMonth(new Date(`${request.start_date.slice(0, 7)}-01T00:00:00`))}>Request month</Button>
          <Button size="sm" variant="secondary" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="secondary" aria-label="Next month" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-7 overflow-hidden rounded-xl border border-line">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => <div key={name} className="border-b border-line bg-surface-muted/80 py-2 text-center text-caption font-semibold text-ink-strong">{name}</div>)}
          {weeks.flat().map((date, index) => {
            const value = iso(date);
            const outside = date.getMonth() !== month.getMonth();
            const weekend = date.getDay() % 6 === 0;
            const mine = inRange(value, request.start_date, request.end_date);
            const others = team.filter((item) => inRange(value, item.start_date, item.end_date));
            return (
              <div key={index} className={cx("min-h-[4.75rem] border-b border-r border-line-soft p-1.5 text-right [&:nth-child(7n)]:border-r-0", weekend && "bg-surface-muted/40", mine && "bg-primary-soft/70")}>
                <span className={cx("text-caption tabular-nums", outside ? "text-ink-subtle" : "text-ink-strong", value === todayIso && "rounded-full bg-primary px-1.5 py-0.5 text-white")}>{date.getDate()}</span>
                <div className="mt-1 space-y-1 text-left">
                  {mine && value === request.start_date && <p className="truncate rounded-md bg-primary/15 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-primary-ink">{employeeName} – {leaveTypeName}</p>}
                  {others.slice(0, 2).map((item) => (
                    <p key={item.id} className={cx("flex items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium", item.status === "APPROVED" ? "bg-mod-leave-soft text-mod-leave" : "bg-mod-recruitment-soft text-mod-recruitment")}>
                      <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", item.status === "APPROVED" ? "bg-mod-leave" : "bg-mod-recruitment")} aria-hidden="true" />{item.employee_name}
                    </p>
                  ))}
                  {others.length > 2 && <p className="px-1.5 text-[0.6875rem] text-ink-muted">+{others.length - 2} more</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <ul className="mt-4 flex flex-wrap gap-5 text-caption text-ink-muted" aria-label="Legend">
        <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-primary" aria-hidden="true" />Requested leave</li>
        <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-mod-leave" aria-hidden="true" />Team member on leave</li>
        <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-mod-recruitment" aria-hidden="true" />Pending team leave</li>
        <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-line-strong" aria-hidden="true" />Non-working day</li>
      </ul>
    </div>
  );
}
