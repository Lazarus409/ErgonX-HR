"use client";

import Link from "next/link";
import { ArrowRight, CircleDollarSign, FileText, Search, ShieldCheck } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import PageHeader from "@/components/ui/PageHeader";
import { employeesApi, payrollApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { formatAmount, formatDate } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { Payslip } from "@/types/payroll";

const deductionLike = (source: string) => /DEDUCTION|TAX|PENSION|CONTRIBUTION/i.test(source);

/** My payslips (Stitch S036): year filter, payment records, and a breakdown preview of the selected payslip. */
export default function MyPayslipsPage() {
  // Always filter to the member's own employee record: finance and HR roles can list everyone's payslips.
  const load = useCallback(async () => {
    const employee = await employeesApi.getCurrentEmployee();
    if (!employee) return { count: 0, next: null, previous: null, results: [] as Payslip[] };
    return payrollApi.listPayslips({ payroll_record__employee: employee.id, page_size: MAX_PAGE_SIZE, ordering: "-generated_at" });
  }, []);
  const { data, loading, error, reload } = useApiResource(load);
  const payslips = useMemo(() => data?.results ?? [], [data]);
  const years = useMemo(() => [...new Set(payslips.map((slip) => slip.payroll_period.pay_date.slice(0, 4)))].sort().reverse(), [payslips]);
  const [year, setYear] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeYear = year || years[0] || "";
  const shown = payslips.filter((slip) => (!activeYear || slip.payroll_period.pay_date.startsWith(activeYear)) && (!search.trim() || slip.payroll_period.name.toLowerCase().includes(search.trim().toLowerCase())));
  const selected = shown.find((slip) => slip.id === selectedId) ?? shown[0] ?? null;
  const currency = payslips[0]?.payload.currency;
  const ytdGross = shown.reduce((sum, slip) => sum + Number(slip.payload.gross_pay), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="My payslips" description="View your payslips and what makes up your pay." icon={CircleDollarSign} accent="payroll"
        meta={currency ? <Badge tone="neutral" dot>{currency} · {activeYear ? `${activeYear} gross ${formatAmount(ytdGross.toFixed(2), currency)}` : "No payslips yet"}</Badge> : undefined} />

      <section className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4 shadow-elevation-1" aria-label="Filters">
        <label className="text-caption font-semibold uppercase tracking-[0.08em] text-ink-muted">Year
          <select value={activeYear} onChange={(event) => { setYear(event.target.value); setSelectedId(null); }} className="mt-1 block h-9 w-32 rounded-lg border border-line-strong bg-surface px-2 text-sm normal-case tracking-normal text-ink-strong">
            {years.length === 0 && <option value="">—</option>}
            {years.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="min-w-48 flex-1 text-caption font-semibold uppercase tracking-[0.08em] text-ink-muted">Search
          <span className="relative mt-1 block"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-muted" aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by pay period…" className="h-9 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm normal-case tracking-normal text-ink-strong" /></span>
        </label>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <DataTable
          caption="Payment records"
          rows={shown}
          rowKey={(item) => item.id}
          loading={loading && !data}
          error={error}
          onRetry={reload}
          minWidth={620}
          onRowClick={(item) => setSelectedId(item.id)}
          isRowSelected={(item) => item.id === selected?.id}
          toolbar={<div className="flex items-center gap-2"><FileText className="h-5 w-5 text-mod-payroll" aria-hidden="true" /><h2 className="text-card-title font-semibold text-ink-strong">Payment records</h2><Badge size="sm" tone="neutral">{shown.length} records</Badge></div>}
          empty={{ title: "No payslips yet", description: "Your payslips appear here after your first finalized payroll.", icon: FileText }}
          columns={[
            { key: "period", header: "Pay period", sortValue: (item) => item.payroll_period.pay_date, cell: (item) => <span className="font-semibold text-ink-strong">{item.payroll_period.name}</span> },
            { key: "paydate", header: "Pay date", sortValue: (item) => item.payroll_period.pay_date, cell: (item) => formatDate(item.payroll_period.pay_date) },
            { key: "gross", header: "Gross", numeric: true, hideBelow: "md", cell: (item) => formatAmount(item.payload.gross_pay, item.payload.currency) },
            { key: "deductions", header: "Deductions", numeric: true, hideBelow: "lg", cell: (item) => formatAmount(item.payload.total_deductions, item.payload.currency) },
            { key: "net", header: "Net pay", numeric: true, sortValue: (item) => Number(item.payload.net_pay), cell: (item) => <span className="font-semibold text-ink-strong">{formatAmount(item.payload.net_pay, item.payload.currency)}</span> },
            { key: "view", header: <span className="sr-only">Open</span>, cell: (item) => <div className="flex justify-end"><Link href={`/payroll/payslips/${item.id}`} onClick={(event) => event.stopPropagation()} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-support font-semibold text-primary-ink hover:bg-primary-soft">Open<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link></div> },
          ]}
        />

        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <section className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1" aria-labelledby="payslip-preview">
            <h2 id="payslip-preview" className="text-card-title font-semibold text-ink-strong">Payslip preview</h2>
            {selected ? (
              <>
                <p className="mt-1 text-support text-ink-muted">{selected.payroll_period.name} · paid {formatDate(selected.payroll_period.pay_date)}</p>
                <dl className="mt-4 space-y-2 text-support">
                  {selected.payload.items.map((item) => (
                    <div key={`${item.code}-${item.name}`} className="flex justify-between gap-3">
                      <dt className="text-ink-muted">{item.name}</dt>
                      <dd className={cx("tabular-nums", deductionLike(item.source) ? "text-danger-ink" : "text-ink-strong")}>{deductionLike(item.source) ? "− " : ""}{formatAmount(item.amount, selected.payload.currency)}</dd>
                    </div>
                  ))}
                </dl>
                <dl className="mt-4 space-y-1.5 border-t border-line-soft pt-3 text-support">
                  <div className="flex justify-between"><dt className="text-ink-muted">Gross pay</dt><dd className="tabular-nums text-ink-strong">{formatAmount(selected.payload.gross_pay, selected.payload.currency)}</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-muted">Total deductions</dt><dd className="tabular-nums text-danger-ink">− {formatAmount(selected.payload.total_deductions, selected.payload.currency)}</dd></div>
                  <div className="flex justify-between pt-1 text-base font-bold"><dt className="text-ink-strong">Net pay</dt><dd className="tabular-nums text-primary-ink">{formatAmount(selected.payload.net_pay, selected.payload.currency)}</dd></div>
                </dl>
                <Link href={`/payroll/payslips/${selected.id}`} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90">Open payslip<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              </>
            ) : <p className="mt-2 text-support text-ink-muted">Select a payslip to see its breakdown.</p>}
          </section>
          <section className="flex gap-3 rounded-xl border border-line bg-surface p-5 shadow-elevation-1">
            <ShieldCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div><h2 className="text-sm font-semibold text-ink-strong">Your information is private</h2><p className="mt-1 text-caption text-ink-muted">Only you, and payroll staff with access to your record, can see your payslips.</p></div>
          </section>
        </aside>
      </div>
    </div>
  );
}
