"use client";

import { useCallback } from "react";
import { Building2, HandCoins, MinusCircle, WalletCards } from "lucide-react";

import ChartCard from "@/components/charts/ChartCard";
import { BarsChart, TrendChart } from "@/components/charts/Charts";
import PayrollWorkspace from "@/components/payroll/PayrollWorkspace";
import { RankingBars, Sparkline } from "@/components/charts/Visuals";
import { Card, InsightCard, MetricCard } from "@/components/ui/Card";
import StatusBadge from "@/components/ui/StatusBadge";
import { dashboardsApi } from "@/lib/api";
import { EM_DASH, formatAmount, formatNumber } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";

export default function PayrollDashboardPage() {
  const load = useCallback(() => dashboardsApi.getPayrollDashboard(), []);
  const { data, loading, error } = useApiResource(load);
  const initial = loading && !data;
  const periods = data?.payroll_by_period ?? [];
  const costByDepartment = data?.cost_by_department ?? { period: null, departments: [] };
  const latest = periods.at(-1);
  const previous = periods.at(-2);
  const grossDelta = latest && previous ? Number(latest.gross_pay) - Number(previous.gross_pay) : null;
  const grossDeltaPct = grossDelta !== null && previous && Number(previous.gross_pay) ? (grossDelta / Number(previous.gross_pay)) * 100 : null;

  return (
    <div className="space-y-6">
      <PayrollWorkspace />

      {/* Analytics need the payroll dashboard permission; roles without it just see the workspace. */}
      {!(error && !data) && <>
      <h2 className="pt-4 text-heading font-bold text-headline">Payroll analytics</h2>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Finalized payroll totals">
        <MetricCard size="sm" label="Finalized gross pay" value={data ? formatAmount(data.finalized_gross_pay) : EM_DASH} description="Across finalized runs" icon={WalletCards} accent="payroll" loading={initial} chart={<Sparkline values={periods.map((point) => point.gross_pay)} color="var(--mod-payroll)" height={32} label="Gross pay by period" />} />
        <MetricCard size="sm" label="Finalized net pay" value={data ? formatAmount(data.finalized_net_pay) : EM_DASH} description="Paid to employees" icon={HandCoins} accent="accounting" loading={initial} chart={<Sparkline values={periods.map((point) => point.net_pay)} color="var(--mod-accounting)" height={32} label="Net pay by period" />} />
        <MetricCard size="sm" label="Deductions" value={data ? formatAmount(data.finalized_deductions) : EM_DASH} description="Statutory and voluntary" icon={MinusCircle} accent="audit" loading={initial} />
        <MetricCard size="sm" label="Employer contributions" value={data ? formatAmount(data.employer_contributions) : EM_DASH} description="Employer-side cost" icon={Building2} accent="hr" loading={initial} />
      </section>

      <div className="grid gap-5 xl:grid-cols-5">
        <ChartCard
          className="xl:col-span-3"
          title="Payroll cost trend"
          description="Gross payroll by finalized pay period."
          accent="payroll"
          loading={initial}
          error={!data && error ? "This data is unavailable right now." : null}
          empty={!periods.length}
          emptyDescription="Gross, net and deductions will appear after a payroll run is finalized."
          data={{ columns: ["Period", "Gross", "Net", "Deductions"], rows: periods.map((point) => [point.label, formatAmount(point.gross_pay), formatAmount(point.net_pay), formatAmount(point.total_deductions)]) }}
        >
          <TrendChart variant="area" data={periods} xKey="label" xFormat="label" format="currency" height={250} series={[{ key: "gross_pay", label: "Gross pay", color: "var(--mod-payroll)" }]} />
        </ChartCard>
        <div className="grid content-start gap-4 xl:col-span-2">
          <InsightCard title="Period-over-period change" icon={WalletCards} accent="payroll">
            {grossDelta !== null ? (
              <p>
                Gross pay {grossDelta >= 0 ? "increased" : "decreased"} by <strong className="text-ink-strong tabular-nums">{formatAmount(Math.abs(grossDelta))}</strong>
                {grossDeltaPct !== null && <> ({grossDelta >= 0 ? "+" : "-"}{Math.abs(grossDeltaPct).toFixed(1)}%)</>} from {previous?.label} to {latest?.label}.
              </p>
            ) : <p>At least two finalized periods are needed to compare payroll cost.</p>}
          </InsightCard>
          <Card title="Runs by status" description="Payroll runs grouped by current workflow status." padding="md">
            {initial ? <div className="skeleton h-24 rounded-xl" /> : data?.runs_by_status.length ? (
              <ul className="divide-y divide-line-soft">
                {data.runs_by_status.map((item) => (
                  <li key={item.status} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <StatusBadge status={item.status} size="sm" />
                    <span className="text-sm font-semibold text-ink-strong tabular-nums">{formatNumber(item.count)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-support text-ink-muted">No payroll runs are available yet.</p>}
          </Card>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <ChartCard
          className="xl:col-span-3"
          title="Earnings and deductions"
          description="Net pay and deductions that make up gross pay for each finalized period."
          accent="payroll"
          loading={initial}
          error={!data && error ? "This data is unavailable right now." : null}
          empty={!periods.length}
          emptyDescription="Finalized payroll periods will appear here."
          legend={[{ label: "Net pay", color: "var(--chart-2)", shape: "square" }, { label: "Deductions", color: "var(--chart-6)", shape: "square" }]}
          data={{ columns: ["Period", "Net pay", "Deductions"], rows: periods.map((point) => [point.label, formatAmount(point.net_pay), formatAmount(point.total_deductions)]) }}
        >
          <BarsChart data={periods} xKey="label" mode="stacked" format="currency" height={250} series={[{ key: "net_pay", label: "Net pay", color: "var(--chart-2)" }, { key: "total_deductions", label: "Deductions", color: "var(--chart-6)" }]} />
        </ChartCard>
        <ChartCard
          className="xl:col-span-2"
          title="Cost by department / functional area"
          description={costByDepartment.period ? `Gross pay by current department / functional area, ${costByDepartment.period}.` : "Gross pay by current department / functional area for the latest finalized run."}
          accent="payroll"
          icon={Building2}
          loading={initial}
          error={!data && error ? "This data is unavailable right now." : null}
          empty={!costByDepartment.departments.length}
          emptyDescription="Department / Functional Area costs appear after a payroll run is finalized."
          data={{ columns: ["Department / Functional Area", "Gross pay"], rows: costByDepartment.departments.map((item) => [item.department, formatAmount(item.gross_pay)]) }}
        >
          <RankingBars items={costByDepartment.departments.map((item) => ({ label: item.department, value: item.gross_pay }))} format="currency" color="var(--mod-payroll)" limit={8} />
        </ChartCard>
      </div>
      </>}
    </div>
  );
}
