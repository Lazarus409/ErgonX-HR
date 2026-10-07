"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { AlertTriangle, BarChart3, CalendarClock, CalendarDays, ChevronDown, ChevronRight, CircleAlert, FileText, Filter, Info, Mail, MoreHorizontal, Plus, Search, Settings, Upload, UsersRound, X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Avatar, MetricCard } from "@/components/ui/Card";
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

type Line = { description: string; income_account: string; quantity: string; unit_price: string };
type Form = { customer: string; invoice_number: string; invoice_date: string; due_date: string; currency: string; accounting_period: string; external_tax_reference: string; lines: Line[] };
const dateToday = () => new Date().toISOString().slice(0, 10);
const newLine = (): Line => ({ description: "", income_account: "", quantity: "1", unit_price: "" });
const newForm = (): Form => ({ customer: "", invoice_number: "", invoice_date: dateToday(), due_date: dateToday(), currency: "", accounting_period: "", external_tax_reference: "", lines: [newLine()] });

type TabKey = "all" | "outstanding" | "overdue" | "paid" | "on_hold" | "drafts";
const TABS: Array<[TabKey, string]> = [["all", "All invoices"], ["outstanding", "Outstanding"], ["overdue", "Overdue"], ["paid", "Paid"], ["on_hold", "On hold"], ["drafts", "Drafts"]];

/** Concept "Accounts receivable" (option 1). */
export default function ReceivablesPage() {
  const { can } = useAccess();
  const [range, setRange] = useState<3 | 6 | 12>(12);
  const [tab, setTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [customerFilter, setCustomerFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(newForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadSummary = useCallback(() => accountingApi.getReceivablesSummary(range), [range]);
  const { data: summary, reload: reloadSummary } = useApiResource(loadSummary);
  const loadInvoices = useCallback(() => {
    const status = tab === "paid" ? "PAID" : tab === "drafts" ? "DRAFT" : undefined;
    return accountingApi.listInvoices({ page_size: MAX_PAGE_SIZE, ordering: "-invoice_date", search: search.trim() || undefined, customer: customerFilter || undefined, status, ...(tab === "on_hold" ? { on_hold: true } : {}) } as Parameters<typeof accountingApi.listInvoices>[0]);
  }, [tab, search, customerFilter]);
  const { data: invoices, loading, error, reload } = useApiResource(loadInvoices);
  const loadRefs = useCallback(() => Promise.all([
    accountingApi.listCustomers({ page_size: MAX_PAGE_SIZE, is_active: true }),
    accountingApi.listAccounts({ page_size: MAX_PAGE_SIZE, account_type: "INCOME", is_active: true, is_postable: true, ordering: "code" }),
    accountingApi.listAccountingPeriods({ page_size: MAX_PAGE_SIZE, status: "OPEN", ordering: "start_date" }),
  ]), []);
  const { data: refs } = useApiResource(loadRefs);
  const customers = refs?.[0].results ?? [];
  const today = summary?.today ?? new Date().toISOString().slice(0, 10);
  const rangeStart = summary?.range_start ?? "";
  const openStatus = (status: string) => status === "ISSUED" || status === "PART_PAID";
  const rows = (invoices?.results ?? []).filter((invoice) => (!rangeStart || invoice.invoice_date >= rangeStart)
    && (tab !== "outstanding" || openStatus(invoice.status))
    && (tab !== "overdue" || (openStatus(invoice.status) && (invoice.due_date ?? "") < today)));
  const refresh = () => { reload(); reloadSummary(); };
  const displayStatus = (status: string, due: string | null) => (openStatus(status) && due && due < today ? "OVERDUE" : status === "ISSUED" ? "PENDING" : status);
  const amount = (value: string | null | undefined) => (summary?.amounts_restricted ? EM_DASH : value ? formatAmount(value) : EM_DASH);

  const save = async () => { if (!form.customer || !form.invoice_date || !form.due_date || !form.currency.trim() || !form.accounting_period || form.lines.some((line) => !line.description.trim() || !line.income_account || !line.quantity || !line.unit_price)) { setFormError("Complete the invoice header and every line before saving."); return; } setSaving(true); setFormError(""); try { await accountingApi.createInvoice({ ...form, invoice_number: form.invoice_number.trim(), currency: form.currency.trim().toUpperCase(), external_tax_reference: form.external_tax_reference.trim() || null, lines: form.lines.map((line) => ({ ...line, description: line.description.trim() })) }); setOpen(false); refresh(); } catch (caught) { setFormError(getApiErrorMessage(caught)); } finally { setSaving(false); } };
  const exportCsv = () => {
    const header = ["Customer", "Invoice #", "Issue date", "Due date", "Amount", "Amount due", "Currency", "Status"];
    const body = rows.map((invoice) => [invoice.customer_name ?? "", invoice.invoice_number, invoice.invoice_date, invoice.due_date ?? "", invoice.total_amount, invoice.amount_due ?? "", invoice.currency, displayStatus(invoice.status, invoice.due_date)]);
    const csv = [header, ...body].map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = "customer-invoices.csv"; link.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">Accounts Receivable</h1>
          <p className="mt-1.5 text-[1.0625rem] text-heading-support">Track invoices, monitor payments, and keep your cash flow on pace.</p>
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
          {can("invoice.create") && <Button size="lg" leadingIcon={<Plus className="h-5 w-5" />} onClick={() => { setForm(newForm()); setFormError(""); setOpen(true); }}>Create invoice</Button>}
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Receivables indicators">
        <MetricCard label="Outstanding invoices" value={summary ? formatNumber(summary.outstanding.count) : EM_DASH} description={summary?.outstanding.count ? `${amount(summary.outstanding.amount)} still due` : "No data available"} icon={FileText} accent="brand" loading={!summary} />
        <MetricCard label="Due this week" value={summary ? formatNumber(summary.due_this_week.count) : EM_DASH} description={summary?.due_this_week.count ? `${amount(summary.due_this_week.amount)} due in the next 7 days` : "No invoices due in the next 7 days"} icon={CalendarDays} accent="leave" loading={!summary} />
        <MetricCard label="Overdue invoices" value={summary ? formatNumber(summary.overdue.count) : EM_DASH} description={summary?.overdue.count ? `${amount(summary.overdue.amount)} past due` : "No overdue invoices"} icon={AlertTriangle} accent="audit" loading={!summary} />
        <MetricCard label="Exceptions" value={summary ? formatNumber(summary.exceptions.count) : EM_DASH} description={summary?.exceptions.count ? `${summary.exceptions.on_hold} on hold · ${summary.exceptions.over_60_days} over 60 days overdue` : "No invoices with issues"} icon={CircleAlert} accent="recruitment" loading={!summary} />
      </section>

      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_26rem]">
        <section className="min-w-0 rounded-2xl border border-line bg-surface shadow-elevation-1">
          <div className="px-4 pt-2"><Tabs label="Invoice status" value={tab} onChange={(value) => { setTab(value as TabKey); setSelected([]); }} items={TABS.map(([value, text]) => ({ value, label: text, count: summary?.counts[value] }))} /></div>
          <div className="flex flex-wrap gap-2 p-4">
            <label className="relative min-w-[14rem] flex-1"><span className="sr-only">Search invoices</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by customer, invoice number or description" className="h-11 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm" /></label>
            <Button variant="secondary" size="lg" leadingIcon={<Filter className="h-4 w-4" />} aria-expanded={showFilters} onClick={() => setShowFilters((current) => !current)}>Filters</Button>
            <Button variant="secondary" size="lg" leadingIcon={<Upload className="h-4 w-4" />} disabled={!rows.length} onClick={exportCsv}>Export</Button>
          </div>
          {showFilters && <div className="mx-4 mb-3 flex flex-wrap items-end gap-3 rounded-xl bg-surface-muted p-3 text-sm"><label><span className="mb-1 block text-caption font-semibold">Customer</span><select value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2"><option value="">All customers</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>{rangeStart && <p className="text-caption text-ink-muted">Invoices issued from {formatDate(rangeStart)}.</p>}</div>}
          {selected.length > 0 && <div className="mx-4 mb-3 flex items-center gap-3 rounded-xl bg-primary-soft/60 px-3 py-2 text-sm"><span className="font-semibold text-primary-ink">{selected.length} selected</span><Button size="sm" variant="secondary" leadingIcon={<Upload className="h-4 w-4" />} onClick={exportCsv}>Export</Button><Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button></div>}
          {error && <div className="px-4"><ErrorState variant="inline" title="Unable to load invoices" message={error} onRetry={reload} /></div>}
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="bg-surface-muted text-left text-caption font-semibold text-ink-strong">
                <tr><th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Select all invoices" checked={rows.length > 0 && selected.length === rows.length} onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.id) : [])} className="h-4 w-4" /></th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Invoice #</th><th className="px-3 py-2">Issue date</th><th className="px-3 py-2">Due date</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {loading && !invoices && [0, 1, 2, 3, 4].map((index) => <tr key={index}><td colSpan={8} className="px-3 py-2.5"><div className="skeleton h-7 rounded" /></td></tr>)}
                {rows.map((invoice) => (
                  <tr key={invoice.id} className={cx("hover:bg-surface-hover", selected.includes(invoice.id) && "bg-primary-soft/30")}>
                    <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Select ${invoice.invoice_number}`} checked={selected.includes(invoice.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, invoice.id] : current.filter((id) => id !== invoice.id))} className="h-4 w-4" /></td>
                    <td className="px-3 py-2.5"><span className="flex items-center gap-2"><Avatar name={invoice.customer_name ?? "Customer"} size="sm" /><span className="font-medium text-ink-strong">{invoice.customer_name}</span></span></td>
                    <td className="whitespace-nowrap px-3 py-2.5"><Link href={`/accounting/receivables/invoices/${invoice.id}`} className="font-semibold text-primary-ink hover:underline">{invoice.invoice_number}</Link></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted">{formatDate(invoice.invoice_date)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted">{formatDate(invoice.due_date)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{summary?.amounts_restricted ? "••••••" : formatAmount(invoice.total_amount, invoice.currency)}</td>
                    <td className="px-3 py-2.5"><span className="flex flex-wrap gap-1"><StatusBadge status={displayStatus(invoice.status, invoice.due_date)} size="sm" />{invoice.on_hold && <StatusBadge status="ON_HOLD" size="sm" />}</span></td>
                    <td className="px-3 py-2.5 text-right"><Menu label={`Actions for ${invoice.invoice_number}`} trigger={(props) => <button {...props} type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-hover" aria-label={`Actions for ${invoice.invoice_number}`}><MoreHorizontal className="h-5 w-5" /></button>}>{(close) => <div className="p-1.5"><Link href={`/accounting/receivables/invoices/${invoice.id}`} onClick={close} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-surface-hover"><FileText className="h-4 w-4" />Open invoice</Link></div>}</Menu></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !rows.length && !error && <div className="flex flex-col items-center py-12 text-center"><span className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-muted text-ink-muted"><FileText className="h-9 w-9" aria-hidden="true" /></span><p className="mt-3 text-heading font-bold text-headline">No invoices found</p><p className="mt-1 max-w-sm text-support text-ink-muted">No invoices match your selected filters. Try adjusting your search or filter criteria.</p></div>}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
            <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><FileText className="mt-0.5 h-7 w-7 text-section-icon" aria-hidden="true" /><div><h2 className="text-heading font-bold text-headline">Upcoming receipts</h2><p className="text-support text-heading-support">Payments expected from customers in the next 30 days.</p></div></div>{(summary?.upcoming_receipts.length ?? 0) > 0 && <button type="button" onClick={() => setTab("outstanding")} className="inline-flex items-center gap-1 text-sm font-semibold text-primary-ink hover:underline">View all<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>}</div>
            <ul className="mt-4 space-y-2">
              {(summary?.upcoming_receipts ?? []).map((item) => (
                <li key={item.id}><Link href={`/accounting/receivables/invoices/${item.id}`} className="flex items-center gap-3 rounded-xl border border-line p-3 hover:border-primary/40 hover:bg-surface-hover"><CalendarClock className="h-6 w-6 shrink-0 text-section-icon" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block truncate font-semibold text-ink-strong">{item.customer}</span><span className="text-caption text-ink-muted">{item.invoice_number} · due {formatDate(item.due_date)}</span></span><span className="text-sm font-semibold tabular-nums">{item.amount_due ? formatAmount(item.amount_due, item.currency) : "••••"}</span></Link></li>
              ))}
              {summary && !summary.upcoming_receipts.length && <li className="flex flex-col items-center py-6 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-ink-muted"><CalendarDays className="h-6 w-6" aria-hidden="true" /></span><p className="mt-2 font-bold text-headline">No upcoming receipts</p><p className="text-support text-ink-muted">No customer payments are expected in the next 30 days.</p></li>}
            </ul>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
            <h2 className="flex items-center gap-2 text-heading font-bold text-headline"><Settings className="h-6 w-6 text-section-icon" aria-hidden="true" />Accounts receivable controls</h2>
            <ul className="mt-3 space-y-2">
              {([[UsersRound, "Customer management", "Add and manage customer accounts", "/accounting/receivables/customers"], [BarChart3, "Aging report", "View invoice aging and balances", "/accounting/reports"], [Mail, "Dunning and reminders", "Follow up on overdue invoices", "#overdue"], [Settings, "AR settings", "Configure accounting and tax preferences", "/accounting/ghana-setup"]] as const).map(([Icon, title, text, href]) => (
                <li key={title}>{href === "#overdue" ? (
                  <button type="button" onClick={() => setTab("overdue")} className="flex w-full items-center gap-3 rounded-xl border border-line p-3 text-left hover:border-primary/40 hover:bg-surface-hover"><Icon className="h-6 w-6 text-section-icon" aria-hidden="true" /><span className="flex-1"><span className="block font-semibold text-ink-strong">{title}</span><span className="text-caption text-ink-muted">{text}</span></span><ChevronRight className="h-5 w-5 text-primary-ink" aria-hidden="true" /></button>
                ) : (
                  <Link href={href} className="flex items-center gap-3 rounded-xl border border-line p-3 hover:border-primary/40 hover:bg-surface-hover"><Icon className="h-6 w-6 text-section-icon" aria-hidden="true" /><span className="flex-1"><span className="block font-semibold text-ink-strong">{title}</span><span className="text-caption text-ink-muted">{text}</span></span><ChevronRight className="h-5 w-5 text-primary-ink" aria-hidden="true" /></Link>
                )}</li>
              ))}
            </ul>
            {summary?.amounts_restricted && <div className="mt-4 flex gap-2.5 rounded-xl bg-primary-soft/60 p-3 text-sm"><Info className="mt-0.5 h-5 w-5 shrink-0 text-primary-ink" aria-hidden="true" /><div><p className="font-semibold text-headline">Financial details restricted</p><p className="text-ink">Amounts are hidden based on your access level. Contact your system administrator for extended permissions.</p></div></div>}
          </section>
        </aside>
      </div>

      {open && <InvoiceModal form={form} customers={customers} accounts={refs?.[1].results ?? []} periods={refs?.[2].results ?? []} error={formError} saving={saving} onChange={setForm} onClose={() => setOpen(false)} onSave={() => void save()} />}
    </div>
  );
}

function InvoiceModal({ form, customers, accounts, periods, error, saving, onChange, onClose, onSave }: { form: Form; customers: Array<{ id: string; name: string; customer_code: string }>; accounts: Array<{ id: string; code: string; name: string }>; periods: Array<{ id: string; name: string }>; error: string; saving: boolean; onChange: (form: Form) => void; onClose: () => void; onSave: () => void }) { const setLine = (index: number, change: Partial<Line>) => onChange({ ...form, lines: form.lines.map((line, item) => item === index ? { ...line, ...change } : line) }); return <div className="fixed inset-0 z-50 overflow-y-auto bg-overlay p-4"><div className="mx-auto my-8 w-full max-w-4xl rounded-2xl bg-surface shadow-xl"><div className="flex items-center justify-between border-b p-5"><div><h2 className="text-lg font-bold">Create Invoice</h2><p className="text-sm text-ink-muted">Save a draft first; issuing uses the backend workflow action.</p></div><button type="button" onClick={onClose} disabled={saving} aria-label="Close invoice form"><X size={19} /></button></div>{error && <p className="mx-5 mt-4 rounded border border-danger/25 bg-danger-soft p-3 text-sm text-danger-ink">{error}</p>}<div className="grid gap-4 p-5 sm:grid-cols-2"><Label text="Customer"><select value={form.customer} onChange={(event) => onChange({ ...form, customer: event.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 w-full"><option value="">Select customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.customer_code} — {customer.name}</option>)}</select></Label><Label text="Invoice number (optional)"><input value={form.invoice_number} onChange={(event) => onChange({ ...form, invoice_number: event.target.value })} placeholder="Auto-generated if left blank" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 w-full" /></Label><Label text="Invoice date"><input type="date" value={form.invoice_date} onChange={(event) => onChange({ ...form, invoice_date: event.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 w-full" /></Label><Label text="Due date"><input type="date" value={form.due_date} onChange={(event) => onChange({ ...form, due_date: event.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 w-full" /></Label><Label text="Currency"><input value={form.currency} onChange={(event) => onChange({ ...form, currency: event.target.value.toUpperCase() })} maxLength={3} placeholder="e.g. GHS" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 w-full" /></Label><Label text="Open accounting period"><select value={form.accounting_period} onChange={(event) => onChange({ ...form, accounting_period: event.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 w-full"><option value="">Select period</option>{periods.map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}</select></Label><Label text="External tax reference (optional)"><input value={form.external_tax_reference} onChange={(event) => onChange({ ...form, external_tax_reference: event.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 w-full" /></Label></div><div className="border-t px-5 pb-5 pt-4"><div className="flex items-center justify-between"><div><h3 className="font-semibold">Invoice lines</h3><p className="text-sm text-ink-muted">Tax is applied only when the backend has an applicable configured rule.</p></div><button type="button" onClick={() => onChange({ ...form, lines: [...form.lines, newLine()] })} className={buttonClasses({ variant: "secondary", size: "sm" })}>Add line</button></div><div className="mt-4 space-y-3">{form.lines.map((line, index) => <div key={index} className="grid gap-3 rounded-xl border p-3 md:grid-cols-[minmax(0,1fr)_minmax(180px,1fr)_110px_130px_auto]"><input value={line.description} onChange={(event) => setLine(index, { description: event.target.value })} placeholder="Description" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15" /><select value={line.income_account} onChange={(event) => setLine(index, { income_account: event.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"><option value="">Revenue account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select><input type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => setLine(index, { quantity: event.target.value })} placeholder="Quantity" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15" /><input type="number" min="0" step="0.0001" value={line.unit_price} onChange={(event) => setLine(index, { unit_price: event.target.value })} placeholder="Unit price" className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15" /><button type="button" disabled={form.lines.length === 1} onClick={() => onChange({ ...form, lines: form.lines.filter((_, item) => item !== index) })} className={buttonClasses({ variant: "secondary", size: "sm", className: "disabled:opacity-40" })}>Remove</button></div>)}</div></div><div className="flex justify-end gap-3 border-t p-5"><button type="button" onClick={onClose} disabled={saving} className={buttonClasses({ variant: "secondary" })}>Cancel</button><button type="button" onClick={onSave} disabled={saving} className={buttonClasses({ variant: "primary" })}>{saving ? "Saving..." : "Create Draft"}</button></div></div></div>; }
function Label({ text, children }: { text: string; children: React.ReactNode }) { return <label className="space-y-1"><span className="text-sm font-medium">{text}</span>{children}</label>; }
