"use client";

import { AlertTriangle, ArrowUpRight, BriefcaseBusiness, CalendarDays, Check, CheckCircle2, Clock3, GitPullRequest, History, Hourglass, Landmark, Lock, Undo2, Wallet, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card, IconTile } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { Field, Textarea } from "@/components/ui/Field";
import LoadingState from "@/components/ui/LoadingState";
import { Dialog } from "@/components/ui/Overlay";
import PageHeader from "@/components/ui/PageHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useToast } from "@/components/ui/ToastProvider";
import { useAccess } from "@/lib/access";
import { getApiErrorMessage, workflowsApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { formatAmount, formatDateTime } from "@/lib/format";
import type { ModuleAccent } from "@/lib/moduleTheme";
import { useApiResource } from "@/lib/useApiResource";
import type { InboxAction, InboxDecision, InboxItem, InboxModule } from "@/types/workflows";

const MODULES: Record<InboxModule, { label: string; icon: LucideIcon; accent: ModuleAccent }> = {
  LEAVE: { label: "Leave", icon: CalendarDays, accent: "leave" },
  ATTENDANCE: { label: "Attendance", icon: Clock3, accent: "attendance" },
  PAYROLL: { label: "Payroll", icon: Wallet, accent: "payroll" },
  RECRUITMENT: { label: "Recruitment", icon: BriefcaseBusiness, accent: "recruitment" },
  ACCOUNTING: { label: "Finance", icon: Landmark, accent: "accounting" },
  WORKFLOW: { label: "Workflows", icon: GitPullRequest, accent: "brand" },
};

const OUTCOMES: Record<string, { label: string; tone: string; icon: LucideIcon }> = {
  APPROVED: { label: "Approved", tone: "text-success", icon: CheckCircle2 },
  FORWARDED: { label: "Approved · sent to next approver", tone: "text-success", icon: CheckCircle2 },
  REJECTED: { label: "Rejected", tone: "text-danger", icon: X },
  RETURNED: { label: "Returned for changes", tone: "text-warning-ink", icon: Undo2 },
};

const DAY = 24 * 60 * 60 * 1000;
const PAGE = 12;

function waited(submittedAt: string, now: number): string {
  const days = Math.floor((now - new Date(submittedAt).getTime()) / DAY);
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export default function ApprovalsPage() {
  const { readOnly } = useAccess();
  const { showToast } = useToast();
  const load = useCallback(() => workflowsApi.getApprovalInbox(), []);
  const { data, loading, error, reload } = useApiResource(load);
  const [filter, setFilter] = useState<InboxModule | "ALL" | "STALE">("ALL");
  const [pending, setPending] = useState<{ item: InboxItem; action: InboxAction } | null>(null);
  const [shown, setShown] = useState(PAGE);

  const now = useMemo(() => (data ? new Date(data.generated_at).getTime() : 0), [data]);
  if (loading) return <LoadingState variant="table" />;
  if (error || !data) return <ErrorState message={error ?? "The approval inbox could not be loaded."} onRetry={reload} />;

  const { summary } = data;
  // Fall back to "All" once the filtered module's last item has been decided.
  const isStale = (item: InboxItem) => now - new Date(item.submitted_at).getTime() > 3 * DAY;
  const activeFilter = filter === "STALE" ? (summary.waiting_over_3_days ? "STALE" : "ALL") : filter !== "ALL" && !summary.by_module.some((row) => row.module === filter) ? "ALL" : filter;
  const visible = activeFilter === "ALL" ? data.items : activeFilter === "STALE" ? data.items.filter(isStale) : data.items.filter((item) => item.module === activeFilter);
  const awaiting = summary.actionable + summary.needs_review;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workflow"
        title="Approvals"
        description="Review and action requests as they move through your institution's approval workflows."
        icon={GitPullRequest}
        accent="brand"
        meta={
          <span className={awaiting > 0 ? "inline-flex items-center gap-2 rounded-full bg-warning-soft px-3 py-1 text-support font-semibold text-warning-ink" : "inline-flex items-center gap-2 rounded-full bg-success-soft px-3 py-1 text-support font-semibold text-success-ink"}>
            {awaiting === 0 ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Hourglass className="h-4 w-4" aria-hidden="true" />}
            <strong className="tabular-nums">{awaiting}</strong> pending decision{awaiting === 1 ? "" : "s"}
          </span>
        }
      />

      {summary.total > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryTile icon={Hourglass} label="Awaiting your decision" value={summary.actionable} tone="brand" />
          <SummaryTile icon={AlertTriangle} label="Waiting over 3 days" value={summary.waiting_over_3_days} tone={summary.waiting_over_3_days ? "warning" : "neutral"} />
          <SummaryTile icon={ArrowUpRight} label="Review on the record page" value={summary.needs_review} tone="neutral" hint="Some requests are decided on their own record page." />
          <SummaryTile icon={Clock3} label="Oldest request" value={summary.oldest_submitted_at ? waited(summary.oldest_submitted_at, now) : "—"} tone="neutral" />
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.85fr)]">
        <Card
          title="Approval requests"
          description="Requests that need your decision appear here."
          icon={GitPullRequest}
          accent="brand"
          padding="none"
          className="min-h-[22rem] [&>div:first-child]:mb-0 [&>div:first-child]:border-b [&>div:first-child]:border-line-soft [&>div:first-child]:px-5 [&>div:first-child]:py-5 sm:[&>div:first-child]:px-6"
          actions={summary.by_module.length > 1 || summary.waiting_over_3_days > 0 ? (
            <SegmentedControl
              label="Filter by module"
              value={activeFilter}
              onChange={(value) => { setFilter(value); setShown(PAGE); }}
              options={[{ value: "ALL" as const, label: `All ${summary.total}` }, ...(summary.waiting_over_3_days ? [{ value: "STALE" as const, label: `Over 3 days ${summary.waiting_over_3_days}` }] : []), ...summary.by_module.map((row) => ({ value: row.module, label: `${MODULES[row.module].label} ${row.count}` }))]}
            />
          ) : undefined}
        >
          {data.items.length === 0 ? (
            <EmptyState size="compact" icon={CheckCircle2} title="Your approval queue is clear" description="New requests from leave, attendance, recruitment and other workflows will appear here." className="min-h-[15rem] justify-center px-6" />
          ) : (
            <>
              <ul className="divide-y divide-line-soft">
                {visible.slice(0, shown).map((item) => (
                  <InboxRow key={`${item.kind}-${item.id}`} item={item} now={now} readOnly={readOnly} onAction={(action) => setPending({ item, action })} />
                ))}
              </ul>
              {visible.length > shown && (
                <div className="flex items-center justify-between gap-3 border-t border-line-soft px-5 py-3 sm:px-6">
                  <p className="text-caption text-ink-muted">Showing {shown} of {visible.length}, oldest first</p>
                  <Button size="sm" variant="secondary" onClick={() => setShown((count) => count + PAGE * 2)}>Show {Math.min(PAGE * 2, visible.length - shown)} more</Button>
                </div>
              )}
            </>
          )}
        </Card>

        <Card
          title="Recent decisions"
          description="A record of the latest ten approval actions."
          icon={History}
          accent="brand"
          padding="none"
          className="min-h-[22rem] [&>div:first-child]:mb-0 [&>div:first-child]:border-b [&>div:first-child]:border-line-soft [&>div:first-child]:px-5 [&>div:first-child]:py-5 sm:[&>div:first-child]:px-6"
        >
          {data.decisions.length === 0 ? (
            <EmptyState size="compact" icon={History} title="No decisions recorded yet" description="Approved, rejected and cancelled requests will be listed here." className="min-h-[15rem] justify-center px-6" />
          ) : (
            <ol className="divide-y divide-line-soft">
              {data.decisions.map((decision) => <DecisionRow key={decision.id} decision={decision} />)}
            </ol>
          )}
        </Card>
      </div>

      {pending && (
        <DecisionDialog
          item={pending.item}
          action={pending.action}
          onClose={() => setPending(null)}
          onDone={(message) => { setPending(null); showToast({ tone: "success", message }); reload(); }}
        />
      )}
    </div>
  );
}

function SummaryTile({ icon: Icon, label, value, tone, hint }: { icon: LucideIcon; label: string; value: number | string; tone: "brand" | "warning" | "neutral"; hint?: string }) {
  const tones = { brand: "bg-primary-soft text-primary", warning: "bg-warning-soft text-warning-ink", neutral: "bg-surface-muted text-ink-muted" };
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-sm" title={hint}>
      <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tones[tone])}><Icon className="h-5 w-5" aria-hidden="true" /></span>
      <div className="min-w-0">
        <p className="text-caption text-ink-muted">{label}</p>
        <p className="truncate text-heading font-bold tabular-nums text-ink-strong">{value}</p>
      </div>
    </div>
  );
}

function InboxRow({ item, now, readOnly, onAction }: { item: InboxItem; now: number; readOnly: boolean; onAction: (action: InboxAction) => void }) {
  const moduleInfo = MODULES[item.module];
  const stale = now - new Date(item.submitted_at).getTime() > 3 * DAY;
  const approve = item.actions.find((action) => action.code === "approve");
  const others = item.actions.filter((action) => action.code !== "approve");
  return (
    <li className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-surface-hover sm:px-6 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 gap-3">
        <IconTile icon={moduleInfo.icon} accent={moduleInfo.accent} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {item.route ? (
              <Link href={item.route} className="truncate font-semibold text-ink-strong hover:text-primary hover:underline">{item.title}</Link>
            ) : (
              <p className="truncate font-semibold text-ink-strong">{item.title}</p>
            )}
            {item.reference && <span className="rounded-md bg-surface-muted px-1.5 py-0.5 font-mono text-caption text-ink-muted">{item.reference}</span>}
          </div>
          {item.subtitle && <p className="truncate text-support text-ink-muted">{item.subtitle}</p>}
          <p className="mt-0.5 text-caption text-ink-subtle">
            {moduleInfo.label}
            {item.requested_by && <> · {item.requested_by}</>}
            {" · "}
            <span className={cx(stale && "font-semibold text-warning-ink")} title={formatDateTime(item.submitted_at)}>submitted {waited(item.submitted_at, now)}</span>
          </p>
          {item.blocked_reason && <p className="mt-1.5 flex items-center gap-1.5 text-caption text-ink-muted"><Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{item.blocked_reason}</p>}
          {item.note && !item.blocked_reason && <p className="mt-1.5 text-caption text-ink-muted">{item.note}</p>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 pl-12 lg:pl-0">
        {item.amount !== null && <p className="mr-2 font-semibold tabular-nums text-ink-strong">{formatAmount(item.amount, item.currency || undefined)}</p>}
        {!readOnly && others.map((action) => (
          <Button key={action.code} size="sm" variant="secondary" className={action.tone === "danger" ? "text-danger-ink" : undefined} leadingIcon={action.code === "return" ? <Undo2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />} onClick={() => onAction(action)}>{action.label}</Button>
        ))}
        {!readOnly && approve && <Button size="sm" leadingIcon={<Check className="h-3.5 w-3.5" />} onClick={() => onAction(approve)}>Approve</Button>}
        {item.actions.length === 0 && item.route && (
          <Link href={item.route} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-support font-semibold text-ink-strong hover:bg-surface-hover">
            {item.blocked_reason ? "View" : "Review"} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>
    </li>
  );
}

function DecisionRow({ decision }: { decision: InboxDecision }) {
  const outcome = OUTCOMES[decision.outcome] ?? { label: decision.outcome.charAt(0) + decision.outcome.slice(1).toLowerCase(), tone: "text-ink-muted", icon: History };
  const OutcomeIcon = outcome.icon;
  const body = (
    <>
      <span className={cx("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted", outcome.tone)}><OutcomeIcon className="h-3.5 w-3.5" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-strong">{decision.label} <span className={cx("font-medium", outcome.tone)}>{outcome.label.toLowerCase()}</span></p>
        <p className="text-caption text-ink-muted">{decision.is_mine ? "By you" : `By ${decision.actor_name || "a former member"}`} · {formatDateTime(decision.acted_at)}</p>
        {decision.comment && <p className="mt-1 line-clamp-2 text-caption text-ink">&ldquo;{decision.comment}&rdquo;</p>}
      </div>
    </>
  );
  return (
    <li>
      {decision.route ? (
        <Link href={decision.route} className="flex gap-3 px-5 py-3.5 transition-colors hover:bg-surface-hover sm:px-6">{body}</Link>
      ) : (
        <div className="flex gap-3 px-5 py-3.5 sm:px-6">{body}</div>
      )}
    </li>
  );
}

function DecisionDialog({ item, action, onClose, onDone }: { item: InboxItem; action: InboxAction; onClose: () => void; onDone: (message: string) => void }) {
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const missing = action.comment_required && !comment.trim();
  const past = { approve: "Approved", reject: "Rejected", return: "Returned" }[action.code];
  const submit = async () => {
    setSaving(true);
    setFailure(null);
    try {
      await workflowsApi.runInboxAction(action, comment.trim());
      onDone(`${past}: ${item.title}`);
    } catch (caught) {
      setFailure(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };
  const verb = action.code === "approve" ? "Approve" : action.code === "reject" ? "Reject" : action.label;
  return (
    <Dialog
      open
      onClose={onClose}
      title={action.code === "return" ? "Send this request back for changes?" : `${verb} this request?`}
      description={action.code === "approve" ? "The requester is notified once your decision is recorded." : action.code === "return" ? "It goes back to the requester to change and resubmit." : "The request is closed and the requester is notified."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant={action.code === "reject" ? "danger" : "primary"} loading={saving} disabled={missing} onClick={() => void submit()}>{verb}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-line-soft bg-surface-muted p-3">
          <p className="font-semibold text-ink-strong">{item.title}</p>
          {item.subtitle && <p className="text-support text-ink-muted">{item.subtitle}</p>}
          {item.amount !== null && <p className="mt-1 text-support font-semibold tabular-nums text-ink-strong">{formatAmount(item.amount, item.currency || undefined)}</p>}
        </div>
        {action.comment_key && (
          <Field label={action.code === "approve" ? "Comment" : "Reason"} optional={!action.comment_required} required={action.comment_required}>
            <Textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} placeholder={action.code === "approve" ? "Optional note for the requester." : "Tell the requester what to change or why it was declined."} />
          </Field>
        )}
        {failure && <p className="text-support text-danger-ink">{failure}</p>}
      </div>
    </Dialog>
  );
}
