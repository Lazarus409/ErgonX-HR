"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { CalendarDays, CheckSquare, Layers, ChevronDown, ChevronRight, CreditCard, FileText, Filter, Info, MoreHorizontal, Plus, Search, Upload, UsersRound, X } from "lucide-react";

import { BulkActionsPanel, RecentBatchJobs } from "@/components/accounting/BulkActions";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Card";
import ErrorState from "@/components/ui/ErrorState";
import { Menu } from "@/components/ui/Overlay";
import StatusBadge from "@/components/ui/StatusBadge";
import Tabs from "@/components/ui/Tabs";
import { accountingApi, getApiErrorMessage } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { cx } from "@/lib/cx";
import { EM_DASH, formatAmount, formatDate, formatNumber } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import { buttonClasses } from "@/components/ui/Button";

type BillLineForm = { description: string; expense_account: string; quantity: string; unit_price: string };
type BillForm = { vendor: string; bill_number: string; bill_date: string; due_date: string; currency: string; accounting_period: string; lines: BillLineForm[] };
const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): BillLineForm => ({ description: "", expense_account: "", quantity: "1", unit_price: "" });
const emptyForm = (): BillForm => ({ vendor: "", bill_number: "", bill_date: today(), due_date: today(), currency: "", accounting_period: "", lines: [emptyLine()] });

type TabKey = "all" | "pending" | "approved" | "rejected" | "paid" | "on_hold";
const TABS: Array<[TabKey, string]> = [["all", "All bills"], ["pending", "Pending approval"], ["approved", "Approved"], ["rejected", "Rejected"], ["paid", "Paid"], ["on_hold", "On hold"]];
const TAB_FILTER: Record<TabKey, Record<string, string | boolean | undefined>> = { all: {}, pending: { status: "PENDING" }, approved: { status: "APPROVED" }, rejected: { status: "REJECTED" }, paid: { status: "PAID" }, on_hold: { on_hold: true } };

function daysAgo(value: string | null) {
  if (!value) return "Awaiting submission";
  const days = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 86400000));
  return days === 0 ? "Submitted today" : `Submitted ${days} day${days === 1 ? "" : "s"} ago`;
}

/** Concept "Accounts payable" (option 2). */
export default function PayablesPage() {
  const { can } = useAccess();
  const [range, setRange] = useState<3 | 6 | 12>(12);
  const [tab, setTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [vendorFilter, setVendorFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<BillForm>(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ ids: string[]; operation?: string } | null>(null);
  const [jobLimit, setJobLimit] = useState(5);

  const rangeStart = useMemo(() => { const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - (range - 1)); return date.toISOString().slice(0, 10); }, [range]);
  const loadSummary = useCallback(() => accountingApi.getPayablesSummary(range), [range]);
  const { data: summary, reload: reloadSummary } = useApiResource(loadSummary);
  const loadBills = useCallback(() => accountingApi.listVendorBills({ page_size: MAX_PAGE_SIZE, ordering: "-bill_date", search: search.trim() || undefined, vendor: vendorFilter || undefined, ...TAB_FILTER[tab], bill_date__gte: rangeStart } as Parameters<typeof accountingApi.listVendorBills>[0]), [tab, search, vendorFilter, rangeStart]);
  const { data: bills, loading, error, reload } = useApiResource(loadBills);
  const loadRefs = useCallback(() => Promise.all([
    accountingApi.listVendors({ page_size: MAX_PAGE_SIZE, is_active: true }),
    accountingApi.listAccounts({ page_size: MAX_PAGE_SIZE, account_type: "EXPENSE", is_active: true, is_postable: true, ordering: "code" }),
    accountingApi.listAccountingPeriods({ page_size: MAX_PAGE_SIZE, status: "OPEN", ordering: "start_date" }),
  ]), []);
  const { data: refs } = useApiResource(loadRefs);
  const vendors = refs?.[0].results ?? [];
  const rows = (bills?.results ?? []).filter((bill) => !rangeStart || bill.bill_date >= rangeStart);
  const loadJobs = useCallback(() => accountingApi.listVendorBillBatchJobs(jobLimit), [jobLimit]);
  const { data: jobs, reload: reloadJobs } = useApiResource(loadJobs);
  const refresh = () => { reload(); reloadSummary(); };

  const openCreate = () => { setForm(emptyForm()); setFormError(""); setModalOpen(true); };
  const save = async () => {
    if (!form.vendor || !form.bill_number.trim() || !form.bill_date || !form.due_date || !form.currency.trim() || !form.accounting_period || form.lines.some((line) => !line.description.trim() || !line.expense_account || !line.quantity || !line.unit_price)) { setFormError("Complete the bill header and every bill line before saving."); return; }
    setSaving(true); setFormError("");
    try { await accountingApi.createVendorBill({ ...form, bill_number: form.bill_number.trim(), currency: form.currency.trim().toUpperCase(), lines: form.lines.map((line) => ({ ...line, description: line.description.trim() })) }); setModalOpen(false); refresh(); } catch (caught) { setFormError(getApiErrorMessage(caught)); } finally { setSaving(false); }
  };
  const exportCsv = () => {
    const header = ["Vendor", "Bill #", "Invoice date", "Due date", "Amount", "Currency", "Status", "Approver"];
    const body = rows.map((bill) => [bill.vendor_name ?? "", bill.bill_number, bill.bill_date, bill.due_date ?? "", bill.total_amount, bill.currency, bill.on_hold ? `${bill.status} (on hold)` : bill.status, bill.approved_by_name ?? ""]);
    const csv = [header, ...body].map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = "vendor-bills.csv"; link.click(); URL.revokeObjectURL(url);
  };
  const selectedTotal = rows.filter((row) => selected.includes(row.id)).reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const selectedCurrencies = new Set(rows.filter((row) => selected.includes(row.id)).map((row) => row.currency));

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">Accounts Payable</h1>
          <p className="mt-1.5 text-[1.0625rem] text-heading-support">Review, approve, and manage bills with control and confidence.</p>
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
          {can("vendor_bill.create") && <Button size="lg" leadingIcon={<Plus className="h-5 w-5" />} onClick={openCreate}>Create bill</Button>}
        </div>
      </header>

      {problem && <ErrorState variant="inline" title="Some bills were not updated" message={problem} />}

      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_26rem]">
        <section className="min-w-0 rounded-2xl border border-line bg-surface shadow-elevation-1">
          <div className="px-4 pt-2"><Tabs label="Bill status" value={tab} onChange={(value) => { setTab(value as TabKey); setSelected([]); }} items={TABS.map(([value, label]) => ({ value, label, count: summary?.counts[value] }))} /></div>
          <div className="flex flex-wrap gap-2 p-4">
            <label className="relative min-w-[14rem] flex-1"><span className="sr-only">Search bills</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by vendor, bill number or description" className="h-11 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm" /></label>
            <Button variant="secondary" size="lg" leadingIcon={<Filter className="h-4 w-4" />} aria-expanded={showFilters} onClick={() => setShowFilters((current) => !current)}>Filters</Button>
            <Button variant="secondary" size="lg" leadingIcon={<Upload className="h-4 w-4" />} disabled={!rows.length} onClick={exportCsv}>Export</Button>
          </div>
          {showFilters && (
            <div className="mx-4 mb-3 flex flex-wrap items-end gap-3 rounded-xl bg-surface-muted p-3 text-sm">
              <label><span className="mb-1 block text-caption font-semibold">Vendor</span><select value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2"><option value="">All vendors</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label>
              <p className="text-caption text-ink-muted">Bills dated from {formatDate(rangeStart)} (follows the range selector).</p>
            </div>
          )}
          {selected.length > 0 && (
            <div className="mx-4 mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-primary-soft/60 px-3 py-2 text-sm">
              <span className="font-semibold text-primary-ink">{selected.length} selected</span>
              <span className="tabular-nums text-ink">{formatAmount(String(selectedTotal), selectedCurrencies.size === 1 ? [...selectedCurrencies][0] : undefined)}</span>
              <Button size="sm" leadingIcon={<Layers className="h-4 w-4" />} onClick={() => setBulk({ ids: selected })}>Bulk actions</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
            </div>
          )}
          {error && <div className="px-4"><ErrorState variant="inline" title="Unable to load bills" message={error} onRetry={reload} /></div>}
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="bg-surface-muted text-left text-caption font-semibold text-ink-strong">
                <tr>
                  <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Select all bills" checked={rows.length > 0 && selected.length === rows.length} onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.id) : [])} className="h-4 w-4" /></th>
                  <th className="px-3 py-2">Vendor</th><th className="px-3 py-2">Bill #</th><th className="px-3 py-2">Invoice date</th><th className="px-3 py-2">Due date</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Approver</th><th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {loading && !bills && [0, 1, 2, 3, 4].map((index) => <tr key={index}><td colSpan={9} className="px-3 py-2.5"><div className="skeleton h-7 rounded" /></td></tr>)}
                {rows.map((bill) => (
                  <tr key={bill.id} className={cx("hover:bg-surface-hover", selected.includes(bill.id) && "bg-primary-soft/30")}>
                    <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Select ${bill.bill_number}`} checked={selected.includes(bill.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, bill.id] : current.filter((id) => id !== bill.id))} className="h-4 w-4" /></td>
                    <td className="px-3 py-2.5"><span className="flex items-center gap-2"><Avatar name={bill.vendor_name ?? "Vendor"} size="sm" /><span className="font-medium text-ink-strong">{bill.vendor_name}</span></span></td>
                    <td className="whitespace-nowrap px-3 py-2.5"><Link href={`/accounting/payables/bills/${bill.id}`} className="font-semibold text-primary-ink hover:underline">{bill.bill_number}</Link></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted">{formatDate(bill.bill_date)}</td>
                    <td className={cx("whitespace-nowrap px-3 py-2.5", bill.due_date && bill.due_date < new Date().toISOString().slice(0, 10) && !["PAID", "VOID"].includes(bill.status) ? "font-semibold text-danger-ink" : "text-ink-muted")}>{formatDate(bill.due_date)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{formatAmount(bill.total_amount, bill.currency)}</td>
                    <td className="px-3 py-2.5"><span className="flex flex-wrap gap-1"><StatusBadge status={bill.status} size="sm" />{bill.on_hold && <StatusBadge status="ON_HOLD" size="sm" />}</span></td>
                    <td className="px-3 py-2.5 text-ink-muted">{bill.approved_by_name ?? (bill.status === "PENDING" ? "Awaiting" : EM_DASH)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Menu label={`Actions for ${bill.bill_number}`} trigger={(props) => <button {...props} type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-hover" aria-label={`Actions for ${bill.bill_number}`}><MoreHorizontal className="h-5 w-5" /></button>}>
                        {(close) => <div className="p-1.5"><Link href={`/accounting/payables/bills/${bill.id}`} onClick={close} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-surface-hover"><FileText className="h-4 w-4" />Open bill</Link></div>}
                      </Menu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 0 && <p className="pt-3 text-sm text-ink-muted">{selected.length ? `${formatNumber(selected.length)} of ${formatNumber(rows.length)} bills selected` : `${formatNumber(rows.length)} bills`}</p>}
            {!loading && !rows.length && !error && (
              <div className="flex flex-col items-center py-12 text-center">
                <span className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-muted text-ink-muted"><FileText className="h-9 w-9" aria-hidden="true" /></span>
                <p className="mt-3 text-heading font-bold text-headline">No bills found</p>
                <p className="mt-1 max-w-sm text-support text-ink-muted">No bills match your selected filters. Try adjusting your search or filter criteria.</p>
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3"><FileText className="mt-0.5 h-7 w-7 text-section-icon" aria-hidden="true" /><div><h2 className="text-heading font-bold text-headline">Approval queue</h2><p className="text-support text-heading-support">Bills waiting for your action.</p></div></div>
              {(summary?.approval_queue_total ?? 0) > 0 && <button type="button" onClick={() => setTab("pending")} className="inline-flex items-center gap-1 text-sm font-semibold text-primary-ink hover:underline">View all<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>}
            </div>
            <ul className="mt-4 space-y-2">
              {(summary?.approval_queue ?? []).map((item) => (
                <li key={item.id}>
                  <Link href={`/accounting/payables/bills/${item.id}`} className="flex items-center gap-3 rounded-xl border border-line p-3 hover:border-primary/40 hover:bg-surface-hover">
                    <Avatar name={item.vendor} />
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-ink-strong">{item.vendor}</span><span className="text-caption text-ink-muted">{item.bill_number} · {formatAmount(item.amount, item.currency)}</span></span>
                    <span className="text-right"><span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold", item.on_hold ? "bg-mod-recruitment-soft text-mod-recruitment" : "bg-warning-soft text-warning-ink")}><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{item.on_hold ? "On hold" : "Approve"}</span><span className="block text-caption text-ink-muted">{daysAgo(item.submitted_at)}</span></span>
                    <ChevronRight className="h-5 w-5 text-primary-ink" aria-hidden="true" />
                  </Link>
                </li>
              ))}
              {summary && !summary.approval_queue.length && <li className="flex flex-col items-center py-6 text-center"><CheckSquare className="h-8 w-8 text-success" aria-hidden="true" /><p className="mt-2 font-semibold text-ink-strong">Nothing waiting</p><p className="text-support text-ink-muted">No bills are pending approval.</p></li>}
            </ul>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
            <h2 className="text-heading font-bold text-headline">Vendor &amp; payment summary</h2>
            <p className="text-support text-heading-support">Last {range} months.</p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {([[UsersRound, "Active vendors", summary ? formatNumber(summary.active_vendors) : EM_DASH], [FileText, "Total bills", summary ? formatNumber(summary.total_bills) : EM_DASH], [CreditCard, "Payments made", summary?.payments_made === null || summary?.payments_made === undefined ? EM_DASH : formatNumber(summary.payments_made)]] as const).map(([Icon, label, value]) => (
                <div key={label} className="rounded-xl border border-line p-3"><Icon className="h-6 w-6 text-section-icon" aria-hidden="true" /><p className="mt-2 text-caption text-ink-muted">{label}</p><p className="text-heading font-bold tabular-nums text-ink-strong">{value}</p></div>
              ))}
            </div>
            {summary && !summary.amounts_restricted && summary.payments_amount && <p className="mt-3 text-sm text-ink">Paid to vendors: <strong className="tabular-nums">{formatAmount(summary.payments_amount)}</strong></p>}
            {summary?.amounts_restricted && <div className="mt-4 flex gap-2.5 rounded-xl bg-primary-soft/60 p-3 text-sm"><Info className="mt-0.5 h-5 w-5 shrink-0 text-primary-ink" aria-hidden="true" /><div><p className="font-semibold text-headline">Financial details restricted</p><p className="text-ink">Payment amounts are hidden based on your access level. Contact your system administrator for extended permissions.</p></div></div>}
          </section>
        </aside>
      </div>

      <RecentBatchJobs jobs={jobs?.results ?? []} total={jobs?.count ?? 0} onRetry={(job) => setBulk({ ids: job.results.filter((item) => item.status === "failed").map((item) => item.id), operation: job.operation })} onViewAll={() => setJobLimit(50)} />

      <BulkActionsPanel
        open={Boolean(bulk)}
        ids={bulk?.ids ?? []}
        initialOperation={bulk?.operation}
        onClose={() => setBulk(null)}
        onClearSelection={() => setSelected([])}
        onComplete={(job) => { setSelected([]); refresh(); reloadJobs(); if (job.failed) setProblem(`${job.operation_label}: ${job.failed} of ${job.total_items} bills were not updated. Open the batch report for details.`); else setProblem(null); }}
      />

      {modalOpen && <BillModal form={form} vendors={vendors} accounts={refs?.[1].results ?? []} periods={refs?.[2].results ?? []} error={formError} saving={saving} onChange={setForm} onClose={() => setModalOpen(false)} onSave={() => void save()} />}
    </div>
  );
}

function BillModal({ form, vendors, accounts, periods, error, saving, onChange, onClose, onSave }: { form: BillForm; vendors: Array<{ id: string; name: string; vendor_code: string }>; accounts: Array<{ id: string; code: string; name: string }>; periods: Array<{ id: string; name: string; start_date: string; end_date: string }>; error: string; saving: boolean; onChange: (form: BillForm) => void; onClose: () => void; onSave: () => void }) { const setLine = (index: number, change: Partial<BillLineForm>) => onChange({ ...form, lines: form.lines.map((line, itemIndex) => itemIndex === index ? { ...line, ...change } : line) }); return <div className="fixed inset-0 z-50 overflow-y-auto bg-overlay p-4"><div className="mx-auto my-8 w-full max-w-4xl rounded-2xl bg-surface shadow-xl"><div className="flex items-center justify-between border-b p-5"><div><h2 className="text-lg font-bold">New Vendor Bill</h2><p className="text-sm text-ink-muted">Save a draft first; submission, approval and posting use backend workflow actions.</p></div><button type="button" onClick={onClose} disabled={saving} aria-label="Close vendor bill form"><X size={19} /></button></div>{error && <p className="mx-5 mt-4 rounded border border-danger/25 bg-danger-soft p-3 text-sm text-danger-ink">{error}</p>}<div className="grid gap-4 p-5 sm:grid-cols-2"><Field label="Vendor"><select value={form.vendor} onChange={(event) => onChange({ ...form, vendor: event.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 w-full"><option value="">Select vendor</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_code} — {vendor.name}</option>)}</select></Field><Field label="Bill number"><input value={form.bill_number} onChange={(event) => onChange({ ...form, bill_number: event.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 w-full" /></Field><Field label="Bill date"><input type="date" value={form.bill_date} onChange={(event) => onChange({ ...form, bill_date: event.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 w-full" /></Field><Field label="Due date"><input type="date" value={form.due_date} onChange={(event) => onChange({ ...form, due_date: event.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 w-full" /></Field><Field label="Currency"><input value={form.currency} onChange={(event) => onChange({ ...form, currency: event.target.value.toUpperCase() })} maxLength={3} placeholder="e.g. GHS" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 w-full" /></Field><Field label="Open accounting period"><select value={form.accounting_period} onChange={(event) => onChange({ ...form, accounting_period: event.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 w-full"><option value="">Select period</option>{periods.map((period) => <option key={period.id} value={period.id}>{period.name} ({formatDate(period.start_date)} – {formatDate(period.end_date)})</option>)}</select></Field></div><div className="border-t px-5 pb-5 pt-4"><div className="flex items-center justify-between"><div><h3 className="font-semibold">Bill lines</h3><p className="text-sm text-ink-muted">Tax and withholding rules are applied only when configured by the backend.</p></div><button type="button" onClick={() => onChange({ ...form, lines: [...form.lines, emptyLine()] })} className={buttonClasses({ variant: "secondary", size: "sm" })}>Add line</button></div><div className="mt-4 space-y-3">{form.lines.map((line, index) => <div key={index} className="grid gap-3 rounded-xl border p-3 md:grid-cols-[minmax(0,1fr)_minmax(180px,1fr)_110px_130px_auto]"><input value={line.description} onChange={(event) => setLine(index, { description: event.target.value })} placeholder="Description" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15" /><select value={line.expense_account} onChange={(event) => setLine(index, { expense_account: event.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"><option value="">Expense account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select><input type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => setLine(index, { quantity: event.target.value })} placeholder="Quantity" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15" /><input type="number" min="0" step="0.0001" value={line.unit_price} onChange={(event) => setLine(index, { unit_price: event.target.value })} placeholder="Unit price" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15" /><button type="button" disabled={form.lines.length === 1} onClick={() => onChange({ ...form, lines: form.lines.filter((_, itemIndex) => itemIndex !== index) })} className={buttonClasses({ variant: "secondary", size: "sm", className: "disabled:opacity-40" })}>Remove</button></div>)}</div></div><div className="flex justify-end gap-3 border-t p-5"><button type="button" onClick={onClose} disabled={saving} className={buttonClasses({ variant: "secondary" })}>Cancel</button><button type="button" onClick={onSave} disabled={saving} className={buttonClasses({ variant: "primary" })}>{saving ? "Saving..." : "Create Draft"}</button></div></div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="space-y-1"><span className="text-sm font-medium">{label}</span>{children}</label>; }
