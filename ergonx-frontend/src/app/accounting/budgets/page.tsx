"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, ChevronDown, ChevronRight, FileText, Filter, Folder, Layers, Lock, Network, Plus, Search, Settings, Upload, UserCheck } from "lucide-react";

import { ButtonLink } from "@/components/ui/Button";
import ErrorState from "@/components/ui/ErrorState";
import StatusBadge from "@/components/ui/StatusBadge";
import Tabs from "@/components/ui/Tabs";
import { accountingApi } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { cx } from "@/lib/cx";
import { EM_DASH, formatAmount, formatDate } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";

type Tab = "overview" | "departments" | "initiatives" | "comparisons";

/** Concept "Budgets" (option 2). */
export default function BudgetsPage() {
  const { can } = useAccess();
  const [fiscalYear, setFiscalYear] = useState("");
  const [department, setDepartment] = useState<string>("");
  const [folderSearch, setFolderSearch] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [statusFilter, setStatusFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(() => accountingApi.getBudgetOverview({ fiscal_year: fiscalYear, department }), [fiscalYear, department]);
  const { data, loading, error, reload } = useApiResource(load);
  const folders = useMemo(() => (data?.folders ?? []).filter((folder) => !folderSearch.trim() || folder.name.toLowerCase().includes(folderSearch.trim().toLowerCase())), [data, folderSearch]);
  const budgets = (data?.budgets ?? []).filter((row) => !statusFilter || row.status === statusFilter);
  const chosen = budgets.find((row) => row.id === selected) ?? null;
  const year = data?.fiscal_years.find((item) => item.id === (fiscalYear || data?.fiscal_year));
  const maxComparison = Math.max(1, ...(data?.comparisons ?? []).map((row) => Math.max(Number(row.allocated), Number(row.actual) + Number(row.committed))));
  const canManage = can("budget.manage");

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div><h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">Budgets</h1><p className="mt-1.5 text-[1.0625rem] text-heading-support">Plan, monitor and manage budgets to drive financial discipline.</p></div>
        {canManage && <ButtonLink href="/accounting/budgets/new" size="lg" leadingIcon={<Plus className="h-5 w-5" />}>Create budget</ButtonLink>}
      </header>

      <div className="flex flex-wrap gap-3">
        <label className="min-w-[15rem]"><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Fiscal period</span>
          <span className="relative block"><Layers className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-section-icon" aria-hidden="true" /><select value={fiscalYear || data?.fiscal_year || ""} onChange={(event) => setFiscalYear(event.target.value)} className="h-12 w-full appearance-none rounded-lg border border-line-strong bg-surface pl-11 pr-10 text-sm">{(data?.fiscal_years ?? []).map((item) => <option key={item.id} value={item.id}>{item.name} ({formatDate(item.start_date)} – {formatDate(item.end_date)})</option>)}{!data?.fiscal_years.length && <option value="">No fiscal years set up</option>}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /></span>
        </label>
        <label className="min-w-[15rem]"><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Department / cost centre</span>
          <span className="relative block"><Network className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-section-icon" aria-hidden="true" /><select value={department} onChange={(event) => { setDepartment(event.target.value); setSelected(null); }} className="h-12 w-full appearance-none rounded-lg border border-line-strong bg-surface pl-11 pr-10 text-sm"><option value="">All departments / functional areas</option>{(data?.folders ?? []).filter((folder) => folder.id).map((folder) => <option key={folder.id} value={folder.id ?? ""}>{folder.name}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /></span>
        </label>
      </div>

      {error && <ErrorState variant="inline" title="Unable to load budgets" message={error} onRetry={reload} />}

      <div className="grid items-start gap-4 xl:grid-cols-[17rem_minmax(0,1fr)] 2xl:grid-cols-[18rem_minmax(0,1fr)_20rem]">
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1 xl:row-span-2 2xl:row-span-1">
          <div className="flex items-start gap-3"><Layers className="mt-0.5 h-7 w-7 text-section-icon" aria-hidden="true" /><div><h2 className="text-heading font-bold text-headline">Budget folders</h2><p className="text-support text-heading-support">Organise and view your budgets.</p></div></div>
          <label className="relative mt-3 block"><span className="sr-only">Search departments / functional areas</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /><input value={folderSearch} onChange={(event) => setFolderSearch(event.target.value)} placeholder="Search departments / functional areas" className="h-10 w-full rounded-lg border border-line bg-surface-muted pl-9 pr-3 text-sm" /></label>
          <ul className="mt-3 space-y-1 text-sm">
            <li><button type="button" onClick={() => { setDepartment(""); setSelected(null); }} className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-hover", !department && "bg-primary-soft font-semibold text-primary-ink")}><Layers className="h-5 w-5" aria-hidden="true" /><span className="flex-1">All budgets</span><span className="rounded-full bg-surface px-2 text-caption font-semibold">{data?.total_budgets ?? 0}</span></button></li>
            {folders.map((folder) => (
              <li key={folder.id ?? "none"}><button type="button" disabled={!folder.id} onClick={() => { setDepartment(folder.id ?? ""); setSelected(null); }} className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-hover disabled:cursor-default", folder.id === department && "bg-primary-soft font-semibold text-primary-ink")}><Folder className="h-5 w-5 text-ink-muted" aria-hidden="true" /><span className="flex-1 truncate">{folder.name}</span><span className="rounded-full bg-surface-muted px-2 text-caption font-semibold">{folder.count}</span></button></li>
            ))}
            {data && !data.folders.length && <li className="px-3 py-4 text-center text-ink-muted">No budgets for this period yet.</li>}
          </ul>
        </section>

        <section className="min-w-0 rounded-2xl border border-line bg-surface shadow-elevation-1 xl:order-3 2xl:order-none">
          <div className="flex flex-wrap items-end justify-between gap-2 px-4 pt-2">
            <Tabs label="Budget views" value={tab} onChange={(value) => setTab(value as Tab)} items={[{ value: "overview", label: "Budget overview" }, { value: "departments", label: "Department / Functional Area budgets", count: budgets.length }, { value: "initiatives", label: "Initiatives" }, { value: "comparisons", label: "Comparisons" }]} />
            <button type="button" onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters} className="mb-2 inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong px-3 text-sm font-semibold text-primary-ink"><Filter className="h-4 w-4" aria-hidden="true" />Filters</button>
          </div>
          {showFilters && <div className="mx-4 mb-2 flex items-center gap-3 rounded-xl bg-surface-muted p-3 text-sm"><label className="flex items-center gap-2">Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2"><option value="">Any status</option>{["DRAFT", "PENDING_APPROVAL", "APPROVED", "RETURNED"].map((value) => <option key={value} value={value}>{value.replace("_", " ").toLowerCase()}</option>)}</select></label></div>}
          <div className="overflow-x-auto p-4 pt-2">
            {loading && !data && <div className="skeleton h-64 rounded-xl" />}
            {data && !data.total_budgets && (
              <div className="flex flex-col items-center py-12 text-center">
                <span className="flex h-24 w-24 items-center justify-center rounded-full bg-primary-soft text-section-icon"><FileText className="h-10 w-10" aria-hidden="true" /></span>
                <p className="mt-4 text-heading font-bold text-headline">No budgets for {year?.name ?? "this period"}</p>
                <p className="mt-1 max-w-md text-support text-ink-muted">Create a budget to plan allocations and track actual and committed spend.</p>
                <ul className="mt-5 space-y-2 text-left text-sm">{["Plan budgets by department / functional area or initiative", "Track actuals and committed spend", "Monitor variances", "Submit for approval when ready"].map((text) => <li key={text} className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 text-ink-subtle" aria-hidden="true" />{text}</li>)}</ul>
              </div>
            )}
            {data && data.total_budgets > 0 && tab === "overview" && (
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-surface-muted text-left text-caption font-semibold uppercase tracking-wide text-ink-strong"><tr><th className="px-3 py-2">Category</th><th className="px-3 py-2 text-right">Allocated</th><th className="px-3 py-2 text-right">Actual</th><th className="px-3 py-2 text-right">Committed</th><th className="px-3 py-2 text-right">Variance</th><th className="px-3 py-2">Status</th></tr></thead>
                <tbody className="divide-y divide-line-soft">{data.categories.map((row) => <tr key={row.category}><td className="px-3 py-2.5 font-medium">{row.label}</td><td className="px-3 py-2.5 text-right tabular-nums">{formatAmount(row.allocated)}</td><td className="px-3 py-2.5 text-right tabular-nums">{formatAmount(row.actual)}</td><td className="px-3 py-2.5 text-right tabular-nums">{formatAmount(row.committed)}</td><td className={cx("px-3 py-2.5 text-right tabular-nums", Number(row.variance) < 0 && "text-danger-ink")}>{formatAmount(row.variance)}</td><td className="px-3 py-2.5"><StatusBadge status={row.status} size="sm" /></td></tr>)}</tbody>
              </table>
            )}
            {data && data.total_budgets > 0 && tab === "departments" && (
              <table className="w-full min-w-[44rem] text-sm">
                <thead className="bg-surface-muted text-left text-caption font-semibold text-ink-strong"><tr><th className="px-3 py-2">Budget</th><th className="px-3 py-2">Department / Functional Area</th><th className="px-3 py-2 text-right">Allocated</th><th className="px-3 py-2 text-right">Actual</th><th className="px-3 py-2 text-right">Remaining</th><th className="px-3 py-2">Status</th></tr></thead>
                <tbody className="divide-y divide-line-soft">{budgets.map((row) => <tr key={row.id} onClick={() => setSelected(row.id)} className={cx("cursor-pointer hover:bg-surface-hover", row.id === selected && "bg-primary-soft/40")}><td className="px-3 py-2.5"><Link href={`/accounting/budgets/${row.id}`} className="font-semibold text-primary-ink hover:underline">{row.name}</Link><span className="block text-caption text-ink-muted">{row.code}</span></td><td className="px-3 py-2.5">{row.department}</td><td className="px-3 py-2.5 text-right tabular-nums">{formatAmount(row.allocated)}</td><td className="px-3 py-2.5 text-right tabular-nums">{formatAmount(row.actual)}</td><td className={cx("px-3 py-2.5 text-right tabular-nums", Number(row.remaining) < 0 && "text-danger-ink")}>{formatAmount(row.remaining)}</td><td className="px-3 py-2.5"><StatusBadge status={row.status} size="sm" /></td></tr>)}</tbody>
              </table>
            )}
            {data && data.total_budgets > 0 && tab === "initiatives" && (
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-surface-muted text-left text-caption font-semibold text-ink-strong"><tr><th className="px-3 py-2">Initiative</th><th className="px-3 py-2">Budgets</th><th className="px-3 py-2 text-right">Allocated</th><th className="px-3 py-2 text-right">Actual</th><th className="px-3 py-2 text-right">Committed</th></tr></thead>
                <tbody className="divide-y divide-line-soft">{data.initiatives.map((row) => <tr key={row.initiative}><td className="px-3 py-2.5 font-medium">{row.initiative}</td><td className="px-3 py-2.5 text-ink-muted">{row.budgets.join(", ")}</td><td className="px-3 py-2.5 text-right tabular-nums">{formatAmount(row.allocated)}</td><td className="px-3 py-2.5 text-right tabular-nums">{formatAmount(row.actual)}</td><td className="px-3 py-2.5 text-right tabular-nums">{formatAmount(row.committed)}</td></tr>)}</tbody>
              </table>
            )}
            {data && data.total_budgets > 0 && tab === "comparisons" && (
              <ul className="space-y-4">
                {data.comparisons.map((row) => {
                  const spent = Number(row.actual) + Number(row.committed);
                  return (
                    <li key={row.department} className="text-sm">
                      <div className="flex justify-between"><span className="font-semibold text-ink-strong">{row.department} <span className="font-normal text-ink-muted">· {row.budgets} budget{row.budgets === 1 ? "" : "s"}</span></span><span className="tabular-nums text-ink-muted">{formatAmount(spent)} of {formatAmount(row.allocated)}</span></div>
                      <div className="mt-1.5 space-y-1">
                        <div className="h-2.5 rounded-full bg-primary/80" style={{ width: `${(Number(row.allocated) / maxComparison) * 100}%` }} title="Allocated" />
                        <div className={cx("h-2.5 rounded-full", spent > Number(row.allocated) ? "bg-danger" : "bg-success")} style={{ width: `${(spent / maxComparison) * 100}%` }} title="Actual + committed" />
                      </div>
                    </li>
                  );
                })}
                <li className="flex gap-4 text-caption text-ink-muted"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary/80" />Allocated</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-success" />Actual + committed</span></li>
              </ul>
            )}
          </div>
        </section>

        <aside className="space-y-4 xl:order-2 xl:grid xl:grid-cols-3 xl:gap-4 xl:space-y-0 2xl:order-none 2xl:block 2xl:space-y-4">
          <section className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1">
            <h2 className="flex items-center gap-2 text-heading font-bold text-headline"><BarChart3 className="h-6 w-6 text-section-icon" aria-hidden="true" />Budget details</h2>
            {chosen ? (
              <div className="mt-3 text-sm"><p className="font-bold text-ink-strong">{chosen.name}</p><p className="text-ink-muted">{chosen.department} · {chosen.code}</p>
                <dl className="mt-3 space-y-1">{([["Allocated", chosen.allocated], ["Actual", chosen.actual], ["Committed", chosen.committed], ["Remaining", chosen.remaining]] as const).map(([label, value]) => <div key={label} className="flex justify-between"><dt>{label}</dt><dd className="font-semibold tabular-nums">{formatAmount(value)}</dd></div>)}</dl>
                <Link href={`/accounting/budgets/${chosen.id}`} className="mt-3 inline-flex items-center gap-1 font-semibold text-primary-ink hover:underline">Open budget<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>
              </div>
            ) : <p className="mt-3 text-support text-ink-muted">Select a budget under Department budgets to view its details.</p>}
          </section>
          <section className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1">
            <h2 className="flex items-center gap-2 text-heading font-bold text-headline"><UserCheck className="h-6 w-6 text-section-icon" aria-hidden="true" />Approvals</h2>
            {data?.pending_approvals.length ? <ul className="mt-3 space-y-2 text-sm">{data.pending_approvals.map((item) => <li key={item.id}><Link href={`/accounting/budgets/${item.id}`} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 hover:bg-surface-hover"><span className="font-semibold">{item.name}</span><span className="text-caption text-ink-muted">{item.submitted_at ? formatDate(item.submitted_at) : EM_DASH}</span></Link></li>)}</ul> : <p className="mt-3 text-support text-ink-muted">There are no budgets pending approval for the selected filters.</p>}
          </section>
          <section className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1">
            <h2 className="flex items-center gap-2 text-heading font-bold text-headline"><Settings className="h-6 w-6 text-section-icon" aria-hidden="true" />Budget actions</h2>
            <div className="mt-3 space-y-2">
              {canManage ? <>
                <ButtonLink href="/accounting/budgets/new" block leadingIcon={<Plus className="h-4 w-4" />}>Create budget</ButtonLink>
                <ButtonLink href="/accounting/budgets/new" block variant="secondary" leadingIcon={<Upload className="h-4 w-4" />}>Import budget template</ButtonLink>
              </> : <div className="flex gap-2.5 rounded-xl bg-primary-soft/60 p-3 text-sm"><Lock className="mt-0.5 h-5 w-5 shrink-0 text-primary-ink" aria-hidden="true" /><div><p className="font-semibold text-headline">Restricted information</p><p className="text-ink">Budget editing is restricted to your role&apos;s permissions.</p></div></div>}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
