"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Download, FileText, Info, Landmark, Play, Plus, Search, Settings, Wallet } from "lucide-react";

import ReconciliationTable, { lineState } from "@/components/accounting/ReconciliationTable";
import { Button, ButtonLink } from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import { Dialog } from "@/components/ui/Overlay";
import StatusBadge from "@/components/ui/StatusBadge";
import { accountingApi, getApiErrorMessage } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { cx } from "@/lib/cx";
import { formatAmount, formatDate } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { ReconciliationDetail } from "@/types/accounting";

function months(count: number) {
  const out: Array<{ key: string; label: string; start: string; end: string }> = [];
  const now = new Date();
  for (let index = 0; index < count; index += 1) {
    const first = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    out.push({ key: iso(first), label: first.toLocaleDateString("en-GB", { month: "long", year: "numeric" }), start: iso(first), end: iso(last) });
  }
  return out;
}
const PERIODS = months(18);

/** Concept "Bank reconciliation" (option 2). */
export default function BankReconciliationPage() {
  const router = useRouter();
  const { can } = useAccess();
  const loadAccounts = useCallback(() => accountingApi.listReconciliationAccounts(), []);
  const { data: accounts, error, reload } = useApiResource(loadAccounts);
  const [accountId, setAccountId] = useState<string>(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("account") ?? ""));
  const [periodKey, setPeriodKey] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [detail, setDetail] = useState<ReconciliationDetail | null>(null);
  const [sessionsByPeriod, setSessionsByPeriod] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const canManage = can("bank_reconciliation.manage");
  const period = PERIODS.find((item) => item.key === periodKey) ?? null;
  const account = accounts?.find((item) => item.id === accountId) ?? null;

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    accountingApi.listReconciliationSessions(accountId).then((page) => {
      if (!active) return;
      const map = Object.fromEntries(page.results.map((session) => [session.period_start, session.id]));
      setSessionsByPeriod(map);
      setPeriodKey((current) => current || page.results[0]?.period_start || PERIODS[1].key);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [accountId]);

  const sessionId = period ? sessionsByPeriod[period.start] : undefined;
  useEffect(() => {
    let active = true;
    if (!sessionId) { Promise.resolve().then(() => active && setDetail(null)); return () => { active = false; }; }
    accountingApi.getReconciliation(sessionId).then((result) => active && setDetail(result)).catch((caught) => active && setProblem(getApiErrorMessage(caught)));
    return () => { active = false; };
  }, [sessionId]);

  const start = async () => {
    if (!account || !period) return;
    setStarting(true);
    setProblem(null);
    try {
      const result = await accountingApi.startReconciliation({ bank_account: account.id, period_start: period.start, period_end: period.end });
      router.push(`/accounting/banking/sessions/${result.session.id}`);
    } catch (caught) {
      setProblem(getApiErrorMessage(caught));
    } finally {
      setStarting(false);
    }
  };
  const visibleAccounts = useMemo(() => (accounts ?? []).filter((item) => !accountSearch.trim() || `${item.name} ${item.bank_name} ${item.masked_account_number}`.toLowerCase().includes(accountSearch.trim().toLowerCase())), [accounts, accountSearch]);
  const unmatched = detail?.lines.filter((line) => line.status !== "MATCHED") ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
        <div><h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">Bank Reconciliation</h1><p className="mt-1.5 text-[1.0625rem] text-heading-support">Match bank transactions with your books to ensure accurate financial records.</p></div>
        {can("payment.view") && <Link href="/accounting/banking/cash" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-ink hover:underline"><Wallet className="h-4 w-4" aria-hidden="true" />Payments &amp; receipts</Link>}
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[16rem] flex-1"><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Bank account</span>
          <span className="relative block"><Landmark className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-section-icon" aria-hidden="true" /><select value={accountId} onChange={(event) => { setAccountId(event.target.value); setPeriodKey(""); setSessionsByPeriod({}); setDetail(null); }} className="h-12 w-full appearance-none rounded-lg border border-line-strong bg-surface pl-11 pr-10 text-sm"><option value="">Select a bank account</option>{(accounts ?? []).map((item) => <option key={item.id} value={item.id}>{item.name} ({item.masked_account_number})</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /></span>
        </label>
        <label className="min-w-[14rem] flex-1"><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Reconciliation period</span>
          <span className="relative block"><CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-section-icon" aria-hidden="true" /><select value={periodKey} disabled={!accountId} onChange={(event) => setPeriodKey(event.target.value)} className="h-12 w-full appearance-none rounded-lg border border-line-strong bg-surface pl-11 pr-10 text-sm disabled:bg-surface-muted"><option value="">Select a period</option>{PERIODS.map((item) => <option key={item.key} value={item.key}>{item.label}{sessionsByPeriod[item.start] ? " · started" : ""}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /></span>
        </label>
        <ButtonLink href={detail ? `/accounting/banking/sessions/${detail.session.id}` : "#"} variant="secondary" size="lg" aria-disabled={!detail} className={cx(!detail && "pointer-events-none opacity-50")} leadingIcon={<FileText className="h-5 w-5" />}>View statement</ButtonLink>
        {canManage && <Button size="lg" loading={starting} disabled={!account || !period} leadingIcon={<Play className="h-5 w-5" />} onClick={() => (detail ? router.push(`/accounting/banking/sessions/${detail.session.id}`) : void start())}>{detail ? "Continue reconciliation" : "Start reconciliation"}</Button>}
      </div>

      {(problem || error) && <ErrorState variant="inline" title="Something went wrong" message={problem ?? error ?? ""} onRetry={error ? reload : undefined} />}

      <div className="grid items-start gap-4 xl:grid-cols-[18rem_minmax(0,1fr)] 2xl:grid-cols-[19rem_minmax(0,1fr)_20rem]">
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1 xl:row-span-2 2xl:row-span-1">
          <div className="flex items-start justify-between gap-2"><div className="flex items-start gap-3"><Landmark className="mt-0.5 h-7 w-7 text-section-icon" aria-hidden="true" /><div><h2 className="text-heading font-bold text-headline">Bank accounts</h2><p className="text-support text-heading-support">Select an account to reconcile.</p></div></div>{can("bank_account.create") && <button type="button" onClick={() => setAdding(true)} aria-label="Add bank account" className="rounded-lg p-1.5 text-primary-ink hover:bg-primary-soft"><Plus className="h-5 w-5" /></button>}</div>
          <label className="relative mt-3 block"><span className="sr-only">Search accounts</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /><input value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="Search accounts" className="h-10 w-full rounded-lg border border-line bg-surface-muted pl-9 pr-3 text-sm" /></label>
          <ul className="mt-3 space-y-1">
            {!accounts && [0, 1, 2].map((index) => <li key={index} className="skeleton h-14 rounded-xl" />)}
            {visibleAccounts.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => { setAccountId(item.id); setPeriodKey(""); setSessionsByPeriod({}); setDetail(null); }} aria-pressed={item.id === accountId} className={cx("flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-surface-hover", item.id === accountId && "bg-primary-soft")}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-muted"><Landmark className="h-5 w-5" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-ink-strong">{item.name}</span><span className="block truncate text-caption text-ink-muted">{item.bank_name} · {item.masked_account_number}</span><span className="mt-1 block"><StatusBadge status={item.state} size="sm" /></span></span>
                  {item.id === accountId && <ChevronRight className="h-4 w-4 text-primary-ink" aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
          {accounts && !accounts.length && <div className="flex flex-col items-center py-8 text-center"><Info className="h-8 w-8 text-section-icon" aria-hidden="true" /><p className="mt-2 font-bold text-headline">No bank accounts</p><p className="text-support text-ink-muted">Add a bank account linked to a cash ledger account to begin.</p></div>}
          {accounts && accounts.length > 0 && !accountId && <div className="flex flex-col items-center py-6 text-center"><Info className="h-8 w-8 text-section-icon" aria-hidden="true" /><p className="mt-2 font-bold text-headline">No account selected</p><p className="text-support text-ink-muted">Select a bank account to view transactions and begin reconciliation.</p></div>}
        </section>

        <div className="min-w-0 xl:order-3 2xl:order-none">
          {detail ? (
            <ReconciliationTable detail={detail} canManage={canManage} onChanged={setDetail} onError={setProblem} />
          ) : (
            <section className="flex flex-col items-center rounded-2xl border border-line bg-surface px-6 py-14 text-center shadow-elevation-1">
              <span className="flex h-24 w-24 items-center justify-center rounded-full bg-primary-soft text-section-icon"><FileText className="h-10 w-10" aria-hidden="true" /></span>
              <p className="mt-4 text-heading font-bold text-headline">{account && period ? `No reconciliation for ${period.label} yet` : "Select a bank account and period"}</p>
              <p className="mt-1 max-w-md text-support text-ink-muted">{account && period ? "Start a reconciliation to import the statement and match it with your book entries." : "Choose a bank account and reconciliation period to view bank transactions and match them with your book entries."}</p>
              <ul className="mt-6 space-y-3 text-left text-sm text-ink">
                {["Compare bank transactions with book entries", "Match or flag transactions", "Resolve unmatched items", "Complete and mark as reconciled"].map((text) => <li key={text} className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 text-ink-subtle" aria-hidden="true" />{text}</li>)}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-4 xl:order-2 xl:grid xl:grid-cols-3 xl:gap-4 xl:space-y-0 2xl:order-none 2xl:block 2xl:space-y-4">
          <section className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1">
            <h2 className="flex items-center gap-2 text-heading font-bold text-headline"><BarChart3 className="h-6 w-6 text-section-icon" aria-hidden="true" />Reconciliation summary</h2>
            {detail ? (
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><dt>Status</dt><dd><StatusBadge status={detail.session.status === "COMPLETED" ? "RECONCILED" : "IN_PROGRESS"} size="sm" /></dd></div>
                <div className="flex justify-between"><dt>Progress</dt><dd className="font-semibold">{detail.progress}% matched</dd></div>
                <div className="flex justify-between"><dt>Statement lines</dt><dd className="font-semibold">{detail.counts.all}</dd></div>
                <div className="flex justify-between"><dt>Book balance</dt><dd className="font-semibold tabular-nums">{formatAmount(detail.book_balance)}</dd></div>
                <div className="flex justify-between"><dt>Difference</dt><dd className={cx("font-semibold tabular-nums", detail.difference && Number(detail.difference) !== 0 && "text-danger-ink")}>{detail.difference === null ? "Closing balance not set" : formatAmount(detail.difference)}</dd></div>
              </dl>
            ) : <p className="mt-3 text-support text-ink-muted">Select a bank account and period to see your reconciliation summary.</p>}
          </section>
          <section className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1">
            <h2 className="flex items-center gap-2 text-heading font-bold text-headline"><CircleAlert className="h-6 w-6 text-section-icon" aria-hidden="true" />Unmatched items</h2>
            <p className="text-support text-heading-support">Transactions that need attention.</p>
            {unmatched.length ? <ul className="mt-3 space-y-2 text-sm">{unmatched.slice(0, 4).map((line) => <li key={line.id} className="flex items-center justify-between gap-2"><span className="min-w-0"><span className="block truncate">{line.description || line.reference}</span><span className="text-caption text-ink-muted">{formatDate(line.statement_date)}</span></span><span className="flex flex-col items-end"><span className="tabular-nums">{formatAmount(line.amount)}</span><StatusBadge status={lineState(line)} size="sm" /></span></li>)}</ul> : <p className="mt-3 text-support text-ink-muted">{detail ? "Everything in this period is matched." : "Select a bank account and period to view unmatched transactions."}</p>}
          </section>
          <section className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1">
            <h2 className="flex items-center gap-2 text-heading font-bold text-headline"><Settings className="h-6 w-6 text-section-icon" aria-hidden="true" />Reconciliation actions</h2>
            <p className="text-support text-heading-support">Complete your reconciliation.</p>
            <div className="mt-3 space-y-2">
              <Button block variant={detail?.can_complete ? "primary" : "secondary"} disabled={!detail?.can_complete || !canManage} leadingIcon={<Check className="h-4 w-4" />} onClick={() => setConfirmComplete(true)}>{detail?.session.status === "COMPLETED" ? "Reconciled" : "Mark as reconciled"}</Button>
              <Button block variant="secondary" disabled={!detail} leadingIcon={<Download className="h-4 w-4" />} onClick={() => detail && void accountingApi.downloadReconciliationReport(detail.session.id).then((blob) => { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `reconciliation-${detail.session.period_end}.csv`; link.click(); URL.revokeObjectURL(url); })}>Export reconciliation report</Button>
              {detail && !detail.can_complete && detail.session.status !== "COMPLETED" && <p className="text-caption text-ink-muted">To complete: match or flag every line and set a statement closing balance equal to the book balance.</p>}
            </div>
          </section>
        </aside>
      </div>

      <ConfirmDialog open={confirmComplete} title="Mark as reconciled?" description="Completing locks this session." confirmLabel="Mark as reconciled" onCancel={() => setConfirmComplete(false)} onConfirm={() => detail && void accountingApi.completeReconciliation(detail.session.id).then((next) => { setDetail(next); setConfirmComplete(false); reload(); }).catch((caught) => { setProblem(getApiErrorMessage(caught)); setConfirmComplete(false); })} />
      {adding && <AddBankAccount onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </div>
  );
}

function AddBankAccount({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const load = useCallback(() => accountingApi.listAccounts({ page_size: MAX_PAGE_SIZE, account_type: "ASSET", is_active: true, is_postable: true, ordering: "code" }), []);
  const { data } = useApiResource(load);
  const [form, setForm] = useState({ name: "", bank_name: "", masked_account_number: "", currency: "GHS", ledger_account: "", is_active: true });
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inputClass = "h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm";
  const save = async () => {
    if (!form.name.trim() || !form.bank_name.trim() || !form.masked_account_number.trim() || !form.currency || !form.ledger_account) { setProblem("Complete every bank account field."); return; }
    setSaving(true);
    try { await accountingApi.createBankAccount({ ...form, name: form.name.trim(), bank_name: form.bank_name.trim(), masked_account_number: form.masked_account_number.trim(), currency: form.currency.toUpperCase() }); onSaved(); } catch (caught) { setProblem(getApiErrorMessage(caught)); } finally { setSaving(false); }
  };
  return (
    <Dialog open onClose={onClose} title="Add bank account" description="Link the account to the cash ledger account its transactions post to." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={() => void save()}>Add account</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {problem && <div className="sm:col-span-2"><ErrorState variant="inline" title="Not saved" message={problem} /></div>}
        <label><span className="mb-1.5 block text-sm font-semibold">Account name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} /></label>
        <label><span className="mb-1.5 block text-sm font-semibold">Bank</span><input value={form.bank_name} onChange={(event) => setForm({ ...form, bank_name: event.target.value })} className={inputClass} /></label>
        <label><span className="mb-1.5 block text-sm font-semibold">Masked number</span><input value={form.masked_account_number} onChange={(event) => setForm({ ...form, masked_account_number: event.target.value })} placeholder="****1234" className={inputClass} /></label>
        <label><span className="mb-1.5 block text-sm font-semibold">Currency</span><input maxLength={3} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} className={inputClass} /></label>
        <label className="sm:col-span-2"><span className="mb-1.5 block text-sm font-semibold">Cash ledger account</span><select value={form.ledger_account} onChange={(event) => setForm({ ...form, ledger_account: event.target.value })} className={inputClass}><option value="">Select account</option>{(data?.results ?? []).map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
      </div>
    </Dialog>
  );
}
