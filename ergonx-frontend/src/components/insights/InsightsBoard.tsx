"use client";

import { useCallback, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Coins,
  Info,
  Landmark,
  LineChart as LineChartIcon,
  MapPin,
  PieChart as PieChartIcon,
  ShieldCheck,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import ChartCard from "@/components/charts/ChartCard";
import { BarsChart, DonutChart, TrendChart } from "@/components/charts/Charts";
import { seriesColors, toNumber } from "@/components/charts/format";
import ErrorState from "@/components/ui/ErrorState";
import { useAuth } from "@/components/guards/AuthProvider";
import { Tooltip } from "@/components/ui/Overlay";
import ScopeNote from "@/components/ui/ScopeNote";
import Tabs from "@/components/ui/Tabs";
import { homeApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { EM_DASH, formatAmount, formatDate, formatNumber } from "@/lib/format";
import { moduleAccents, type ModuleAccent } from "@/lib/moduleTheme";
import { useApiResource } from "@/lib/useApiResource";
import type { InsightKpi, InsightShare } from "@/types/dashboards";

const RANGES = [3, 6, 12, 24] as const;
type Range = (typeof RANGES)[number];
type DemographicTab = "gender" | "age_range" | "employment_status";

const moduleColors: Record<string, string> = { HR: "var(--chart-1)", PAYROLL: "var(--chart-2)", RECRUITMENT: "var(--chart-4)" };

function percent(value: string | number | null | undefined, digits = 1) {
  return value === null || value === undefined ? EM_DASH : `${toNumber(value).toFixed(digits)}%`;
}

function averageRate(rows: Array<{ attendance_rate: string | number | null }>) {
  const rated = rows.filter((row) => row.attendance_rate !== null);
  return rated.length ? percent(rated.reduce((sum, row) => sum + toNumber(row.attendance_rate), 0) / rated.length) : "no attendance recorded";
}

function RangeSelect({ value, onChange, compact = false }: { value: Range; onChange: (value: Range) => void; compact?: boolean }) {
  return (
    <label className="relative inline-flex">
      <span className="sr-only">Date range</span>
      {!compact && <CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-section-icon" aria-hidden="true" />}
      <select data-ui="select" value={value} onChange={(event) => onChange(Number(event.target.value) as Range)} className={cx("appearance-none rounded-lg border border-line-strong bg-surface pr-10 font-medium text-ink-strong", compact ? "h-9 pl-3 text-caption" : "h-12 pl-11 text-sm")}>
        {RANGES.map((months) => <option key={months} value={months}>Last {months} months</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
    </label>
  );
}

/** Concept KPI tile with the "No data available" variant for areas outside the caller's access. */
function InsightKpiCard({ label, icon: Icon, accent, value, change, changeUnit = "%", loading, denied, detail, info }: { label: string; icon: LucideIcon; accent: ModuleAccent; value?: ReactNode; change?: InsightKpi["change_percent"]; /** "%" for relative change, "pts" for a change in percentage points. */ changeUnit?: "%" | "pts"; loading: boolean; denied: string | null; detail?: ReactNode; info?: string }) {
  const delta = change === null || change === undefined ? null : toNumber(change);
  return (
    <article className="flex gap-4 rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
      <span className={cx("inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full", denied ? "bg-surface-muted text-ink-subtle" : moduleAccents[accent].tile)} aria-hidden="true"><Icon className="h-6 w-6" /></span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[0.9375rem] font-bold leading-5 text-headline">{label}{info && <Tooltip content={info}><Info className="h-4 w-4 text-primary" aria-label={info} /></Tooltip>}</p>
        {loading ? <span className="skeleton mt-2 block h-8 w-28 rounded-lg" aria-label="Loading" /> : denied ? (
          <>
            <p className="mt-1 text-kpi-sm font-bold text-ink-subtle" aria-hidden="true">{EM_DASH}</p>
            <span className="mt-1 inline-block rounded-md bg-surface-muted px-2 py-0.5 text-caption font-semibold text-ink-muted">No data available</span>
            <p className="mt-1.5 text-caption text-ink-muted">{denied}</p>
          </>
        ) : (
          <>
            <p className={cx("mt-2 font-bold leading-tight tracking-tight text-ink-strong tabular-nums", String(value).length > 11 ? "whitespace-nowrap text-[1.1875rem] 2xl:text-[1.5rem]" : "text-[1.75rem] 2xl:text-kpi")}>{value}</p>
            {delta !== null ? (
              <p className="mt-1.5 text-support"><span className={cx("font-semibold", delta >= 0 ? "text-success-ink" : "text-danger-ink")}>{delta >= 0 ? "+" : ""}{delta.toFixed(1)}{changeUnit === "pts" ? " pts" : "%"} {delta >= 0 ? "▲" : "▼"}</span> <span className="text-ink-muted">vs. previous period</span></p>
            ) : detail ? <p className="mt-1.5 text-support text-ink-muted">{detail}</p> : <p className="mt-1.5 text-support text-ink-muted">No previous period to compare</p>}
          </>
        )}
      </div>
    </article>
  );
}

/** Horizontal share bars with a percentage label (concept "Employees by department"). */
function ShareBars({ rows, limit = 8 }: { rows: InsightShare[]; limit?: number }) {
  const shown = rows.length > limit ? [...rows.slice(0, limit - 1), { label: "Other", count: rows.slice(limit - 1).reduce((sum, row) => sum + row.count, 0), percent: rows.slice(limit - 1).reduce((sum, row) => sum + toNumber(row.percent), 0) }] : rows;
  const max = Math.max(...shown.map((row) => toNumber(row.percent)), 1);
  return (
    <ul className="space-y-2">
      {shown.map((row, index) => (
        <li key={row.label} className="grid grid-cols-[minmax(0,8.5rem)_1fr] items-center gap-3 text-caption">
          <span className="truncate text-right text-ink" title={row.label}>{row.label}</span>
          <span className="flex items-center gap-2">
            <span className="h-3.5 rounded-sm" style={{ width: `${(toNumber(row.percent) / max) * 80}%`, minWidth: 4, background: seriesColors[index % seriesColors.length] }} />
            <span className="font-semibold text-ink-strong tabular-nums">{percent(row.percent)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function NoAccessPanel({ icon: Icon = BarChart3, title, description }: { icon?: LucideIcon; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-4 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-ink-subtle" aria-hidden="true"><Icon className="h-5 w-5" /></span>
      <p className="mt-2 font-semibold text-ink-strong">{title}</p>
      <p className="text-caption text-ink-muted">{description}</p>
    </div>
  );
}

/**
 * Concepts "Insights" and "Executive dashboard": trusted cross-module figures,
 * limited to the modules and records the caller's role may see. Every section
 * comes from `GET /home/insights/`; a section the caller cannot see arrives as
 * null and renders as "No data available". The executive variant swaps in
 * year-to-date revenue, the compliance rate and revenue by source.
 */
export default function InsightsBoard({ variant = "insights" }: { variant?: "insights" | "executive" }) {
  const executive = variant === "executive";
  const { institution } = useAuth();
  const [range, setRange] = useState<Range>(12);
  const [demographic, setDemographic] = useState<DemographicTab>("gender");
  const load = useCallback(() => homeApi.getInsights(range), [range]);
  const { data, loading, error, reload } = useApiResource(load);
  const initial = loading && !data;
  const workforce = data?.workforce ?? null;
  const currency = data?.currency;
  const asOf = workforce ? `As of ${formatDate(workforce.as_of)}` : undefined;
  const trendRows = data?.module_trend ? data.module_trend.months.map((month, index) => Object.fromEntries([["month", month], ...data.module_trend!.series.map((series) => [series.code, series.values[index]])])) : [];
  const demographicRows = workforce?.demographics[demographic] ?? [];
  const leaveRows = data?.leave_attendance ?? [];

  return (
    <div className="space-y-5">
      <header className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)_auto] lg:items-start">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">{executive ? `${data?.executive_title ?? "Executive"} Dashboard` : "Insights"}</h1>
          <p className="mt-1 text-[1.0625rem] leading-7 text-heading-support">{executive ? "A unified view of your institution's performance." : "Trusted data. Meaningful insights."}</p>
          <p className="text-support text-ink-muted">{executive ? "Organization-wide analytics across all modules, departments and campuses." : "Based on your access. Showing data from modules you can view."}</p>
        </div>
        {executive ? (
          <ScopeNote title="Organization-wide view" icon={Landmark} solidIcon>Showing data for all modules, departments and locations{institution?.name ? <> at {institution.name.replace(/\.$/, "")}</> : null}.</ScopeNote>
        ) : (
          <ScopeNote title="Based on your access">Showing data for modules and records available to your role and permissions.</ScopeNote>
        )}
        <div className="flex flex-col gap-1.5 sm:items-end">
          <RangeSelect value={range} onChange={setRange} />
          {data && <p className="text-support text-ink-muted">{formatDate(data.range_start)} – {formatDate(data.range_end)}</p>}
        </div>
      </header>

      {error && <ErrorState variant="inline" title="Unable to load insights" message={error} onRetry={reload} />}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key indicators">
        <InsightKpiCard label="Total employees" icon={Users} accent="hr" loading={initial} denied={data && !data.kpis.employees ? "You don't have access to workforce data for this institution." : null} value={data?.kpis.employees ? formatNumber(data.kpis.employees.value) : undefined} change={data?.kpis.employees?.change_percent} />
        <InsightKpiCard label="Total payroll" icon={WalletCards} accent="payroll" loading={initial} denied={data && !data.kpis.payroll ? "You don't have access to payroll data for this institution." : null} value={data?.kpis.payroll ? formatAmount(data.kpis.payroll.value, currency) : undefined} change={data?.kpis.payroll?.change_percent} />
        {executive ? (
          <InsightKpiCard label="Revenue / cash (YTD)" icon={Coins} accent="attendance" loading={initial} denied={data && !data.kpis.revenue_ytd ? "You don't have access to financial data for this institution." : null} value={data?.kpis.revenue_ytd ? formatAmount(data.kpis.revenue_ytd.value, currency) : undefined} change={data?.kpis.revenue_ytd?.change_percent} detail={data?.kpis.revenue_ytd ? `Cash ${formatAmount(data.kpis.revenue_ytd.cash_balance, currency)}` : undefined} />
        ) : <InsightKpiCard label="Revenue / cash" icon={Coins} accent="attendance" loading={initial} denied={data && !data.kpis.revenue ? "You don't have access to financial data for this institution." : null} value={data?.kpis.revenue ? formatAmount(data.kpis.revenue.value, currency) : undefined} change={data?.kpis.revenue?.change_percent} detail={data?.kpis.revenue ? `Cash ${formatAmount(data.kpis.revenue.cash_balance, currency)}` : undefined} />}
        {executive ? (
          <InsightKpiCard
            label="Compliance rate"
            icon={ShieldCheck}
            accent="audit"
            loading={initial}
            denied={data && !data.kpis.compliance ? "You don't have access to compliance data for this institution." : null}
            value={data?.kpis.compliance ? (data.kpis.compliance.value === null ? EM_DASH : percent(data.kpis.compliance.value)) : undefined}
            change={data?.kpis.compliance?.change_points}
            changeUnit="pts"
            detail={data?.kpis.compliance ? (data.kpis.compliance.checks.some((check) => check.total) ? data.kpis.compliance.checks.map((check) => `${check.passed}/${check.total} ${check.label.toLowerCase()}`).join(" · ") : "No leave requests or payroll exceptions in this period") : undefined}
            info={data?.kpis.compliance ? "Share of checks passed: leave requests within their leave policy, and payroll exceptions acknowledged or resolved." : undefined}
          />
        ) : <InsightKpiCard label="Operational alerts" icon={AlertTriangle} accent="audit" loading={initial} denied={data && !data.kpis.alerts ? "You don't have access to operational alerts data." : null} value={data?.kpis.alerts ? formatNumber(data.kpis.alerts.value) : undefined} detail={data?.kpis.alerts ? (data.kpis.alerts.breakdown.filter((item) => item.count).map((item) => `${item.count} ${item.label.toLowerCase()}`).join(" · ") || "No failed jobs or open exceptions") : undefined} />}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ChartCard title="Employee demographics" description="A breakdown of your workforce." icon={Users} accent="hr" loading={initial} actions={asOf && <span className="text-caption text-ink-muted">{asOf}</span>} empty={!workforce || !workforce.total_employees} emptyTitle={workforce ? "No employees yet" : "No workforce data available"} emptyDescription={workforce ? "Active employees will appear here." : "Workforce data is not available for your access level."} data={{ columns: ["Group", "Employees", "Share"], rows: demographicRows.map((row) => [row.label, row.count, percent(row.percent)]) }}>
          <Tabs label="Demographic" value={demographic} onChange={(value) => setDemographic(value as DemographicTab)} items={[{ value: "gender", label: "Gender" }, { value: "age_range", label: "Age range" }, { value: "employment_status", label: "Employment status" }]} className="mb-3" />
          <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,13rem)_1fr]">
            <DonutChart data={demographicRows.map((row, index) => ({ label: row.label, value: row.count, color: seriesColors[index % seriesColors.length] }))} height={200} centerValue={workforce ? formatNumber(workforce.total_employees) : undefined} centerLabel="employees" />
            <ul className="space-y-3">
              {demographicRows.map((row, index) => (
                <li key={row.label} className="flex items-center gap-3 text-support">
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: seriesColors[index % seriesColors.length] }} aria-hidden="true" />
                  <span className="flex-1 text-ink">{row.label}</span>
                  <span className="font-semibold text-ink-strong tabular-nums">{percent(row.percent)}</span>
                </li>
              ))}
            </ul>
          </div>
        </ChartCard>

        <ChartCard title="Module performance trend" description={executive ? "Activity trend across all accessible modules." : "Activity trend across your accessible modules."} icon={BarChart3} accent="brand" loading={initial} actions={<RangeSelect compact value={range} onChange={setRange} />} empty={!data?.module_trend} emptyTitle="No module activity available" emptyDescription="Activity from HR, payroll and recruitment appears here when your role can see those modules." legend={data?.module_trend?.series.map((series) => ({ label: `${series.label} · ${series.unit}`, color: moduleColors[series.code] ?? "var(--chart-5)", shape: "line" as const }))} data={{ columns: ["Month", ...(data?.module_trend?.series.map((series) => `${series.label} (${series.unit})`) ?? [])], rows: trendRows.map((row) => [String(row.month), ...(data?.module_trend?.series.map((series) => Number(row[series.code] ?? 0)) ?? [])]) }}>
          <TrendChart data={trendRows} xKey="month" height={250} series={(data?.module_trend?.series ?? []).map((series) => ({ key: series.code, label: series.label, color: moduleColors[series.code] ?? "var(--chart-5)" }))} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ChartCard title="Employees by department" description="Workforce distribution across departments." icon={BarChart3} accent="hr" loading={initial} actions={asOf && <span className="text-caption text-ink-muted">{asOf}</span>} empty={!workforce?.by_department.length} emptyTitle={workforce ? "No departments assigned" : "No department data available"} emptyDescription={workforce ? "Current employments without a department appear as Unassigned." : "Department data is not available for your access level."} data={{ columns: ["Department", "Employees", "Share"], rows: (workforce?.by_department ?? []).map((row) => [row.label, row.count, percent(row.percent)]) }}>
          <ShareBars rows={workforce?.by_department ?? []} />
        </ChartCard>

        <ChartCard title="Workforce trend" description="Total headcount over time." icon={LineChartIcon} accent="hr" loading={initial} actions={workforce && <RangeSelect compact value={range} onChange={setRange} />} empty={!workforce?.headcount_trend.length} emptyTitle="No workforce trend available" emptyDescription="Headcount history is not available for your access level." data={{ columns: ["Month", "Headcount"], rows: (workforce?.headcount_trend ?? []).map((row) => [row.month, row.headcount]) }}>
          <TrendChart variant="area" data={workforce?.headcount_trend ?? []} xKey="month" height={230} series={[{ key: "headcount", label: "Headcount", color: "var(--chart-1)" }]} />
        </ChartCard>

        <ChartCard title="Age distribution" description="Workforce by age group." icon={PieChartIcon} accent="hr" loading={initial} actions={asOf && <span className="text-caption text-ink-muted">{asOf}</span>} empty={!workforce?.total_employees} emptyTitle="No age data available" emptyDescription="Age data is not available for your access level." data={{ columns: ["Age group", "Employees", "Share"], rows: (workforce?.age_distribution ?? []).map((row) => [row.label, row.count, percent(row.percent)]) }}>
          <BarsChart data={(workforce?.age_distribution ?? []).map((row) => ({ label: row.label, share: toNumber(row.percent) }))} xKey="label" format="percent" colorByIndex height={230} series={[{ key: "share", label: "Share of workforce" }]} />
        </ChartCard>
      </div>

      <div className={cx("grid gap-4 lg:grid-cols-2", executive ? "2xl:grid-cols-4" : "xl:grid-cols-3")}>
        <ChartCard title="Location distribution" description="Workforce across campus locations." icon={MapPin} accent="hr" loading={initial} empty={!workforce?.by_location.length} emptyTitle="No location data available" emptyDescription={workforce ? "Current employments have no location yet." : "Location data is not available for your access level."} data={{ columns: ["Location", "Employees", "Share"], rows: (workforce?.by_location ?? []).map((row) => [row.label, row.count, percent(row.percent)]) }}>
          <ShareBars rows={workforce?.by_location ?? []} limit={6} />
        </ChartCard>

        <ChartCard title="Tenure distribution" description="Length of service at the institution." icon={Clock3} accent="hr" loading={initial} empty={!workforce?.total_employees} emptyTitle="No tenure data available" emptyDescription="Tenure data is not available for your access level." data={{ columns: ["Tenure", "Employees", "Share"], rows: (workforce?.tenure_distribution ?? []).map((row) => [row.label, row.count, percent(row.percent)]) }}>
          <BarsChart data={(workforce?.tenure_distribution ?? []).map((row) => ({ label: row.label, employees: row.count }))} xKey="label" colorByIndex height={200} series={[{ key: "employees", label: "Employees" }]} />
        </ChartCard>

        <ChartCard title="Leave & attendance pattern" description="Monthly leave and attendance rates." icon={CalendarDays} accent="leave" loading={initial} empty={!leaveRows.length} emptyTitle="No leave data available" emptyDescription="Leave and attendance data is not available for your access level." legend={data?.access.leave ? [{ label: "Approved leave days", color: "var(--mod-leave)", shape: "square" as const }] : data?.access.attendance ? [{ label: "Attendance rate", color: "var(--mod-attendance)", shape: "line" as const }] : undefined} data={{ columns: ["Month", "Approved leave days", "Attendance rate"], rows: leaveRows.map((row) => [row.month, row.leave_days === null ? EM_DASH : toNumber(row.leave_days), percent(row.attendance_rate)]) }}>
          {data?.access.leave ? (
            <BarsChart data={leaveRows.map((row) => ({ month: row.month, days: toNumber(row.leave_days) }))} xKey="month" xFormat="month" format="days" height={200} series={[{ key: "days", label: "Approved leave days", color: "var(--mod-leave)" }]} />
          ) : (
            <TrendChart data={leaveRows.map((row) => ({ month: row.month, rate: row.attendance_rate === null ? null : toNumber(row.attendance_rate) }))} xKey="month" format="percent" height={200} series={[{ key: "rate", label: "Attendance rate", color: "var(--mod-attendance)" }]} />
          )}
          {data?.access.leave && data.access.attendance && (
            <p className="mt-2 text-caption text-ink-muted">Average attendance rate: {averageRate(leaveRows)}</p>
          )}
        </ChartCard>

        {executive && (
          <ChartCard title="Revenue by source" description="Income distribution for the period." icon={PieChartIcon} accent="accounting" loading={initial} empty={!data?.revenue_by_source?.length} emptyTitle="No revenue data available" emptyDescription={data?.revenue_by_source ? "No posted income in this period." : "Revenue data is not available for your access level."} data={{ columns: ["Source", "Amount", "Share"], rows: (data?.revenue_by_source ?? []).map((row) => [row.label, formatAmount(row.amount, currency), percent(row.percent)]) }}>
            <DonutChart data={(data?.revenue_by_source ?? []).map((row, index) => ({ label: row.label, value: row.amount, color: seriesColors[index % seriesColors.length] }))} format="currency" currency={currency} height={170} />
            <ul className="mt-2 space-y-1.5">
              {(data?.revenue_by_source ?? []).map((row, index) => (
                <li key={row.label} className="flex items-center gap-2 text-caption">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: seriesColors[index % seriesColors.length] }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-ink" title={row.label}>{row.label}</span>
                  <span className="font-semibold text-ink-strong tabular-nums">{percent(row.percent)}</span>
                </li>
              ))}
            </ul>
          </ChartCard>
        )}
      </div>
      {!initial && data && !Object.values(data.access).some(Boolean) && (
        <NoAccessPanel icon={CircleDollarSign} title="No insight areas available for your role" description="Ask an administrator for dashboard access to see institution-wide insights." />
      )}
    </div>
  );
}
