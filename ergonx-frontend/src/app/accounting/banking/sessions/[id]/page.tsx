"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Download, FileText, Landmark, ScanSearch, Settings, Upload } from "lucide-react";

import ReconciliationTable from "@/components/accounting/ReconciliationTable";
import { Button } from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { Dialog, Menu, MenuItem } from "@/components/ui/Overlay";
import StatusBadge from "@/components/ui/StatusBadge";
import { accountingApi, getApiErrorMessage } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { cx } from "@/lib/cx";
import { EM_DASH, formatAmount, formatDate, formatDateTime } from "@/lib/format";
import type { ReconciliationDetail } from "@/types/accounting";

async function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Concept "Bank reconciliation session detail". */
export default function ReconciliationSessionPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAccess();
  const [detail, setDetail] = useState<ReconciliationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [balances, setBalances] = useState({ opening: "", closing: "" });
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tableKey, setTableKey] = useState(0);
  const [initialTab, setInitialTab] = useState<"unmatched" | "matched" | "all">("unmatched");
  const fileRef = useRef<HTMLInputElement>(null);
  const canManage = can("bank_reconciliation.manage");

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    accountingApi.getReconciliation(id)
      .then((result) => { if (active) setDetail(result); })
      .catch((caught) => { if (active) setError(getApiErrorMessage(caught)); });
    return () => { active = false; };
  }, [id, attempt]);

  if (error) return <ErrorState message={error} onRetry={() => { setError(null); setAttempt((value) => value + 1); }} />;
  if (!detail) return <LoadingState />;
  const { session, bank_account: account } = detail;
  const locked = session.status === "COMPLETED";
  const run = async (work: () => Promise<ReconciliationDetail>, done?: string) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try { const next = await work(); setDetail(next); if (done) setNotice(done); return next; } catch (caught) { setProblem(getApiErrorMessage(caught)); return null; } finally { setBusy(false); }
  };
  const importFile = async (file: File) => {
    const next = await run(() => accountingApi.importReconciliationStatement(session.id, file));
    if (next?.import_result) setNotice(`Imported ${next.import_result.created} new line(s)${next.import_result.skipped ? `, ${next.import_result.skipped} already present` : ""}.${next.import_result.errors.length ? ` ${next.import_result.errors.length} row(s) skipped: ${next.import_result.errors.slice(0, 3).join(" ")}` : ""}`);
    if (fileRef.current) fileRef.current.value = "";
  };
  const difference = detail.difference === null ? null : Number(detail.difference);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="text-sm text-ink-muted"><Link href="/accounting/banking" className="hover:underline">Bank Reconciliation</Link><ChevronRight className="mx-1 inline h-4 w-4" aria-hidden="true" /><span className="font-medium text-ink-strong">Session Detail</span></nav>
        <Link href={`/accounting/banking?account=${account.id}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink-strong hover:bg-surface-hover"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to bank reconciliation</Link>
      </div>
      <div><h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">Bank Reconciliation</h1><p className="mt-1.5 text-[1.0625rem] text-heading-support">Review and match bank transactions with your book entries.</p></div>

      {problem && <ErrorState variant="inline" title="Action not completed" message={problem} />}
      {notice && <p className="rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm font-medium text-success-ink">{notice}</p>}

      <section className="rounded-2xl border border-line bg-surface shadow-elevation-1">
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.2fr)] lg:divide-x lg:divide-line-soft">
          <div className="flex items-start gap-4"><span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary-soft text-section-icon"><Landmark className="h-8 w-8" aria-hidden="true" /></span><div><p className="text-[1.125rem] font-bold text-ink-strong">{account.name} ({account.masked_account_number})</p><p className="text-heading-support">{detail.institution.name}</p><p className="text-caption text-ink-muted">{account.bank_name} · {account.currency}</p></div></div>
          <div className="lg:pl-5"><p className="text-caption text-ink-muted">Statement period</p><p className="mt-1 flex items-center gap-2 font-semibold"><CalendarDays className="h-4 w-4 text-ink-muted" aria-hidden="true" />{formatDate(session.period_start)} – {formatDate(session.period_end)}</p></div>
          <div className="lg:pl-5"><p className="text-caption text-ink-muted">Opening balance</p><p className="mt-1 text-heading font-bold tabular-nums">{session.statement_opening_balance !== null ? formatAmount(session.statement_opening_balance) : EM_DASH}</p></div>
          <div className="lg:pl-5"><p className="text-caption text-ink-muted">Closing balance</p><p className="mt-1 text-heading font-bold tabular-nums">{session.statement_closing_balance !== null ? formatAmount(session.statement_closing_balance) : EM_DASH}</p></div>
          <div className="lg:pl-5"><StatusBadge status={locked ? "RECONCILED" : "IN_PROGRESS"} /><p className="mt-2 text-caption text-ink-muted">{locked ? `Reconciled ${formatDateTime(session.completed_at)} by ${detail.completed_by}` : session.last_imported_at ? `Last imported ${formatDateTime(session.last_imported_at)} by ${detail.last_imported_by}` : `Started by ${detail.started_by}; no statement imported yet`}</p></div>
        </div>
        <div className="grid gap-5 border-t border-line-soft p-5 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,0.8fr))_minmax(0,1.6fr)] lg:divide-x lg:divide-line-soft">
          <div><p className="font-semibold text-ink-strong">Reconciliation progress</p><div className="mt-2 flex items-center gap-3"><span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-muted"><span className="block h-full rounded-full bg-success" style={{ width: `${detail.progress}%` }} /></span><span className="text-sm text-ink-muted">{detail.progress}% matched</span></div></div>
          <div className="lg:pl-5"><p className="text-caption text-ink-muted">Matched amount</p><p className="mt-1 text-heading font-bold tabular-nums text-success-ink">{formatAmount(detail.matched_amount)}</p></div>
          <div className="lg:pl-5"><p className="text-caption text-ink-muted">Unmatched amount</p><p className="mt-1 text-heading font-bold tabular-nums text-warning-ink">{formatAmount(detail.unmatched_amount)}</p></div>
          <div className="lg:pl-5"><p className="text-caption text-ink-muted">Difference</p><p className={cx("mt-1 text-heading font-bold tabular-nums", difference === null ? "text-ink-muted" : difference === 0 ? "text-ink-strong" : "text-danger-ink")}>{difference === null ? "Set closing" : formatAmount(detail.difference)}</p><p className="text-caption text-ink-muted">Books {formatAmount(detail.book_balance)}</p></div>
          <div className="flex flex-col gap-2 lg:pl-5">
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
              <Menu label="Import statement" trigger={(props) => <Button {...props} variant="secondary" disabled={!canManage || locked} loading={busy} leadingIcon={<Upload className="h-4 w-4" />} trailingIcon={<ChevronDown className="h-4 w-4" />}>Import statement</Button>}>
                {(close) => <div className="p-1.5"><MenuItem icon={<Upload className="h-4 w-4" />} description="Columns: date, description, reference, amount" onSelect={() => { close(); fileRef.current?.click(); }}>Upload CSV statement</MenuItem></div>}
              </Menu>
              {canManage && !locked && (detail.can_complete
                ? <Button leadingIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setConfirmComplete(true)}>Mark as reconciled</Button>
                : <Button leadingIcon={<ScanSearch className="h-4 w-4" />} onClick={() => { setInitialTab("unmatched"); setTableKey((value) => value + 1); document.getElementById("statement-lines")?.scrollIntoView({ behavior: "smooth" }); }}>Match transactions</Button>)}
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              {canManage && !locked && <button type="button" onClick={() => { setBalances({ opening: session.statement_opening_balance ?? "", closing: session.statement_closing_balance ?? "" }); setSettings(true); }} className="inline-flex items-center gap-1.5 font-semibold text-primary-ink hover:underline"><Settings className="h-4 w-4" aria-hidden="true" />Reconciliation settings</button>}
              <button type="button" onClick={() => { setInitialTab("all"); setTableKey((value) => value + 1); }} className="inline-flex items-center gap-1.5 font-semibold text-primary-ink hover:underline"><FileText className="h-4 w-4" aria-hidden="true" />View statement</button>
              <button type="button" onClick={() => void accountingApi.downloadReconciliationReport(session.id).then((blob) => saveBlob(blob, `reconciliation-${session.period_end}.csv`))} className="inline-flex items-center gap-1.5 font-semibold text-primary-ink hover:underline"><Download className="h-4 w-4" aria-hidden="true" />Report</button>
            </div>
          </div>
        </div>
      </section>

      <div id="statement-lines"><ReconciliationTable key={tableKey} detail={detail} canManage={canManage} onChanged={setDetail} onError={setProblem} initialTab={initialTab} /></div>

      <Dialog open={settings} onClose={() => setSettings(false)} title="Reconciliation settings" description="Enter the balances printed on the bank statement. The closing balance must equal the posted bank-ledger balance to complete."
        footer={<><Button variant="secondary" onClick={() => setSettings(false)}>Cancel</Button><Button loading={busy} onClick={() => void run(() => accountingApi.updateReconciliationBalances(session.id, { statement_opening_balance: balances.opening || null, statement_closing_balance: balances.closing || null }), "Statement balances saved.").then(() => setSettings(false))}>Save balances</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="mb-1.5 block text-sm font-semibold">Statement opening balance</span><input type="number" step="0.01" value={balances.opening} onChange={(event) => setBalances({ ...balances, opening: event.target.value })} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm" /></label>
          <label><span className="mb-1.5 block text-sm font-semibold">Statement closing balance</span><input type="number" step="0.01" value={balances.closing} onChange={(event) => setBalances({ ...balances, closing: event.target.value })} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm" /></label>
          <p className="text-caption text-ink-muted sm:col-span-2">Posted book balance at {formatDate(session.period_end)}: <strong>{formatAmount(detail.book_balance)}</strong></p>
        </div>
      </Dialog>
      <ConfirmDialog open={confirmComplete} title="Mark as reconciled?" description="Completing locks this session. Exceptions remain listed in the report." confirmLabel="Mark as reconciled" loading={busy} onCancel={() => setConfirmComplete(false)} onConfirm={() => void run(() => accountingApi.completeReconciliation(session.id), "Reconciliation completed.").then(() => setConfirmComplete(false))} />
    </div>
  );
}
