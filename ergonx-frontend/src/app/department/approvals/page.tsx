"use client";

import { AlertTriangle, CalendarDays, Check, ClipboardCheck, X } from "lucide-react";
import { useCallback, useState } from "react";

import { Button, ButtonLink } from "@/components/ui/Button";
import { Avatar, Card } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { Field, Textarea } from "@/components/ui/Field";
import LoadingState from "@/components/ui/LoadingState";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/ToastProvider";
import { dashboardsApi, getApiErrorMessage, leaveApi } from "@/lib/api";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import type { DepartmentApprovalItem } from "@/types/dashboards";

/** Leave requests whose current approval step belongs to this department head. */
export default function DepartmentApprovalsPage() {
  const load = useCallback(() => dashboardsApi.getDepartmentDashboard(), []);
  const { data, loading, error, reload } = useApiResource(load);

  if (loading && !data) return <LoadingState variant="detail" />;

  const queue = data?.approval_queue ?? [];
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="My department / functional area"
        title="Leave approvals"
        description="Requests waiting on your decision. After you approve, HR gives the final approval where your institution requires it."
        icon={ClipboardCheck}
        accent="leave"
        actions={<ButtonLink href="/leave/calendar" variant="secondary" leadingIcon={<CalendarDays className="h-4 w-4" />}>Team calendar</ButtonLink>}
      />
      {error && <ErrorState variant="inline" title="Unable to load approvals" message={error} onRetry={reload} />}
      {data && queue.length === 0 && <EmptyState icon={ClipboardCheck} accent="leave" title="You're all caught up" description="New leave requests from your team will appear here, and you'll get a notification when one arrives." />}
      <div className="space-y-4">
        {queue.map((item) => <ApprovalCard key={item.id} item={item} onDecided={reload} />)}
      </div>
    </div>
  );
}

function ApprovalCard({ item, onDecided }: { item: DepartmentApprovalItem; onDecided: () => void }) {
  const { showToast } = useToast();
  const [comment, setComment] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requested = Number(item.requested_days);
  const balance = item.available_balance === null ? null : Number(item.available_balance);
  const shortfall = balance !== null && balance < requested;

  const decide = async (approve: boolean) => {
    setBusy(true); setError(null);
    try {
      if (approve) await leaveApi.approveLeaveRequest(item.id, comment.trim());
      else await leaveApi.rejectLeaveRequest(item.id, comment.trim());
      showToast({ tone: "success", message: `${approve ? "Approved" : "Rejected"} ${item.employee}'s ${item.leave_type.toLowerCase()}.` });
      onDecided();
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const dates = item.start_date === item.end_date ? formatDate(item.start_date) : `${formatDate(item.start_date)} – ${formatDate(item.end_date)}`;
  return (
    <Card accent="leave" accentLine>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={item.employee} />
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink-strong">{item.employee}</p>
            <p className="text-support text-ink-muted">{item.leave_type} · {dates} · {formatNumber(requested)} day{requested === 1 ? "" : "s"}</p>
          </div>
        </div>
        {item.submitted_at && <p className="text-caption text-ink-muted">Submitted {formatDateTime(item.submitted_at)}</p>}
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div><dt className="text-caption text-ink-muted">Balance available</dt><dd className={`text-sm font-semibold ${shortfall ? "text-danger-ink" : "text-ink-strong"}`}>{balance === null ? "No balance record" : `${formatNumber(balance)} day${balance === 1 ? "" : "s"}`}</dd></div>
        <div className="sm:col-span-2"><dt className="text-caption text-ink-muted">Also off on these dates</dt><dd className="text-sm font-semibold text-ink-strong">{item.also_off.length ? item.also_off.join(", ") : "Nobody else on your team"}</dd></div>
      </dl>
      {item.reason && <p className="mt-3 rounded-xl bg-surface-muted p-3 text-sm text-ink">&ldquo;{item.reason}&rdquo;</p>}
      {(shortfall || item.also_off.length > 1) && (
        <p className="mt-3 flex items-center gap-2 text-support text-warning-ink"><AlertTriangle className="h-4 w-4 shrink-0" />{shortfall ? "The request is larger than the remaining balance." : `${item.also_off.length} other team members are off during this period.`}</p>
      )}

      <div className="mt-4 space-y-3 border-t border-line-soft pt-4">
        <Field label={rejecting ? "Reason for rejection" : "Comment"} optional={!rejecting} required={rejecting}>
          <Textarea rows={2} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={rejecting ? "Tell them why, so they can re-plan." : "Optional note for the employee and HR."} />
        </Field>
        {error && <p className="text-support text-danger-ink">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {rejecting ? (
            <>
              <Button variant="danger" loading={busy} disabled={!comment.trim()} onClick={() => void decide(false)} leadingIcon={<X className="h-4 w-4" />}>Confirm rejection</Button>
              <Button variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>Back</Button>
            </>
          ) : (
            <>
              <Button loading={busy} onClick={() => void decide(true)} leadingIcon={<Check className="h-4 w-4" />}>Approve</Button>
              <Button variant="secondary" disabled={busy} onClick={() => setRejecting(true)} leadingIcon={<X className="h-4 w-4" />}>Reject</Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
