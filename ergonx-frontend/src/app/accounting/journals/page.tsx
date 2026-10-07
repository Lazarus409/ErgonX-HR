"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, ChevronDown, ChevronRight, Download, FileText, Filter, Network, NotebookText, Plus, Search, Settings2, X } from "lucide-react";

import { BarsChart } from "@/components/charts/Charts";
import { ButtonLink, Button } from "@/components/ui/Button";
import ErrorState from "@/components/ui/ErrorState";
import { Menu } from "@/components/ui/Overlay";
import StatusBadge from "@/components/ui/StatusBadge";
import { accountingApi } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { cx } from "@/lib/cx";
import { EM_DASH, formatAmount, formatDate, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { Account, AccountActivity } from "@/types/accounting";

const TYPE_ORDER: Array<[string, string]> = [["ASSET", "Assets"], ["LIABILITY", "Liabilities"], ["EQUITY", "Net Assets / Equity"], ["INCOME", "Revenue"], ["EXPENSE", "Expenses"]];
const STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "POSTED", "REVERSED", "VOID"];
const SOURCES = ["MANUAL", "PAYROLL", "AP", "AR", "EXPENSE", "CASH", "SYSTEM"];
const COLUMNS: Array<[string, string]> = [["date", "Date"], ["reference", "Reference"], ["account", "Account"], ["description", "Description"], ["debit", "Debit"], ["credit", "Credit"], ["balance", "Balance"], ["status", "Status"]];

type Row = { key: string; journalId: string; date: string; reference: string; sub?: string; account: string; description: string; debit: string; credit: string; balance: string | null; status: string };

function isoMonthsAgo(months: number) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - (months - 1));
  return date.toISOString().slice(0, 10);
}

/** Concept "General ledger" (option 2): chart of accounts, journal entries and account details. */
export default function GeneralLedgerPage() {
  const { can } = useAccess();
  const [range, setRange] = useState<3 | 6 | 12>(12);
  const [accountSearch, setAccountSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("active");
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("status") ?? ""));
  const [source, setSource] = useState("");
  const [moreFilters, setMoreFilters] = useState(false);
  const [dateTo, setDateTo] = useState("");
  const [hidden, setHidden] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const dateFrom = isoMonthsAgo(range);

  const loadAccounts = useCallback(async () => {
    const [accounts, balances] = await Promise.all([accountingApi.listAccounts({ page_size: MAX_PAGE_SIZE, ordering: "code" }), accountingApi.getAccountBalances().catch(() => ({} as Record<string, string>))]);
    return { accounts: accounts.results, balances };
  }, []);
  const { data: chart, error: chartError } = useApiResource(loadAccounts);
  const loadEntries = useCallback(() => accountingApi.listJournalEntries({ page_size: MAX_PAGE_SIZE, ordering: "-entry_date", status: status || undefined, source: source || undefined, search: search.trim() || undefined, date_from: dateFrom, date_to: dateTo || undefined } as Parameters<typeof accountingApi.listJournalEntries>[0]), [status, source, search, dateFrom, dateTo]);
  const { data: entries, loading: entriesLoading, error: entriesError, reload } = useApiResource(loadEntries);
  const [activity, setActivity] = useState<AccountActivity | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    accountingApi.getAccountActivity(selected, { date_from: dateFrom, date_to: dateTo, status, source, search: search.trim() })
      .then((result) => { if (active) { setActivity(result); setActivityError(null); } })
      .catch(() => { if (active) setActivityError("Unable to load account activity."); });
    return () => { active = false; };
  }, [selected, dateFrom, dateTo, status, source, search]);

  const accounts = useMemo(() => chart?.accounts ?? [], [chart]);
  const visibleAccounts = useMemo(() => {
    const term = accountSearch.trim().toLowerCase();
    return accounts.filter((account) => (!typeFilter || account.account_type === typeFilter) && (activeFilter === "all" || (activeFilter === "active") === account.is_active) && (!term || account.code.toLowerCase().includes(term) || account.name.toLowerCase().includes(term)));
  }, [accounts, accountSearch, typeFilter, activeFilter]);
  const byId = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  // Header accounts show the sum of their descendants' posted balances.
  const rolledUp = useMemo(() => {
    const own = chart?.balances ?? {};
    const totals: Record<string, string> = {};
    const total = (id: string): number => accounts.filter((account) => account.parent === id).reduce((sum, child) => sum + total(child.id), Number(own[id] ?? 0));
    accounts.forEach((account) => { const value = total(account.id); if (value) totals[account.id] = value.toFixed(2); });
    return totals;
  }, [accounts, chart]);
  const selectedAccount = selected ? byId.get(selected) ?? null : null;

  const rows: Row[] = useMemo(() => {
    if (selected && activity) {
      return activity.lines.map((line) => ({ key: line.id, journalId: line.journal_entry_id, date: line.entry_date, reference: line.journal_number, sub: line.reference, account: `${activity.account.code} ${activity.account.name}`, description: line.description, debit: line.debit, credit: line.credit, balance: line.running_balance, status: line.status }));
    }
    return (entries?.results ?? []).map((journal) => {
      const accountNames = Array.from(new Set(journal.lines.map((line) => line.account_code ? `${line.account_code} ${line.account_name}` : byId.get(line.account)?.name ?? "Account")));
      return { key: journal.id, journalId: journal.id, date: journal.entry_date, reference: journal.journal_number, sub: journal.reference, account: accountNames.length > 1 ? `${accountNames[0]} +${accountNames.length - 1}` : accountNames[0] ?? EM_DASH, description: journal.description, debit: journal.total_debit ?? "0", credit: journal.total_credit ?? "0", balance: null, status: journal.status };
    });
  }, [selected, activity, entries, byId]);

  const exportCsv = () => {
    const header = COLUMNS.filter(([key]) => !hidden.includes(key)).map(([, label]) => label);
    const body = rows.map((row) => COLUMNS.filter(([key]) => !hidden.includes(key)).map(([key]) => String({ date: row.date, reference: row.reference, account: row.account, description: row.description, debit: row.debit, credit: row.credit, balance: row.balance ?? "", status: row.status }[key] ?? "")));
    const csv = [header, ...body].map((line) => line.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = selectedAccount ? `ledger-${selectedAccount.code}.csv` : "journal-entries.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  const show = (key: string) => !hidden.includes(key);
  const tableError = selected ? activityError : entriesError;
  const tableLoading = selected ? !activity && !activityError : entriesLoading && !entries;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">General Ledger</h1>
          <p className="mt-1.5 text-[1.0625rem] text-heading-support">View and manage journal entries across your chart of accounts.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="relative">
            <span className="sr-only">Date range</span>
            <CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-section-icon" aria-hidden="true" />
            <select data-ui="select" value={range} onChange={(event) => setRange(Number(event.target.value) as 3 | 6 | 12)} className="h-12 appearance-none rounded-lg border border-line-strong bg-surface pl-11 pr-10 text-sm font-medium text-ink-strong">
              {[3, 6, 12].map((months) => <option key={months} value={months}>Last {months} months</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          </label>
          {can("journal.create") && <ButtonLink href="/accounting/journals/new" size="lg" leadingIcon={<Plus className="h-5 w-5" />}>Create journal</ButtonLink>}
        </div>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[18rem_minmax(0,1fr)] 2xl:grid-cols-[20rem_minmax(0,1fr)_19rem]">
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1 xl:row-span-2 xl:max-h-[calc(100vh-12rem)] xl:overflow-y-auto 2xl:row-span-1">
          <h2 className="flex items-center gap-2 text-heading font-bold text-headline"><Network className="h-6 w-6 text-section-icon" aria-hidden="true" />Chart of accounts</h2>
          <label className="relative mt-3 block"><span className="sr-only">Search accounts</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /><input value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="Search accounts" className="h-10 w-full rounded-lg border border-line bg-surface-muted pl-9 pr-3 text-sm" /></label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <select aria-label="Account type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2 text-caption"><option value="">All account types</option>{TYPE_ORDER.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <select aria-label="Account status" value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2 text-caption"><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All status</option></select>
          </div>
          {chartError && <p className="mt-3 text-sm text-danger-ink">{chartError}</p>}
          <ul className="mt-3 space-y-1 text-sm">
            {TYPE_ORDER.map(([type, label], index) => {
              const group = visibleAccounts.filter((account) => account.account_type === type);
              if (!group.length) return null;
              const open = !collapsed[type];
              return (
                <li key={type}>
                  <button type="button" onClick={() => setCollapsed((current) => ({ ...current, [type]: open }))} className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1.5 font-semibold text-ink-strong hover:bg-surface-hover" aria-expanded={open}>
                    <ChevronRight className={cx("h-4 w-4 transition", open && "rotate-90")} aria-hidden="true" />{index + 1} {label}<span className="ml-auto text-caption font-normal text-ink-muted">{group.length}</span>
                  </button>
                  {open && <AccountTree accounts={group} parent={null} depth={1} selected={selected} balances={rolledUp} onSelect={(id) => { setSelected(id === selected ? null : id); setActivity(null); }} all={group} />}
                </li>
              );
            })}
            {chart && !visibleAccounts.length && <li className="py-4 text-center text-ink-muted">No accounts match.</li>}
          </ul>
        </section>

        <section className="min-w-0 rounded-2xl border border-line bg-surface p-4 shadow-elevation-1 xl:order-3 2xl:order-none">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3"><FileText className="mt-0.5 h-6 w-6 text-section-icon" aria-hidden="true" /><div><h2 className="text-heading font-bold text-headline">{selectedAccount ? `${selectedAccount.code} ${selectedAccount.name}` : "Journal entries"}</h2><p className="text-support text-heading-support">{selectedAccount ? "Lines on this account, posted and unposted. Balance runs over posted lines." : "All posted and unposted journal entries."}</p></div></div>
            <div className="flex gap-2">
              {selectedAccount && <Button variant="ghost" leadingIcon={<X className="h-4 w-4" />} onClick={() => { setSelected(null); setActivity(null); }}>All entries</Button>}
              <Button variant="secondary" leadingIcon={<Download className="h-4 w-4" />} disabled={!rows.length} onClick={exportCsv}>Export</Button>
              <Menu label="Columns" width="w-52" trigger={(props) => <Button {...props} variant="secondary" leadingIcon={<Settings2 className="h-4 w-4" />}>Columns</Button>}>
                {() => (
                  <div className="p-2">
                    {COLUMNS.map(([key, label]) => <label key={key} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"><input type="checkbox" checked={show(key)} onChange={() => setHidden((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} className="h-4 w-4" />{label}</label>)}
                  </div>
                )}
              </Menu>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="relative min-w-[12rem] flex-1"><span className="sr-only">Search entries</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search entries…" className="h-10 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm" /></label>
            <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm"><option value="">All status</option>{STATUSES.map((value) => <option key={value} value={value}>{humanizeEnum(value)}</option>)}</select>
            <select aria-label="Source" value={source} onChange={(event) => setSource(event.target.value)} className="h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm"><option value="">All sources</option>{SOURCES.map((value) => <option key={value} value={value}>{humanizeEnum(value)}</option>)}</select>
            <Button variant="secondary" leadingIcon={<Filter className="h-4 w-4" />} onClick={() => setMoreFilters((current) => !current)} aria-expanded={moreFilters}>More filters</Button>
          </div>
          {moreFilters && (
            <div className="mt-2 flex flex-wrap items-end gap-3 rounded-xl bg-surface-muted p-3 text-sm">
              <label><span className="mb-1 block text-caption font-semibold">From</span><input type="date" value={dateFrom} disabled className="h-9 rounded-lg border border-line bg-surface px-2" /></label>
              <label><span className="mb-1 block text-caption font-semibold">To</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2" /></label>
              <p className="text-caption text-ink-muted">The start date follows the range selector.</p>
            </div>
          )}
          {tableError && <div className="mt-3"><ErrorState variant="inline" title="Unable to load entries" message={tableError} onRetry={reload} /></div>}
          <div className="mt-3 max-h-[calc(100vh-16rem)] min-h-[20rem] overflow-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="sticky top-0 z-10 bg-surface-muted text-left text-caption font-semibold text-ink-strong">
                <tr>{COLUMNS.filter(([key]) => show(key)).map(([key, label]) => <th key={key} className={cx("px-2.5 py-2", ["debit", "credit", "balance"].includes(key) && "text-right")}>{label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {tableLoading && [0, 1, 2, 3].map((index) => <tr key={index}><td colSpan={8} className="px-2.5 py-2"><div className="skeleton h-6 rounded" /></td></tr>)}
                {!tableLoading && rows.map((row) => (
                  <tr key={row.key} className="hover:bg-surface-hover">
                    {show("date") && <td className="whitespace-nowrap px-2.5 py-2 text-ink-muted">{formatDate(row.date)}</td>}
                    {show("reference") && <td className="max-w-44 px-2.5 py-2"><Link href={`/accounting/journals/${row.journalId}`} className="whitespace-nowrap font-semibold text-primary-ink hover:underline">{row.reference}</Link>{row.sub && <span className="block truncate text-caption text-ink-muted" title={row.sub}>{row.sub}</span>}</td>}
                    {show("account") && <td className="max-w-40 truncate px-2.5 py-2" title={row.account}>{row.account}</td>}
                    {show("description") && <td className="max-w-56 truncate px-2.5 py-2" title={row.description}>{row.description}</td>}
                    {show("debit") && <td className="px-2.5 py-2 text-right tabular-nums">{Number(row.debit) ? formatAmount(row.debit) : EM_DASH}</td>}
                    {show("credit") && <td className="px-2.5 py-2 text-right tabular-nums">{Number(row.credit) ? formatAmount(row.credit) : EM_DASH}</td>}
                    {show("balance") && <td className="px-2.5 py-2 text-right font-semibold tabular-nums">{row.balance !== null ? formatAmount(row.balance) : EM_DASH}</td>}
                    {show("status") && <td className="px-2.5 py-2"><StatusBadge status={row.status} size="sm" /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {!tableLoading && !rows.length && !tableError && (
              <div className="flex flex-col items-center py-14 text-center">
                <span className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-muted text-ink-muted"><FileText className="h-9 w-9" aria-hidden="true" /></span>
                <p className="mt-3 text-heading font-bold text-headline">No journal entries found</p>
                <p className="mt-1 max-w-sm text-support text-ink-muted">Try adjusting your filters or create a new journal entry to get started.</p>
                {can("journal.create") && <ButtonLink href="/accounting/journals/new" className="mt-4" leadingIcon={<Plus className="h-4 w-4" />}>Create journal</ButtonLink>}
              </div>
            )}
          </div>
          {selected && activity && <p className="mt-2 text-caption text-ink-muted">Opening balance {formatAmount(activity.opening_balance)} · closing {formatAmount(activity.closing_balance)}{activity.unposted_lines ? ` · ${activity.unposted_lines} unposted line(s) excluded from the balance` : ""}.</p>}
        </section>

        <AccountDetails account={selectedAccount} activity={activity} parentName={selectedAccount?.parent ? byId.get(selectedAccount.parent)?.name ?? null : null} />
      </div>
    </div>
  );
}

function AccountTree({ accounts, all, parent, depth, selected, balances, onSelect }: { accounts: Account[]; all: Account[]; parent: string | null; depth: number; selected: string | null; balances: Record<string, string>; onSelect: (id: string) => void }) {
  const ids = new Set(all.map((account) => account.id));
  // Accounts whose parent is outside the filtered group are shown at the top level.
  const level = accounts.filter((account) => (parent === null ? !account.parent || !ids.has(account.parent) : account.parent === parent));
  if (!level.length) return null;
  return (
    <ul>
      {level.map((account) => {
        const children = all.filter((item) => item.parent === account.id);
        return (
          <li key={account.id}>
            <button type="button" onClick={() => onSelect(account.id)} aria-pressed={selected === account.id} style={{ paddingLeft: `${depth * 0.85}rem` }}
              className={cx("flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-1.5 text-left hover:bg-surface-hover", selected === account.id && "bg-primary-soft font-semibold text-primary-ink", !account.is_active && "opacity-60")}>
              {children.length ? <ChevronRight className="h-3.5 w-3.5 shrink-0 rotate-90 text-ink-muted" aria-hidden="true" /> : <span className="w-3.5 shrink-0" />}
              <span className="shrink-0 tabular-nums text-ink-muted">{account.code}</span>
              <span className="min-w-0 flex-1 truncate">{account.name}</span>
              {balances[account.id] && Number(balances[account.id]) !== 0 && <span className="shrink-0 text-caption tabular-nums text-ink-muted">{formatAmount(balances[account.id])}</span>}
            </button>
            {children.length > 0 && <AccountTree accounts={children} all={all} parent={account.id} depth={depth + 1} selected={selected} balances={balances} onSelect={onSelect} />}
          </li>
        );
      })}
    </ul>
  );
}

function AccountDetails({ account, activity, parentName }: { account: Account | null; activity: AccountActivity | null; parentName: string | null }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1 xl:order-2 2xl:order-none">
      <div className="flex items-start gap-3"><NotebookText className="mt-0.5 h-6 w-6 text-section-icon" aria-hidden="true" /><div><h2 className="text-heading font-bold text-headline">Account details</h2><p className="text-support text-heading-support">Select an account to view details and activity.</p></div></div>
      {!account ? (
        <div className="flex flex-col items-center py-12 text-center">
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-surface-muted text-ink-subtle"><BarChart3 className="h-10 w-10" aria-hidden="true" /></span>
          <p className="mt-3 text-heading font-bold text-headline">No account selected</p>
          <p className="mt-1 text-support text-ink-muted">Choose an account from the chart of accounts to view the account summary, recent activity and related insights.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-caption font-semibold uppercase tracking-wide text-ink-muted">{account.code}</p>
            <p className="text-[1.125rem] font-bold text-ink-strong">{account.name}</p>
            <div className="mt-1 flex flex-wrap gap-1.5"><StatusBadge status={account.is_active ? "ACTIVE" : "INACTIVE"} size="sm" />{!account.is_postable && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-caption font-semibold">Header account</span>}</div>
          </div>
          <div className="rounded-xl bg-primary-soft/60 p-3"><p className="text-caption text-ink-muted">Posted balance</p><p className="text-kpi-sm font-bold tabular-nums text-headline">{activity ? formatAmount(activity.balance) : EM_DASH}</p></div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-caption text-ink-muted">Type</dt><dd className="font-medium">{humanizeEnum(account.account_type)}</dd></div>
            <div><dt className="text-caption text-ink-muted">Normal balance</dt><dd className="font-medium">{humanizeEnum(account.normal_balance)}</dd></div>
            <div><dt className="text-caption text-ink-muted">Period debits</dt><dd className="font-medium tabular-nums">{activity ? formatAmount(activity.period_debits) : EM_DASH}</dd></div>
            <div><dt className="text-caption text-ink-muted">Period credits</dt><dd className="font-medium tabular-nums">{activity ? formatAmount(activity.period_credits) : EM_DASH}</dd></div>
            <div className="col-span-2"><dt className="text-caption text-ink-muted">Parent</dt><dd className="font-medium">{parentName ?? "Top level"}</dd></div>
          </dl>
          {activity && activity.monthly.length > 0 && (
            <div>
              <p className="mb-1 text-caption font-semibold text-ink-strong">Monthly movement</p>
              <BarsChart data={activity.monthly.map((row) => ({ month: row.month, debit: Number(row.debit), credit: Number(row.credit) }))} xKey="month" xFormat="month" height={150} series={[{ key: "debit", label: "Debit", color: "var(--chart-1)" }, { key: "credit", label: "Credit", color: "var(--chart-6)" }]} />
            </div>
          )}
          {activity && !activity.monthly.length && <p className="text-sm text-ink-muted">No posted activity in this range.</p>}
          <Link href="/accounting/reports" className="inline-flex items-center gap-1 text-sm font-semibold text-primary-ink hover:underline">Financial reports<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>
        </div>
      )}
    </section>
  );
}
