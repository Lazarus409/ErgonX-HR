"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, BarChart3, Building2, CalendarCheck, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Clock3, FileBarChart, FileClock, FilePen, FileText, Landmark, PieChart as PieChartIcon, Plus, Receipt, Scale, ShieldCheck, UsersRound } from "lucide-react";

import ChartCard from "@/components/charts/ChartCard";
import { BarsChart, DonutChart, TrendChart, donutLegend } from "@/components/charts/Charts";
import { useAuth } from "@/components/guards/AuthProvider";
import { ButtonLink } from "@/components/ui/Button";
import { Sparkline } from "@/components/charts/Visuals";
import { ActionCard, AttentionItem, Card, MetricCard, SummaryList } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import StatusBadge from "@/components/ui/StatusBadge";
import ErrorState from "@/components/ui/ErrorState";
import PageHeader from "@/components/ui/PageHeader";
import { dashboardsApi } from "@/lib/api";
import { EM_DASH, formatAmount, formatDate, formatNumber, humanizeEnum, formatCount } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { hasModule } from "@/types/institutions";
import { cx } from "@/lib/cx";

const journalStatusColors: Record<string, string> = {
  DRAFT: "var(--ink-subtle)",
  PENDING_APPROVAL: "var(--warning)",
  APPROVED: "var(--chart-5)",
  POSTED: "var(--success)",
  REVERSED: "var(--chart-3)",
  VOID: "var(--danger)",
};

export default function AccountingDashboard() {
  const { institution, user } = useAuth();
  const can = (permission: string) => hasModule(institution?.enabledModules, "ACCOUNTING") && (user?.permissions.includes("*") || user?.permissions.includes(permission));
  const [range, setRange] = useState<3 | 6 | 12>(12);
  const { data, loading, error, reload } = useApiResource(useCallback(() => dashboardsApi.getFinanceDashboard(range), [range]));
  const initial = loading && !data;
  const currency = data?.currency;
  const pnl = data?.profit_and_loss_trend ?? [];
  const cash = data?.cash_flow_range ?? data?.cash_flow_trend ?? [];
  const latestPnl = pnl.at(-1);
  const latestCash = cash.at(-1);
  const buckets = Array.from(new Set([...(data?.accounts_receivable_aging ?? []).map((item) => item.bucket), ...(data?.accounts_payable_aging ?? []).map((item) => item.bucket)]));
  const aging = buckets.map((bucket) => ({
    bucket,
    receivable: Number(data?.accounts_receivable_aging.find((item) => item.bucket === bucket)?.amount ?? 0),
    payable: Number(data?.accounts_payable_aging.find((item) => item.bucket === bucket)?.amount ?? 0),
  }));
  const journals = (data?.journals_by_status ?? []).map((item) => ({ label: humanizeEnum(item.status), value: item.count, color: journalStatusColors[item.status.toUpperCase()] }));
  const expenseCategories = (data?.expenses_by_account ?? []).map((item) => ({ label: item.label, value: Number(item.value) }));
  const unreconciled = data?.unreconciled_bank_lines ?? { count: 0, latest: [] };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounting"
        description="Financial integrity for a stronger tomorrow."
        actions={
          <>
            <label className="relative">
              <span className="sr-only">Date range</span>
              <CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-section-icon" aria-hidden="true" />
              <select data-ui="select" value={range} onChange={(event) => setRange(Number(event.target.value) as 3 | 6 | 12)} className="h-12 appearance-none rounded-lg border border-line-strong bg-surface pl-11 pr-10 text-sm font-medium text-ink-strong">
                {[3, 6, 12].map((months) => <option key={months} value={months}>Last {months} months</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            </label>
            {can("financial_report.view") && <ButtonLink href="/accounting/reports" size="lg" variant="secondary" leadingIcon={<FileBarChart className="h-5 w-5" />}>Financial reports</ButtonLink>}
            {can("journal.create") && <ButtonLink href="/accounting/journals/new" size="lg" leadingIcon={<Plus className="h-5 w-5" />}>Create journal</ButtonLink>}
          </>
        }
      />
      {error && <ErrorState variant="inline" title="Unable to load accounting dashboard" message={error} onRetry={reload} />}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Accounting indicators">
        <MetricCard label="Reconciliation exceptions" value={data?.reconciliation_exceptions === undefined ? EM_DASH : formatNumber(data.reconciliation_exceptions)} description={data?.reconciliation_exceptions ? "Statement lines not yet matched" : "No data available"} icon={AlertTriangle} accent="leave" loading={initial} href={can("bank_reconciliation.view") ? "/accounting/banking" : undefined} />
        <MetricCard label="Pending approvals" value={data?.pending_approvals === undefined ? EM_DASH : formatNumber(data.pending_approvals)} description={data?.pending_approvals ? `${data.pending_approvals_breakdown?.journals ?? 0} journals · ${data.pending_approvals_breakdown?.vendor_bills ?? 0} bills · ${data.pending_approvals_breakdown?.expenses ?? 0} expenses` : "No data available"} icon={FileClock} accent="reports" loading={initial} href={can("journal.view") ? "/accounting/journals?status=PENDING_APPROVAL" : undefined} />
        <MetricCard label="Unposted journals" value={data?.unposted_journals === undefined ? EM_DASH : formatNumber(data.unposted_journals)} description={data?.unposted_journals ? "Draft, pending or approved" : "No data available"} icon={FilePen} accent="payroll" loading={initial} href={can("journal.view") ? "/accounting/journals" : undefined} />
        <MetricCard label="Close status" value={data?.close_status?.current_status ? humanizeEnum(data.close_status.current_status) : EM_DASH} description={data?.close_status?.current_period ? `${data.close_status.current_period}${data.close_status.overdue_open_periods ? ` · ${data.close_status.overdue_open_periods} past period(s) open` : ""}` : "No data available"} icon={CalendarCheck} accent="settings" loading={initial} href={can("accounting_period.close") ? "/accounting/periods" : undefined} />
      </section>

      <div className="grid gap-5 2xl:grid-cols-2">
        <ChartCard
          title="Cash flow overview"
          description="Inflows and outflows over time."
          accent="accounting"
          icon={BarChart3}
          loading={initial}
          error={!data && error ? "This data is unavailable right now." : null}
          empty={!cash.length}
          emptyDescription="Cash flow information will be displayed here when general ledger transactions on registered bank accounts are available."
          legend={[{ label: "Inflow", color: "var(--success)", shape: "square" }, { label: "Outflow", color: "var(--warning)", shape: "square" }]}
          footer={latestCash ? <span>Latest net movement: <strong className={Number(latestCash.net_movement) >= 0 ? "text-success-ink" : "text-danger-ink"}>{formatAmount(latestCash.net_movement, currency)}</strong></span> : undefined}
          data={{ columns: ["Month", "Inflow", "Outflow", "Net"], rows: cash.map((point) => [point.month, formatAmount(point.inflow, currency), formatAmount(point.outflow, currency), formatAmount(point.net_movement, currency)]) }}
        >
          <BarsChart data={cash} xKey="month" xFormat="month" format="currency" currency={currency} height={240} series={[{ key: "inflow", label: "Inflow", color: "var(--success)" }, { key: "outflow", label: "Outflow", color: "var(--warning)" }]} />
        </ChartCard>
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3"><FileText className="mt-0.5 h-7 w-7 text-section-icon" aria-hidden="true" /><div><h2 className="text-heading font-bold text-headline">Needs attention</h2><p className="text-support text-heading-support">Accounting items that require your review or action.</p></div></div>
            {(data?.needs_attention_total ?? 0) > (data?.needs_attention?.length ?? 0) && <span className="text-sm text-ink-muted">{data?.needs_attention?.length} of {data?.needs_attention_total}</span>}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="bg-surface-muted text-left text-caption font-semibold text-ink-strong"><tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Entity</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Status</th></tr></thead>
              <tbody className="divide-y divide-line-soft">
                {(data?.needs_attention ?? []).map((item, index) => (
                  <tr key={`${item.type}-${item.entity}-${index}`} className="hover:bg-surface-hover">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-ink-strong">{item.type}</td>
                    <td className="max-w-56 truncate px-3 py-2"><Link href={item.href} className="text-primary-ink hover:underline">{item.description}</Link></td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{item.entity}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{formatDate(item.date)}</td>
                    <td className="px-3 py-2"><StatusBadge status={item.status} size="sm" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!initial && !(data?.needs_attention ?? []).length && <div className="flex flex-col items-center py-8 text-center"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-muted text-ink-muted"><CheckCircle2 className="h-7 w-7" aria-hidden="true" /></span><p className="mt-3 font-bold text-headline">No items to review</p><p className="text-support text-ink-muted">There are no accounting items requiring attention at this time.</p></div>}
          </div>
        </section>
      </div>

      <div className="grid gap-5 2xl:grid-cols-2">
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3"><Clock3 className="mt-0.5 h-7 w-7 text-section-icon" aria-hidden="true" /><div><h2 className="text-heading font-bold text-headline">Recent journal activity</h2><p className="text-support text-heading-support">Latest journal entries posted or created.</p></div></div>
            {can("journal.view") && <Link href="/accounting/journals" className="inline-flex items-center gap-1 text-sm font-semibold text-primary-ink hover:underline">View all<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="bg-surface-muted text-left text-caption font-semibold text-ink-strong"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Journal #</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Status</th></tr></thead>
              <tbody className="divide-y divide-line-soft">
                {(data?.recent_journals ?? []).map((row) => (
                  <tr key={row.id} className="hover:bg-surface-hover">
                    <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{formatDate(row.entry_date)}</td>
                    <td className="whitespace-nowrap px-3 py-2"><Link href={`/accounting/journals/${row.id}`} className="font-semibold text-primary-ink hover:underline">{row.journal_number}</Link></td>
                    <td className="max-w-56 truncate px-3 py-2">{row.description}</td>
                    <td className="px-3 py-2 text-ink-muted">{humanizeEnum(row.source)}</td>
                    <td className="px-3 py-2"><StatusBadge status={row.status} size="sm" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!initial && !(data?.recent_journals ?? []).length && <div className="flex flex-col items-center py-8 text-center"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-muted text-ink-muted"><FileText className="h-7 w-7" aria-hidden="true" /></span><p className="mt-3 font-bold text-headline">No recent activity</p><p className="text-support text-ink-muted">Journal entries will appear here when data is available.</p></div>}
          </div>
        </section>
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
          <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-7 w-7 text-section-icon" aria-hidden="true" /><div><h2 className="text-heading font-bold text-headline">Accounting controls</h2><p className="text-support text-heading-support">Key controls to help maintain financial integrity.</p></div></div>
          <ul className="mt-4 space-y-3">
            {([
              ["period_close", "Period close checklist", CheckCircle2, "bg-success-soft text-success-ink", "/accounting/periods"],
              ["segregation_of_duties", "Segregation of duties", UsersRound, "bg-mod-recruitment-soft text-mod-recruitment", "/settings/roles"],
              ["audit_trail", "Audit trail access", FileText, "bg-mod-payroll-soft text-mod-payroll", "/audit"],
            ] as const).map(([key, title, Icon, tone, href]) => {
              const control = data?.controls?.[key];
              return (
                <li key={key}>
                  <Link href={href} className="flex items-center gap-4 rounded-xl border border-line p-3 hover:border-primary/40 hover:bg-surface-hover">
                    <span className={cx("flex h-12 w-12 shrink-0 items-center justify-center rounded-full", control && !control.ok ? "bg-warning-soft text-warning-ink" : tone)}>{control && !control.ok ? <AlertTriangle className="h-6 w-6" aria-hidden="true" /> : <Icon className="h-6 w-6" aria-hidden="true" />}</span>
                    <span className="min-w-0 flex-1"><span className="block font-semibold text-ink-strong">{title}</span><span className="text-support text-ink-muted">{control?.detail ?? (initial ? "Checking…" : "No data available")}</span></span>
                    <ChevronRight className="h-5 w-5 text-primary-ink" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <h2 className="pt-2 text-heading font-bold text-headline">Financial position</h2>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Financial position">
        <MetricCard size="sm" label="Bank balance" value={data ? formatAmount(data.bank_balance, currency) : EM_DASH} description={data ? formatCount(data.registered_bank_accounts, "registered account") : undefined} icon={Landmark} accent="accounting" loading={initial} />
        <MetricCard size="sm" label="Accounts receivable" value={data ? formatAmount(data.accounts_receivable, currency) : EM_DASH} description="Outstanding from customers" icon={ArrowDownLeft} accent="attendance" loading={initial} href={can("invoice.view") ? "/accounting/receivables" : undefined} />
        <MetricCard size="sm" label="Accounts payable" value={data ? formatAmount(data.accounts_payable, currency) : EM_DASH} description="Owed to vendors" icon={ArrowUpRight} accent="payroll" loading={initial} href={can("vendor_bill.view") ? "/accounting/payables" : undefined} />
        <MetricCard size="sm" label="Posted expenses" value={data ? formatAmount(data.expenses, currency) : EM_DASH} description="Posted to the ledger" icon={Receipt} accent="audit" loading={initial} href={can("expense.view") ? "/accounting/expenses" : undefined} chart={<Sparkline values={pnl.map((point) => point.expenses)} color="var(--mod-audit)" height={32} label="Expenses by month" />} />
      </section>

      <ChartCard
        title="Profit and loss"
        description="Monthly income and expenses from posted journals, with the net result."
        accent="accounting"
        loading={initial}
        error={!data && error ? "This data is unavailable right now." : null}
        empty={!pnl.length}
        emptyDescription="Posted income or expense journals will appear here when available."
        legend={[{ label: "Income", color: "var(--chart-2)", shape: "line", value: latestPnl ? formatAmount(latestPnl.income, currency) : undefined }, { label: "Expenses", color: "var(--chart-6)", shape: "line", value: latestPnl ? formatAmount(latestPnl.expenses, currency) : undefined }, { label: "Net result", color: "var(--chart-1)", shape: "line", value: latestPnl ? formatAmount(latestPnl.net_income, currency) : undefined }]}
        summary={latestPnl ? `Latest posted month: income ${formatAmount(latestPnl.income, currency)}, expenses ${formatAmount(latestPnl.expenses, currency)}, net result ${formatAmount(latestPnl.net_income, currency)}.` : undefined}
        data={{ columns: ["Month", "Income", "Expenses", "Net result"], rows: pnl.map((point) => [point.month, formatAmount(point.income, currency), formatAmount(point.expenses, currency), formatAmount(point.net_income, currency)]) }}
        footer="Posted journals only. Legend values show the latest posted month."
      >
        <TrendChart data={pnl} xKey="month" format="currency" currency={currency} height={280} zeroLine series={[{ key: "income", label: "Income", color: "var(--chart-2)" }, { key: "expenses", label: "Expenses", color: "var(--chart-6)" }, { key: "net_income", label: "Net result", color: "var(--chart-1)" }]} />
      </ChartCard>

      <div className="grid gap-5">
        <ChartCard
          title="Receivable and payable aging"
          description="Outstanding balances by age bucket."
          accent="accounting"
          loading={initial}
          error={!data && error ? "This data is unavailable right now." : null}
          empty={!aging.length}
          emptyDescription="Aging appears once invoices or bills are outstanding."
          legend={[{ label: "Receivable", color: "var(--chart-5)", shape: "square" }, { label: "Payable", color: "var(--mod-payroll)", shape: "square" }]}
          data={{ columns: ["Bucket", "Receivable", "Payable"], rows: aging.map((row) => [row.bucket, formatAmount(row.receivable, currency), formatAmount(row.payable, currency)]) }}
        >
          <BarsChart data={aging} xKey="bucket" layout="horizontal" format="currency" currency={currency} height={240} series={[{ key: "receivable", label: "Receivable", color: "var(--chart-5)" }, { key: "payable", label: "Payable", color: "var(--mod-payroll)" }]} />
        </ChartCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <ChartCard
          className="xl:col-span-2"
          title="Expenses by category"
          description="Posted expenses by expense account."
          accent="accounting"
          icon={PieChartIcon}
          loading={initial}
          error={!data && error ? "This data is unavailable right now." : null}
          empty={!expenseCategories.length}
          emptyDescription="Posted expenses will appear here."
          data={{ columns: ["Expense account", "Posted"], rows: expenseCategories.map((item) => [item.label, formatAmount(item.value, currency)]) }}
        >
          <div className="grid items-center gap-5 sm:grid-cols-[160px_1fr] xl:grid-cols-1 2xl:grid-cols-[160px_1fr]">
            <DonutChart data={expenseCategories} height={160} format="currency" currency={currency} centerValue={formatAmount(data?.expenses ?? 0, currency)} centerLabel="posted" />
            <SummaryList items={donutLegend(expenseCategories, "currency", currency).map((item) => ({ label: <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: item.color }} />{item.label}</span>, value: item.value }))} />
          </div>
        </ChartCard>
        <Card className="xl:col-span-3" title="Controls and exceptions" description="Items that need review before the period can close cleanly." icon={Scale} accent="accounting">
          <div className="-mx-3 -mb-2 space-y-1">
            <AttentionItem title="Journals pending approval" description={`${formatCount(data?.pending_journals, "journal")} in the approval workflow.`} severity={data?.pending_journals ? "warning" : "info"} href={can("journal.view") ? "/accounting/journals?status=PENDING_APPROVAL" : undefined} />
            {data && Number(data.accounts_payable) > 0 && Number(data.accounts_payable) > Number(data.bank_balance) && <AttentionItem title="Payables exceed bank balance" description={`Outstanding payables of ${formatAmount(data.accounts_payable, currency)} exceed the registered bank balance.`} severity="high" href={can("vendor_bill.view") ? "/accounting/payables" : undefined} />}
            {data && !(Number(data.accounts_payable) > 0) && Number(data.bank_balance) < 0 && <AttentionItem title="Bank balance is negative" description={`The registered bank ledger balance is ${formatAmount(data.bank_balance, currency)}.`} severity="high" href={can("bank_account.view") ? "/accounting/banking" : undefined} />}
            {latestPnl && Number(latestPnl.net_income) < 0 && <AttentionItem title="Net loss in the latest posted month" description={`Net result of ${formatAmount(latestPnl.net_income, currency)}.`} severity="high" href={can("financial_report.view") ? "/accounting/reports" : undefined} />}
            {can("bank_reconciliation.view") && <AttentionItem title="Bank reconciliation" description={unreconciled.count ? `${formatCount(unreconciled.count, "statement line")} not yet matched to a posted cash journal.` : "Every imported statement line is matched."} severity={unreconciled.count ? "warning" : "info"} href="/accounting/banking" />}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <DataTable<(typeof unreconciled.latest)[number]>
          className="xl:col-span-3"
          caption="Unreconciled bank statement lines"
          density="compact"
          minWidth={560}
          rows={unreconciled.latest}
          rowKey={(line) => line.id}
          loading={initial}
          toolbar={<div className="flex items-center justify-between gap-3"><div><h2 className="text-card-title font-bold text-headline">Unreconciled bank lines</h2><p className="text-support text-ink-muted">{unreconciled.count > unreconciled.latest.length ? `Latest ${unreconciled.latest.length} of ${formatNumber(unreconciled.count)}.` : "Imported statement lines awaiting a match."}</p></div>{can("bank_reconciliation.view") && <ButtonLink href="/accounting/banking" size="sm" variant="secondary">Reconcile</ButtonLink>}</div>}
          empty={{ title: "Nothing to reconcile", description: "Every imported statement line is matched to a posted cash journal.", icon: Landmark }}
          columns={[
            { key: "date", header: "Date", cell: (line) => formatDate(line.statement_date) },
            { key: "account", header: "Bank account", cell: (line) => line.bank_account, hideBelow: "sm" },
            { key: "reference", header: "Reference", cell: (line) => line.reference || line.description || EM_DASH, className: "max-w-48 truncate" },
            { key: "amount", header: "Amount", numeric: true, cell: (line) => formatAmount(line.amount, line.currency) },
            { key: "status", header: "Status", cell: (line) => <StatusBadge status={line.status} size="sm" /> },
          ]}
        />
        <Card className="xl:col-span-2" title="Journal status" description="Where journals sit in the approval workflow." icon={FileText} accent="accounting">
          {journals.length ? (
            <SummaryList items={(data?.journals_by_status ?? []).map((item) => ({ label: <StatusBadge status={item.status} size="sm" />, value: formatNumber(item.count) }))} />
          ) : <p className="text-support text-ink-muted">{initial ? "Loading…" : "Journals will appear here once created."}</p>}
        </Card>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Accounting areas">
        {can("journal.view") && <ActionCard href="/accounting/journals" title="Journals" description="Create, approve, post and reverse" icon={FileText} accent="accounting" />}
        {can("invoice.view") && <ActionCard href="/accounting/receivables" title="Receivables" description="Customers, invoices and receipts" icon={ArrowDownLeft} accent="accounting" />}
        {can("vendor_bill.view") && <ActionCard href="/accounting/payables" title="Payables" description="Vendors, bills and payments" icon={Building2} accent="accounting" />}
        {can("bank_account.view") && <ActionCard href="/accounting/banking" title="Banking" description="Accounts and reconciliation" icon={Landmark} accent="accounting" />}
      </section>
    </div>
  );
}
