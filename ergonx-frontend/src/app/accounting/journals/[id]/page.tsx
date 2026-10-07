"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, CheckCircle2, Clock3, Download, ExternalLink, FileSearch, FileText, Info, Lock, Paperclip, Printer, RotateCcw, Scale, Send, ShieldCheck, Upload, UsersRound, XCircle } from "lucide-react";

import { PrintFooter, PrintMasthead } from "@/components/brand/PrintDocument";
import { Button } from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { Dialog, Menu, MenuItem } from "@/components/ui/Overlay";
import StatusBadge from "@/components/ui/StatusBadge";
import Tabs from "@/components/ui/Tabs";
import { accountingApi, getApiErrorMessage } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { cx } from "@/lib/cx";
import { EM_DASH, formatAmount, formatDate, formatDateTime, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";

type Action = "submit" | "approve" | "post" | "void" | "reverse";
type Tab = "lines" | "related" | "notes" | "attachments";
const ACTION_COPY: Record<Action, { title: string; description: string; label: string; destructive?: boolean; permission: string }> = {
  submit: { title: "Submit journal", description: "Submit this balanced draft for approval.", label: "Submit for approval", permission: "journal.create" },
  approve: { title: "Approve journal", description: "Approve this journal for posting.", label: "Approve", permission: "journal.approve" },
  post: { title: "Post journal", description: "Posting is irreversible and makes the journal immutable.", label: "Post to ledger", destructive: true, permission: "journal.post" },
  void: { title: "Void journal", description: "Void this unposted journal. This cannot be undone.", label: "Void", destructive: true, permission: "journal.create" },
  reverse: { title: "Reverse journal", description: "Create a new reversing journal in the selected accounting period.", label: "Reverse", destructive: true, permission: "journal.reverse" },
};
const AUDIT_LABELS: Record<string, string> = {
  "accounting.journal.created": "Journal created",
  "accounting.journal.submitted": "Submitted for approval",
  "accounting.journal.approved": "Approved",
  "accounting.journal.posted": "Posted to the ledger",
  "accounting.journal.voided": "Voided",
  "accounting.journal.reversed": "Reversal created",
  "accounting.journal.note_added": "Note added",
  "accounting.journal.attachment_added": "Attachment added",
};

/** Concept "Journal entry detail". */
export default function JournalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, user } = useAccess();
  const load = useCallback(async () => {
    const [journal, context, periods] = await Promise.all([
      accountingApi.getJournalEntry(id),
      accountingApi.getJournalContext(id).catch(() => null),
      accountingApi.listAccountingPeriods({ page_size: MAX_PAGE_SIZE, ordering: "start_date" }).then((page) => page.results).catch(() => []),
    ]);
    return { journal, context, periods };
  }, [id]);
  const { data, loading, error, reload } = useApiResource(load);
  const [tab, setTab] = useState<Tab>("lines");
  const [pending, setPending] = useState<Action | null>(null);
  const [acting, setActing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [reversePeriod, setReversePeriod] = useState("");
  const [reverseDate, setReverseDate] = useState(new Date().toISOString().slice(0, 10));
  const [reverseDescription, setReverseDescription] = useState("");
  const [note, setNote] = useState("");
  const [allAudit, setAllAudit] = useState(false);

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState title="Unable to load journal" message={error ?? "This journal could not be found."} onRetry={reload} />;
  const { journal, context, periods } = data;
  const candidates: Action[] = journal.status === "DRAFT" ? ["submit", "void"] : journal.status === "PENDING_APPROVAL" ? ["approve", "void"] : journal.status === "APPROVED" ? ["post", "void"] : journal.status === "POSTED" && !journal.reversal_of ? ["reverse"] : [];
  const actions = candidates.filter((action) => can(ACTION_COPY[action].permission));
  const primary = actions.find((action) => action !== "void" && action !== "reverse") ?? null;
  // Separation of duties (BQ-04, default on): a journal's creator does not approve it; the API enforces this.
  const ownJournalAwaitingApproval = journal.status === "PENDING_APPROVAL" && journal.source === "MANUAL" && user?.id === journal.created_by;
  const debit = Number(journal.total_debit ?? 0);
  const credit = Number(journal.total_credit ?? 0);
  const balanced = Math.abs(debit - credit) < 0.005 && debit > 0;
  const posted = journal.status === "POSTED" || journal.status === "REVERSED";
  const audit = context?.audit ?? [];

  const run = async () => {
    if (!pending) return;
    if (pending === "reverse" && (!reversePeriod || !reverseDate)) { setProblem("Select an open accounting period and reversal date."); return; }
    setActing(true);
    setProblem(null);
    try {
      if (pending === "reverse") await accountingApi.reverseJournalEntry(journal.id, { accounting_period: reversePeriod, entry_date: reverseDate, description: reverseDescription.trim() });
      else await { submit: accountingApi.submitJournalEntry, approve: accountingApi.approveJournalEntry, post: accountingApi.postJournalEntry, void: accountingApi.voidJournalEntry }[pending](journal.id);
      setPending(null);
      reload();
    } catch (caught) {
      setPending(null);
      setProblem(getApiErrorMessage(caught));
    } finally {
      setActing(false);
    }
  };
  const addNote = async () => {
    if (!note.trim()) return;
    try { await accountingApi.addJournalNote(journal.id, note.trim()); setNote(""); reload(); } catch (caught) { setProblem(getApiErrorMessage(caught)); }
  };

  return (
    <div className="space-y-5">
      <PrintMasthead documentTitle="Journal entry" reference={journal.journal_number} />
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted print:hidden"><Link href="/accounting/dashboard" className="hover:underline">Accounting</Link><ChevronRight className="mx-1 inline h-4 w-4" aria-hidden="true" /><Link href="/accounting/journals" className="hover:underline">General Ledger</Link><ChevronRight className="mx-1 inline h-4 w-4" aria-hidden="true" /><span className="font-medium text-ink-strong">Journal Entry Detail</span></nav>
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">Journal Entry Detail</h1>
          <p className="mt-1.5 text-[1.0625rem] text-heading-support">View journal entry details, related information and approval status.</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link href="/accounting/journals" className="inline-flex h-12 items-center gap-2 rounded-lg border border-primary px-4 font-semibold text-primary-ink hover:bg-primary-soft/50"><ChevronLeft className="h-5 w-5" aria-hidden="true" />Back to General Ledger</Link>
          <Menu label="Actions" trigger={(props) => <Button {...props} variant="secondary" size="lg" trailingIcon={<ChevronDown className="h-4 w-4" />}>Actions</Button>}>
            {(close) => (
              <div className="p-1.5">
                {actions.map((action) => <MenuItem key={action} tone={ACTION_COPY[action].destructive && action !== "post" ? "danger" : "default"} icon={action === "reverse" ? <RotateCcw className="h-4 w-4" /> : action === "void" ? <XCircle className="h-4 w-4" /> : <Send className="h-4 w-4" />} onSelect={() => { close(); setProblem(null); setPending(action); }}>{ACTION_COPY[action].label}</MenuItem>)}
                <MenuItem icon={<Printer className="h-4 w-4" />} onSelect={() => { close(); window.print(); }}>Print</MenuItem>
              </div>
            )}
          </Menu>
          {primary && <Button size="lg" onClick={() => { setProblem(null); setPending(primary); }}>{ACTION_COPY[primary].label}</Button>}
          {ownJournalAwaitingApproval && <p className="basis-full text-right text-caption text-ink-muted">You created this journal. With separation of duties on (the default), another approver must approve it.</p>}
        </div>
      </header>

      {problem && <ErrorState variant="inline" title="Action not completed" message={problem} />}

      <section className="grid gap-5 rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,1fr)] lg:divide-x lg:divide-line-soft">
        <div className="flex items-start gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-muted"><FileText className="h-7 w-7" aria-hidden="true" /></span>
          <div className="min-w-0"><p className="font-semibold text-ink-strong">Journal Entry</p><p className="text-[1.375rem] font-bold text-headline">{journal.journal_number}</p><p className="text-sm text-ink-muted">{journal.description || "No description provided"}</p></div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4 lg:pl-5">
          {([["Source", humanizeEnum(journal.source)], ["Reference", journal.reference || EM_DASH], ["Posting date", formatDate(journal.entry_date)], ["Period", journal.period_name ?? periods.find((item) => item.id === journal.accounting_period)?.name ?? EM_DASH], ["Created by", journal.created_by_name ?? EM_DASH], ["Created on", formatDate(journal.created_at)], ["Last modified", formatDateTime(journal.updated_at)], ["Posted by", journal.posted_by_name ?? EM_DASH]] as const).map(([label, value]) => (
            <div key={label} className="min-w-0"><dt className="text-caption text-ink-muted">{label}</dt><dd className="truncate font-medium text-ink-strong" title={value}>{value}</dd></div>
          ))}
        </dl>
        <div className="lg:pl-5">
          <p className="text-sm font-semibold text-ink-strong">Status</p>
          <div className="mt-2"><StatusBadge status={journal.status} /></div>
          <p className="mt-2 text-caption text-ink-muted">{posted ? `Posted ${formatDateTime(journal.posted_at)}. Posted journals are read-only; corrections use a reversal.` : "This journal entry has not been posted."}</p>
        </div>
      </section>

      <div className="print:hidden"><Tabs label="Journal sections" value={tab} onChange={(value) => setTab(value as Tab)} items={[{ value: "lines", label: "Journal Lines" }, { value: "related", label: "Related Records", count: context?.related.length }, { value: "notes", label: "Notes", count: context?.notes.length }, { value: "attachments", label: "Attachments", count: context?.attachments.length }]} /></div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {tab === "lines" && (
            <section className="rounded-2xl border border-line bg-surface shadow-elevation-1">
              <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
                <h2 className="flex items-center gap-2 text-heading font-bold text-headline"><FileText className="h-6 w-6 text-section-icon" aria-hidden="true" />Journal Lines ({journal.lines.length})</h2>
                <Link href="/accounting/journals" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-primary px-3 text-sm font-semibold text-primary-ink hover:bg-primary-soft/50 print:hidden">View in General Ledger<ExternalLink className="h-4 w-4" aria-hidden="true" /></Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="bg-surface-muted text-left text-caption font-semibold text-ink-strong"><tr><th className="px-4 py-2">Line</th><th className="px-4 py-2">Account</th><th className="px-4 py-2">Description</th><th className="px-4 py-2">Department / Functional Area</th><th className="px-4 py-2">Project</th><th className="px-4 py-2 text-right">Debit</th><th className="px-4 py-2 text-right">Credit</th></tr></thead>
                  <tbody className="divide-y divide-line-soft">
                    {journal.lines.map((line, index) => (
                      <tr key={line.id}>
                        <td className="px-4 py-2.5 text-ink-muted">{index + 1}</td>
                        <td className="px-4 py-2.5 font-medium text-ink-strong">{line.account_code ? `${line.account_code} ${line.account_name}` : line.account}</td>
                        <td className="px-4 py-2.5">{line.description || EM_DASH}</td>
                        <td className="px-4 py-2.5 text-ink-muted">{line.department_name ?? EM_DASH}</td>
                        <td className="px-4 py-2.5 text-ink-muted">{line.project || EM_DASH}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{Number(line.debit) ? formatAmount(line.debit) : EM_DASH}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{Number(line.credit) ? formatAmount(line.credit) : EM_DASH}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!journal.lines.length && <div className="flex flex-col items-center py-12 text-center"><FileText className="h-10 w-10 text-ink-subtle" aria-hidden="true" /><p className="mt-2 font-bold text-headline">No journal lines available</p></div>}
              </div>
              <div className="grid gap-3 border-t border-line-soft p-4 sm:grid-cols-3">
                <div><p className="text-caption text-ink-muted">Total Debits</p><p className="text-heading font-bold tabular-nums">{formatAmount(journal.total_debit ?? 0)}</p></div>
                <div><p className="text-caption text-ink-muted">Total Credits</p><p className="text-heading font-bold tabular-nums">{formatAmount(journal.total_credit ?? 0)}</p></div>
                <div className={cx("flex items-center gap-3 rounded-xl p-3", balanced ? "bg-success-soft" : "bg-danger-soft")}>{balanced ? <CheckCircle2 className="h-8 w-8 text-success" aria-hidden="true" /> : <Scale className="h-8 w-8 text-danger" aria-hidden="true" />}<div><p className={cx("font-semibold", balanced ? "text-success-ink" : "text-danger-ink")}>{balanced ? "In balance" : "Out of balance"}</p><p className="text-caption tabular-nums text-ink-muted">Difference {formatAmount(Math.abs(debit - credit))}</p></div></div>
              </div>
            </section>
          )}

          {tab === "related" && (
            <Panel icon={FileSearch} title="Related records" description="Source documents and linked journals.">
              {context?.related.length ? (
                <ul className="divide-y divide-line-soft">{context.related.map((row) => <li key={`${row.type}-${row.id}`} className="flex items-center gap-3 py-2.5 text-sm"><span className="w-36 shrink-0 text-ink-muted">{row.type}</span><span className="flex-1 font-semibold">{row.href ? <Link href={row.href} className="text-primary-ink hover:underline">{row.reference}</Link> : row.reference}</span>{row.status && <StatusBadge status={row.status} size="sm" />}</li>)}</ul>
              ) : <Empty icon={FileSearch} title="No related records" text={journal.source === "MANUAL" ? "Manual journals are not linked to source documents." : "No source documents reference this journal."} />}
            </Panel>
          )}

          {tab === "notes" && (
            <Panel icon={FileText} title="Notes" description="Preparer and reviewer notes. Notes are added to the audit trail.">
              {can("journal.view") && (
                <div className="mb-4 space-y-2">
                  <textarea rows={3} value={note} maxLength={4000} onChange={(event) => setNote(event.target.value)} placeholder="Add a note for reviewers…" aria-label="New note" className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" />
                  <div className="flex justify-end"><Button disabled={!note.trim()} onClick={() => void addNote()}>Add note</Button></div>
                </div>
              )}
              {context?.notes.length ? <ul className="space-y-3">{context.notes.map((row) => <li key={row.id} className="rounded-xl bg-surface-muted p-3 text-sm"><p className="whitespace-pre-wrap text-ink">{row.body}</p><p className="mt-1 text-caption text-ink-muted">{row.author} · {formatDateTime(row.created_at)}</p></li>)}</ul> : <Empty icon={FileText} title="No notes yet" text="Notes help reviewers understand the entry." />}
            </Panel>
          )}

          {tab === "attachments" && <AttachmentsPanel journalId={journal.id} attachments={context?.attachments ?? []} canUpload={can("journal.create")} onChanged={reload} expanded />}
        </div>

        <div className="space-y-5 print:hidden">
          <Panel icon={UsersRound} title="Approval workflow" description="">
            {context && !context.requires_approval ? (
              <div className="text-sm"><p className="font-semibold text-ink-strong">No approvals required</p><p className="text-ink-muted">{humanizeEnum(journal.source)} journals are generated by their source module and follow that module&apos;s controls.</p></div>
            ) : (
              <ol className="space-y-3 text-sm">
                <Step done title="Prepared" detail={`${journal.created_by_name ?? EM_DASH} · ${formatDate(journal.created_at)}`} />
                <Step done={["PENDING_APPROVAL", "APPROVED", "POSTED", "REVERSED"].includes(journal.status)} active={journal.status === "DRAFT"} title="Submitted for approval" detail={journal.status === "DRAFT" ? "Not yet submitted" : "Awaiting or completed"} />
                <Step done={Boolean(journal.approved_by_name)} active={journal.status === "PENDING_APPROVAL"} title="Approved" detail={journal.approved_by_name ?? "Pending"} />
                <Step done={posted} active={journal.status === "APPROVED"} title="Posted" detail={journal.posted_by_name ? `${journal.posted_by_name} · ${formatDateTime(journal.posted_at)}` : "Not posted"} />
              </ol>
            )}
            {journal.approved_by_name && journal.approved_by_name === journal.created_by_name && <p className="mt-3 flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-caption text-warning-ink"><Info className="h-4 w-4 shrink-0" aria-hidden="true" />Prepared and approved by the same person.</p>}
            {posted && <p className="mt-3 flex items-center gap-2 text-caption text-ink-muted"><Lock className="h-4 w-4" aria-hidden="true" />Posted journals are immutable.</p>}
          </Panel>
          {tab !== "attachments" && <AttachmentsPanel journalId={journal.id} attachments={context?.attachments ?? []} canUpload={can("journal.create")} onChanged={reload} />}
          <Panel icon={Clock3} title={`Audit events (${audit.length})`} description="" action={audit.length > 5 ? <button type="button" onClick={() => setAllAudit((current) => !current)} className="text-sm font-semibold text-primary-ink hover:underline">{allAudit ? "Show recent" : "View all"}</button> : undefined}>
            {audit.length ? (
              <ol className="space-y-3">{(allAudit ? audit : audit.slice(0, 5)).map((entry) => <li key={entry.id} className="flex gap-3 text-sm"><span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" /><span><span className="block font-semibold text-ink-strong">{AUDIT_LABELS[entry.action] ?? humanizeEnum(entry.action.split(".").slice(-1)[0])}</span><span className="text-caption text-ink-muted">{entry.actor} · {formatDateTime(entry.created_at)}</span></span></li>)}</ol>
            ) : <Empty icon={ShieldCheck} title="No audit events available" text="Audit events will appear here when data is available." />}
          </Panel>
        </div>
      </div>
      <PrintFooter />

      <ConfirmDialog open={pending !== null && pending !== "reverse"} title={pending ? ACTION_COPY[pending].title : ""} description={pending ? ACTION_COPY[pending].description : ""} confirmLabel={pending ? ACTION_COPY[pending].label : ""} destructive={pending ? ACTION_COPY[pending].destructive : false} loading={acting} onConfirm={() => void run()} onCancel={() => setPending(null)} />
      <Dialog open={pending === "reverse"} onClose={() => setPending(null)} title="Reverse journal" description="Creates a new, unposted journal with every line reversed. Post it to complete the correction."
        footer={<><Button variant="secondary" onClick={() => setPending(null)}>Cancel</Button><Button variant="danger" loading={acting} onClick={() => void run()}>Create reversal</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="mb-1.5 block text-sm font-semibold">Accounting period</span><select value={reversePeriod} onChange={(event) => setReversePeriod(event.target.value)} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm"><option value="">Select open period</option>{periods.filter((item) => item.status === "OPEN").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span className="mb-1.5 block text-sm font-semibold">Reversal date</span><input type="date" value={reverseDate} onChange={(event) => setReverseDate(event.target.value)} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm" /></label>
          <label className="sm:col-span-2"><span className="mb-1.5 block text-sm font-semibold">Description</span><input value={reverseDescription} onChange={(event) => setReverseDescription(event.target.value)} placeholder={`Reversal of ${journal.journal_number}`} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm" /></label>
        </div>
      </Dialog>
    </div>
  );
}

function AttachmentsPanel({ journalId, attachments, canUpload, onChanged, expanded }: { journalId: string; attachments: Array<{ id: string; original_filename: string; size_bytes: number; created_at: string }>; canUpload: boolean; onChanged: () => void; expanded?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const upload = async (file: File) => {
    setProgress(0);
    setProblem(null);
    try { await accountingApi.uploadJournalAttachment(journalId, file, setProgress); onChanged(); } catch (caught) { setProblem(getApiErrorMessage(caught)); } finally { setProgress(null); if (ref.current) ref.current.value = ""; }
  };
  const download = async (documentId: string, filename: string) => {
    const blob = await accountingApi.downloadJournalAttachment(journalId, documentId);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Panel icon={Paperclip} title={`Attachments (${attachments.length})`} description={expanded ? "Supporting documents stored as confidential." : ""} action={canUpload ? <Button variant="secondary" size="sm" onClick={() => ref.current?.click()}>Add file</Button> : undefined}>
      <input ref={ref} type="file" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
      {canUpload && (
        <button type="button" onClick={() => ref.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) void upload(file); }}
          className={cx("flex w-full flex-col items-center rounded-xl border-2 border-dashed px-3 py-4 text-sm", dragging ? "border-primary bg-primary-soft/50" : "border-line-strong")}>
          <Upload className="h-6 w-6 text-ink-muted" aria-hidden="true" /><span className="mt-1 font-medium text-ink-strong">{progress !== null ? `Uploading ${progress}%` : "Drag and drop files here"}</span><span className="text-caption text-ink-muted">or click to browse</span>
        </button>
      )}
      {problem && <p className="mt-2 text-sm text-danger-ink">{problem}</p>}
      {attachments.length ? <ul className="mt-3 divide-y divide-line-soft">{attachments.map((file) => <li key={file.id} className="flex items-center gap-2 py-2 text-sm"><FileText className="h-4 w-4 text-section-icon" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{file.original_filename}</span><span className="text-caption text-ink-muted">{Math.max(1, Math.round(file.size_bytes / 1024))} KB</span><Button variant="ghost" size="sm" aria-label={`Download ${file.original_filename}`} onClick={() => void download(file.id, file.original_filename)}><Download className="h-4 w-4" /></Button></li>)}</ul> : <p className="mt-2 text-caption text-ink-muted">No attachments have been added.</p>}
    </Panel>
  );
}

function Step({ done, active, title, detail }: { done: boolean; active?: boolean; title: string; detail: string }) {
  return (
    <li className="flex gap-3">
      <span className={cx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", done ? "bg-success text-white" : active ? "border-2 border-primary" : "border-2 border-line-strong")}>{done && <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}</span>
      <span><span className={cx("block font-semibold", active ? "text-primary-ink" : "text-ink-strong")}>{title}</span><span className="text-caption text-ink-muted">{detail}</span></span>
    </li>
  );
}

function Panel({ icon: Icon, title, description, action, children }: { icon: typeof FileText; title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3"><Icon className="mt-0.5 h-6 w-6 shrink-0 text-section-icon" aria-hidden="true" /><div><h2 className="text-heading font-bold text-headline">{title}</h2>{description && <p className="text-support text-heading-support">{description}</p>}</div></div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ icon: Icon, title, text }: { icon: typeof FileText; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-ink-muted"><Icon className="h-6 w-6" aria-hidden="true" /></span>
      <p className="mt-2 font-bold text-headline">{title}</p>
      <p className="mt-0.5 max-w-sm text-support text-ink-muted">{text}</p>
    </div>
  );
}
