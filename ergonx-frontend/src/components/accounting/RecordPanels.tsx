"use client";

import { useRef, useState } from "react";
import { Clock3, Download, FileText, Paperclip, Upload } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { accountingApi, getApiErrorMessage } from "@/lib/api";
import { cx } from "@/lib/cx";
import { formatDateTime, humanizeEnum } from "@/lib/format";
import type { RecordAttachment, RecordAuditEntry } from "@/types/accounting";

/** Shared panels for accounting record detail pages (bills, invoices). */
export function Panel({ icon: Icon, title, description, action, children, className }: { icon: typeof FileText; title: string; description?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-2xl border border-line bg-surface p-5 shadow-elevation-1", className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3"><Icon className="mt-0.5 h-6 w-6 shrink-0 text-section-icon" aria-hidden="true" /><div><h2 className="text-heading font-bold text-headline">{title}</h2>{description && <p className="text-support text-heading-support">{description}</p>}</div></div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ icon: Icon, title, text }: { icon: typeof FileText; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-ink-muted"><Icon className="h-6 w-6" aria-hidden="true" /></span>
      <p className="mt-2 font-bold text-headline">{title}</p>
      <p className="mt-0.5 max-w-sm text-support text-ink-muted">{text}</p>
    </div>
  );
}

export function AttachmentsPanel({ resource, recordId, attachments, canUpload, onChanged }: { resource: "vendor-bills" | "invoices" | "budgets"; recordId: string; attachments: RecordAttachment[]; canUpload: boolean; onChanged: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const upload = async (file: File) => {
    setProgress(0);
    setProblem(null);
    try { await accountingApi.uploadRecordAttachment(resource, recordId, file, setProgress); onChanged(); } catch (caught) { setProblem(getApiErrorMessage(caught)); } finally { setProgress(null); if (ref.current) ref.current.value = ""; }
  };
  const download = async (file: RecordAttachment) => {
    const blob = await accountingApi.downloadRecordAttachment(resource, recordId, file.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.original_filename;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Panel icon={Paperclip} title={`Attachments (${attachments.length})`} action={canUpload ? <Button variant="secondary" size="sm" onClick={() => ref.current?.click()}>Add file</Button> : undefined}>
      <input ref={ref} type="file" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
      {canUpload && (
        <button type="button" onClick={() => ref.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) void upload(file); }}
          className={cx("flex w-full flex-col items-center rounded-xl border-2 border-dashed px-3 py-4 text-sm", dragging ? "border-primary bg-primary-soft/50" : "border-line-strong")}>
          <Upload className="h-6 w-6 text-ink-muted" aria-hidden="true" /><span className="mt-1 font-medium text-ink-strong">{progress !== null ? `Uploading ${progress}%` : "Drag and drop files here"}</span><span className="text-caption text-ink-muted">or click to browse</span>
        </button>
      )}
      {problem && <p className="mt-2 text-sm text-danger-ink">{problem}</p>}
      {attachments.length ? (
        <ul className="mt-3 divide-y divide-line-soft">
          {attachments.map((file) => <li key={file.id} className="flex items-center gap-2 py-2 text-sm"><FileText className="h-4 w-4 text-section-icon" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{file.original_filename}</span><span className="text-caption text-ink-muted">{Math.max(1, Math.round(file.size_bytes / 1024))} KB</span><Button variant="ghost" size="sm" aria-label={`Download ${file.original_filename}`} onClick={() => void download(file)}><Download className="h-4 w-4" /></Button></li>)}
        </ul>
      ) : <p className="mt-2 text-caption text-ink-muted">No attachments have been added.</p>}
    </Panel>
  );
}

export function AuditPanel({ entries, labels, historyHref }: { entries: RecordAuditEntry[]; labels: Record<string, string>; historyHref?: string }) {
  const [all, setAll] = useState(false);
  return (
    <Panel icon={Clock3} title={`Audit History (${entries.length})`} action={entries.length > 5 ? <button type="button" onClick={() => setAll((current) => !current)} className="text-sm font-semibold text-primary-ink hover:underline">{all ? "Show recent" : "View all"}</button> : undefined}>
      {entries.length ? (
        <ol className="space-y-3">
          {(all ? entries : entries.slice(0, 5)).map((entry) => (
            <li key={entry.id} className="flex gap-3 text-sm">
              <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
              <span><span className="block font-semibold text-ink-strong">{labels[entry.action] ?? humanizeEnum(entry.action.split(".").slice(-1)[0])}</span><span className="text-caption text-ink-muted">{entry.actor} · {formatDateTime(entry.created_at)}</span>{typeof entry.metadata?.reason === "string" && entry.metadata.reason && <span className="block text-caption text-ink">“{entry.metadata.reason}”</span>}</span>
            </li>
          ))}
        </ol>
      ) : <Empty icon={FileText} title="No audit history available" text="Audit events will appear here when data is available." />}
      {historyHref && <a href={historyHref} className="mt-3 inline-block text-sm font-semibold text-primary-ink hover:underline">Full history &amp; lineage →</a>}
    </Panel>
  );
}
