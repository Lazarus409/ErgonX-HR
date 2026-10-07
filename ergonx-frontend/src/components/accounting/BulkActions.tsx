"use client";

import { useCallback, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Archive,
  Ban,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Info,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Workflow,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Dialog, Drawer } from "@/components/ui/Overlay";
import ErrorState from "@/components/ui/ErrorState";
import { accountingApi, getApiErrorMessage } from "@/lib/api";
import { cx } from "@/lib/cx";
import { formatAmount, formatDateTime, formatNumber } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import type { BatchJob, BulkOperationGroup, BulkOperationPreview } from "@/types/accounting";

const OPERATION_ICONS: Record<string, LucideIcon> = { hold: PauseCircle, release: PlayCircle, submit: Send, approve: CheckCircle2, void: Ban, delete: Trash2, archive: Archive };

const GROUPS: Array<{ group: BulkOperationGroup; title: string; hint: string; icon: LucideIcon; tone: string; frame: string }> = [
  { group: "safe", title: "Safe operations", hint: "Reversible, no financial impact", icon: ShieldCheck, tone: "bg-success-soft text-success-ink", frame: "border-success/25" },
  { group: "workflow", title: "Workflow operations", hint: "Moves the process forward", icon: Workflow, tone: "bg-primary-soft text-primary-ink", frame: "border-primary/25" },
  { group: "restricted", title: "Restricted operations", hint: "Higher risk, additional checks", icon: ShieldAlert, tone: "bg-danger-soft text-danger-ink", frame: "border-danger/25" },
];

const JOB_STATUS: Record<BatchJob["status"], { label: string; icon: LucideIcon; tone: string }> = {
  QUEUED: { label: "Queued", icon: Clock, tone: "text-ink-strong" },
  PROCESSING: { label: "Processing", icon: RefreshCw, tone: "text-primary-ink" },
  COMPLETED: { label: "Completed", icon: CheckCircle2, tone: "text-success-ink" },
  PARTIAL: { label: "Partial success", icon: AlertTriangle, tone: "text-warning-ink" },
  FAILED: { label: "Failed", icon: XCircle, tone: "text-danger-ink" },
};

function plural(count: number, noun: string) {
  return `${formatNumber(count)} ${count === 1 ? noun : `${noun}s`}`;
}

/**
 * Concept "Bulk actions and batch governance": pick an action from governed groups, review its real impact
 * (the backend dry-runs every record through its own rules), then run it on the eligible records only.
 */
type BulkActionsPanelProps = {
  open: boolean;
  ids: string[];
  noun?: string;
  initialOperation?: string;
  onClose: () => void;
  onClearSelection: () => void;
  onComplete: (job: BatchJob) => void;
};

export function BulkActionsPanel(props: BulkActionsPanelProps) {
  // Mount fresh for every selection so no state carries over between runs.
  return props.open ? <BulkActionsDrawer key={`${props.ids.join(",")}|${props.initialOperation ?? ""}`} {...props} /> : null;
}

function BulkActionsDrawer({ open, ids, noun = "bill", initialOperation, onClose, onClearSelection, onComplete }: BulkActionsPanelProps) {
  const idKey = ids.join(",");
  const loadPreview = useCallback(() => accountingApi.previewVendorBillBulk(idKey ? idKey.split(",") : []), [idKey]);
  const { data: preview, error: loadError } = useApiResource(loadPreview);
  const [choice, setChoice] = useState<string | undefined>(initialOperation);
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [job, setJob] = useState<BatchJob | null>(null);

  const currency = preview?.currencies.length === 1 ? preview.currencies[0] : undefined;
  const operation = preview?.operations.find((item) => item.code === choice && (item.available || item.ineligible.length > 0));
  const needsReason = Boolean(operation?.needs_reason);
  const needsConfirm = Boolean(operation?.confirm_text);
  const ready = Boolean(operation?.available) && (!needsReason || reason.trim()) && (!needsConfirm || confirmText.trim().toUpperCase() === operation?.confirm_text);

  const run = async () => {
    if (!operation || !ready) return;
    setRunning(true); setRunError("");
    try {
      const result = await accountingApi.executeVendorBillBulk({ ids: operation.eligible, operation: operation.code, reason: reason.trim() || undefined, confirm_text: confirmText.trim() || undefined });
      setJob(result);
      onComplete(result);
    } catch (caught) {
      setRunError(getApiErrorMessage(caught));
    } finally {
      setRunning(false);
    }
  };

  const footer = job ? (
    <Button onClick={onClose}>Done</Button>
  ) : (
    <div className="w-full space-y-1.5 text-center">
      <Button className="w-full" size="lg" disabled={!ready} loading={running} onClick={() => void run()}>
        {operation ? `${operation.label} ${plural(operation.eligible.length, noun)}` : "Choose an action"}
      </Button>
      <p className="text-caption text-ink-muted">
        {!operation ? "Select an action to review its impact"
          : !operation.available ? `No selected ${noun} can take this action`
          : needsReason && !reason.trim() ? "Give a reason to continue"
          : needsConfirm && !ready ? `Type ${operation.confirm_text} to continue`
          : operation.ineligible.length ? `${plural(operation.ineligible.length, noun)} will be skipped; only eligible ${noun}s are included`
          : "Each change is recorded in the audit trail"}
      </p>
    </div>
  );

  return (
    <Drawer open={open} onClose={onClose} title="Bulk Actions" description={`Perform actions on multiple ${noun}s with governance and checks.`} footer={footer}>
      {loadError && <ErrorState variant="inline" title="Unable to check the selection" message={loadError} />}
      {!preview && !loadError && <div className="space-y-3">{[0, 1, 2, 3].map((index) => <div key={index} className="skeleton h-14 rounded-xl" />)}</div>}
      {preview && job && <JobResult job={job} currency={currency} />}
      {preview && !job && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary-soft/50 p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface text-primary-ink"><FileText className="h-6 w-6" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-headline">{plural(preview.count, noun)} selected</p>
              <p className="text-sm text-ink">Total amount: <span className="tabular-nums">{formatAmount(preview.total_amount, currency)}</span>{preview.currencies.length > 1 && <span className="text-ink-muted"> (mixed currencies)</span>}</p>
            </div>
            <button type="button" onClick={() => { onClearSelection(); onClose(); }} className="text-sm font-semibold text-primary-ink hover:underline">Clear selection</button>
          </div>

          <section>
            <h3 className="mb-2 font-bold text-headline">1. Select an action</h3>
            <div className="space-y-3">
              {GROUPS.map(({ group, title, hint, icon: GroupIcon, tone, frame }) => {
                const items = preview.operations.filter((item) => item.group === group);
                if (!items.length) return null;
                return (
                  <div key={group} className={cx("overflow-hidden rounded-xl border", frame)}>
                    <div className={cx("flex items-center justify-between gap-3 px-3 py-2 text-sm", tone)}>
                      <span className="flex items-center gap-2 font-semibold"><GroupIcon className="h-4 w-4" aria-hidden="true" />{title}</span>
                      <span className="text-caption">{hint}</span>
                    </div>
                    <div className="divide-y divide-line-soft">
                      {items.map((item) => <OperationRow key={item.code} item={item} noun={noun} selected={choice === item.code} onSelect={() => { setChoice(item.code); setReason(""); setConfirmText(""); setRunError(""); }} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {operation && (
            <section>
              <h3 className="mb-2 font-bold text-headline">2. Review impact</h3>
              <div className="grid grid-cols-3 divide-x divide-line-soft rounded-xl border border-line p-3 text-center">
                <Stat value={formatNumber(operation.eligible.length)} label={`${noun[0].toUpperCase()}${noun.slice(1)}s affected`} />
                <Stat value={formatAmount(operation.eligible_amount, currency)} label="Total amount" />
                <Stat value={formatNumber(operation.ineligible.length)} label="Cannot be actioned" tone={operation.ineligible.length ? "text-danger-ink" : undefined} />
              </div>
              {operation.ineligible.length ? (
                <div className="mt-3 rounded-xl border border-warning/30 bg-warning-soft/60 p-3 text-sm">
                  <p className="flex items-center justify-between gap-2 font-semibold text-warning-ink"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" aria-hidden="true" />Dependency checks</span><span>{plural(operation.ineligible.length, "issue")} found</span></p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-ink">
                    {operation.ineligible.slice(0, 6).map((item) => <li key={item.id}><span className="font-semibold">{item.reference}</span>: {item.reason}</li>)}
                    {operation.ineligible.length > 6 && <li>and {plural(operation.ineligible.length - 6, noun)} more</li>}
                    <li>{operation.eligible.length === 1 ? `1 other ${noun} is` : `All other ${noun}s (${formatNumber(operation.eligible.length)}) are`} eligible.</li>
                  </ul>
                </div>
              ) : (
                <p className="mt-3 flex items-center gap-2 rounded-xl border border-success/25 bg-success-soft/60 p-3 text-sm text-success-ink"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />All selected {noun}s passed the checks for this action.</p>
              )}
              {needsReason && (
                <label className="mt-4 block text-sm">
                  <span className="mb-1 block font-semibold text-ink-strong">Reason <span className="text-danger-ink">*</span></span>
                  <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} placeholder="Recorded on every affected record's audit trail" className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" />
                </label>
              )}
              {needsConfirm && (
                <label className="mt-3 block text-sm">
                  <span className="mb-1 block font-semibold text-ink-strong">Type <span className="font-mono">{operation.confirm_text}</span> to confirm</span>
                  <input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} autoComplete="off" className="h-10 w-full rounded-lg border border-danger/40 bg-surface px-3 font-mono text-sm" />
                </label>
              )}
              {runError && <div className="mt-3"><ErrorState variant="inline" title="The bulk action did not run" message={runError} /></div>}
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}

function OperationRow({ item, noun, selected, onSelect }: { item: BulkOperationPreview; noun: string; selected: boolean; onSelect: () => void }) {
  const Icon = OPERATION_ICONS[item.code] ?? FileText;
  // Blocked only by the selection: still selectable so the dependency checks explain why.
  if (!item.available && !item.ineligible.length) {
    return (
      <div className="bg-surface-muted/60 px-3 py-3 text-ink-muted">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1"><p className="font-semibold">{item.label}</p><p className="text-caption">{item.description}</p></div>
          <span className="flex items-center gap-1 text-caption">Not available<Info className="h-3.5 w-3.5" aria-hidden="true" /></span>
        </div>
        <p className="mt-2 flex gap-1.5 text-caption"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{item.unavailable_reason}</p>
      </div>
    );
  }
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} className={cx("flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-surface-hover", selected && "bg-primary-soft/50 ring-2 ring-inset ring-primary/40")}>
      <Icon className={cx("h-5 w-5 shrink-0", item.group === "restricted" ? "text-danger-ink" : "text-ink-strong")} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink-strong">{item.label}</span>
        <span className="block text-caption text-ink-muted">{item.description}{!item.available ? " · Not available for this selection" : item.ineligible.length ? ` · ${formatNumber(item.eligible.length)} of ${formatNumber(item.eligible.length + item.ineligible.length)} ${noun}s eligible` : ""}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
    </button>
  );
}

function Stat({ value, label, tone }: { value: ReactNode; label: string; tone?: string }) {
  return <div className="px-2"><p className={cx("text-lg font-bold tabular-nums", tone ?? "text-ink-strong")}>{value}</p><p className="text-caption text-ink-muted">{label}</p></div>;
}

function JobResult({ job, currency }: { job: BatchJob; currency?: string }) {
  const meta = JOB_STATUS[job.status];
  const Icon = meta.icon;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl border border-line p-4">
        <Icon className={cx("h-8 w-8", meta.tone)} aria-hidden="true" />
        <div><p className={cx("font-bold", meta.tone)}>{meta.label}</p><p className="text-sm text-ink">{job.operation_label}: {formatNumber(job.succeeded)} succeeded, {formatNumber(job.failed)} failed · {formatAmount(job.total_amount, currency)}</p></div>
      </div>
      <JobResultsTable job={job} />
    </div>
  );
}

function JobResultsTable({ job }: { job: BatchJob }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-surface-muted text-left text-caption font-semibold text-ink-strong"><tr><th className="px-3 py-2">Record</th><th className="px-3 py-2">Result</th></tr></thead>
      <tbody className="divide-y divide-line-soft">
        {job.results.map((item) => (
          <tr key={item.id}>
            <td className="px-3 py-2 font-medium text-ink-strong">{item.reference}</td>
            <td className="px-3 py-2">{item.status === "succeeded" ? <span className="flex items-center gap-1.5 text-success-ink"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Succeeded</span> : <span className="flex items-start gap-1.5 text-danger-ink"><XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{item.message || "Failed"}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** "Recent batch jobs" strip with per-job reports and retry of the records that failed. */
export function RecentBatchJobs({ jobs, total, noun = "bill", onRetry, onViewAll }: { jobs: BatchJob[]; total: number; noun?: string; onRetry: (job: BatchJob) => void; onViewAll?: () => void }) {
  const [report, setReport] = useState<BatchJob | null>(null);
  if (!jobs.length) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-heading font-bold text-headline">Recent Batch Jobs</h2>
        {onViewAll && total > jobs.length && <button type="button" onClick={onViewAll} className="inline-flex items-center gap-1 text-sm font-semibold text-primary-ink hover:underline">View all jobs<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {jobs.map((job) => {
          const meta = JOB_STATUS[job.status];
          const Icon = meta.icon;
          return (
            <article key={job.id} className="flex flex-col rounded-xl border border-line p-4 text-sm">
              <p className={cx("flex items-center gap-2 font-semibold", meta.tone)}><Icon className="h-5 w-5" aria-hidden="true" />{meta.label}</p>
              <p className="mt-2 text-ink">{job.operation_label} {noun}s</p>
              <p className="mt-2 text-ink-muted">{plural(job.total_items, "item")}</p>
              {job.status === "PARTIAL" && <p className="text-ink-muted">{formatNumber(job.succeeded)} succeeded, {formatNumber(job.failed)} failed</p>}
              {job.status === "FAILED" && <p className="text-ink-muted">{job.results[0]?.message || "No records changed"}</p>}
              <p className="text-ink-muted">{formatDateTime(job.completed_at ?? job.created_at)}</p>
              {job.created_by && <p className="text-caption text-ink-muted">by {job.created_by}</p>}
              <div className="mt-auto flex gap-3 pt-3">
                {(job.status === "PARTIAL" || job.status === "FAILED") && <button type="button" onClick={() => onRetry(job)} className="font-semibold text-primary-ink hover:underline">Retry</button>}
                <button type="button" onClick={() => setReport(job)} className="font-semibold text-primary-ink hover:underline">View report</button>
              </div>
            </article>
          );
        })}
      </div>
      <Dialog open={Boolean(report)} onClose={() => setReport(null)} title={report ? `${report.operation_label}: batch report` : ""} description={report ? `${JOB_STATUS[report.status].label} · ${formatDateTime(report.completed_at ?? report.created_at)}${report.created_by ? ` · ${report.created_by}` : ""}${report.reason ? ` · Reason: ${report.reason}` : ""}` : undefined} size="lg">
        {report && <JobResultsTable job={report} />}
      </Dialog>
    </section>
  );
}
